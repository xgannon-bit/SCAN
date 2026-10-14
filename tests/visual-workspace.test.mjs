import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVisualWorkspace, validateVisualWorkspace, placementEntities, nativeEntities, fitEntities, proposalMatches, previewEntity, appendVisualEvent, appendVisualJournal, visualHistoryDisclosure, decideProposalGroup, repairIsFresh, visibleReferenceLabels } from '../lib/scan/visual-workspace.ts';
import { encodeProject, decodeProject } from '../lib/scan/project-session.ts';
import { gerberShape, gerberDisplayHold } from '../lib/scan/gerber-display.ts';

test('Gerber flash holes preserve underlying polarity; unimplemented holed sweeps are explicitly held', () => {
  const object = { operation: 'flash', end_x: '2', end_y: '3', start_x: '0', start_y: '0', aperture_d_code: 10 };
  for (const [template, parameters] of [['C', ['2', '1']], ['R', ['3', '2', '1']], ['O', ['3', '2', '1']], ['P', ['3', '6', '30', '1']]]) {
    const shape = gerberShape(object, { template, parameters }); assert.equal(shape.d.split('Z').length, 3); // Separate outer and inner closed contours, filled even-odd.
  }
  const layer = { objects: [{ ...object, operation: 'draw' }], apertures: [{ d_code: 10, template: 'C', parameters: ['2', '1'] }] };
  assert.match(gerberDisplayHold(layer), /swept-hole/); layer.apertures[0].parameters = ['2']; assert.equal(gerberDisplayHold(layer), null);
});

const placement = (refdes, row, side, xMm, yMm) => ({ refdes, sourceRow: row, side, module: 'Invented', placementId: refdes, xMm, yMm, rotationCcwDegrees: '90' });
test('crosses retain exact source coordinates, duplicate references and side identity; unknown units are not plotted', () => {
  const result = { sourceSha256: 'a'.repeat(64), interpretationSha256: 'b'.repeat(64), placements: [placement('A1', 1, 'Top', '-3.125', '24'), placement('A1', 2, 'Bottom', '31.75', '-2'), placement('A1', 3, 'Top', '4', '5'), placement('U1', 4, 'unknown', null, null), placement('Z1', 5, 'Top', '', '2')] };
  const before = JSON.stringify(result), entities = placementEntities(result);
  assert.equal(entities.length, 3); assert.equal(new Set(entities.map(e => e.key)).size, 3);
  assert.deepEqual(entities.map(e => [e.x, e.y]), [[-3.125, 24], [31.75, -2], [4, 5]]);
  assert.equal(JSON.stringify(result), before); // No implicit bottom mirror or snapping.
  const crowded = entities.map((e, i) => ({ ...e, x: i * .01, y: i * .01 })), copy = structuredClone(crowded);
  const labels = visibleReferenceLabels(crowded, 1, -1, crowded[1].key);
  assert.equal(labels.size, 1); assert.ok(labels.has(crowded[1].key)); assert.deepEqual(crowded, copy);
  assert.equal(visibleReferenceLabels(crowded, .0001, -1).size, crowded.length);
});
test('view fit identifies outliers without modifying data; fit-all retains their extent', () => {
  const p = Array.from({ length: 30 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) * 3 })); p.push({ x: 9999, y: -9999 });
  const before = structuredClone(p), fitted = fitEntities(p), all = fitEntities(p, true);
  assert.equal(fitted.excluded, 1); assert.ok(fitted.camera.width < 50); assert.ok(all.camera.width > 9999); assert.deepEqual(p, before);
  const dense = Array.from({ length: 160_000 }, (_, i) => ({ x: i, y: -i }));
  const denseFit = fitEntities(dense, true);
  assert.ok(denseFit.camera.width > 159999); assert.ok(denseFit.camera.y < -159999);
});
const preflight = { source: { sha256: 'a'.repeat(64) }, selection: { job: { sha256: 'b'.repeat(64) }, master: { member: 'x/Master.xml', sha256: 'c'.repeat(64), role: 'main' } }, nativeRecords: { job: { records: [{ kind: 'part-record', sourcePath: 'Job/PartDataList/PartData[7]', rawFields: { RefID: ['F7'], ID: ['81'], MasterKey: ['82'], ParentId: ['1'], 'Roi/cx': ['-4'], 'Roi/cy': ['8'], 'Roi/w': ['2'], 'Roi/h': ['3'], 'Roi/a': ['90'] } }] } } };
const entity = nativeEntities(preflight)[0];
const group = ['cx', 'cy'].map((axis, index) => ({ id: `p${index}`, path: `${entity.path}/Roi/${axis}`, identity: { ID: '81', MasterKey: '82', ParentId: '1', RefID: 'F7' }, beforeRoi: { cx: '-4', cy: '8', w: '2', h: '3', a: '90' }, before: index ? '8' : '-4', after: index ? '10' : '-1', evidenceIds: ['invented'], dependencyProposalIds: [`p${1-index}`] }));
test('preview binds stable identity and baseline; scrub cannot mutate engineering coordinates', () => {
  const before = JSON.stringify({ preflight, group });
  assert.deepEqual([previewEntity(entity, group, .5).x, previewEntity(entity, group, .5).y], [-2.5, 9]);
  assert.equal(previewEntity(entity, group, 0).x, -4); assert.equal(previewEntity(entity, group, 10).x, -1);
  for (const field of ['id', 'master', 'module', 'ref', 'path']) assert.equal(proposalMatches({ ...entity, [field]: 'wrong' }, group), false);
  assert.equal(previewEntity({ ...entity, x: 7 }, group), null);
  assert.equal(previewEntity(entity, [{ ...group[0], path: `${entity.path}/CenterPosX` }]), null);
  assert.equal(JSON.stringify({ preflight, group }), before);
});
test('exact paired decisions retain separate preview, accepted and written states; stale scope is refused', () => {
  const request = { source: { archiveSha256: 'a'.repeat(64), jobSha256: 'b'.repeat(64), jobMember: 'x/Job.xml', masterMember: 'x/Master.xml', masterSha256: 'c'.repeat(64) }, proposals: group, acceptances: group.map(p => ({ proposalId: p.id, proposalSha256: 'd'.repeat(64), decision: 'pending' })) };
  const accepted = decideProposalGroup(request, group, 'accepted'); assert.ok(accepted.acceptances.every(a => a.decision === 'accepted')); assert.ok(request.acceptances.every(a => a.decision === 'pending'));
  const selection = { jobMember: 'x/Job.xml', jobRole: 'main' }, repair = { request, sourceContext: 'e'.repeat(64) };
  assert.equal(repairIsFresh(repair, preflight, selection, 'e'.repeat(64)), true);
  assert.equal(repairIsFresh(repair, preflight, selection, 'f'.repeat(64)), false);
  assert.equal(repairIsFresh(repair, preflight, { ...selection, jobRole: 'temp' }, 'e'.repeat(64)), false);
  assert.equal(repairIsFresh(repair, { ...preflight, source: { sha256: 'f'.repeat(64) } }, selection, 'e'.repeat(64)), false);
});
const event = { id: 'e1', run: 'r1', sequence: 1, at: '2026-01-01T00:00:00.000Z', source: 'invented-scope', stage: 'Parser', status: 'started', message: 'Reading authored source.', count: null, entity: null };
test('journal rejects duplicate, stale/out-of-order and late post-cancel events', () => {
  let events = appendVisualEvent([], event); assert.equal(appendVisualEvent(events, event), events);
  assert.equal(appendVisualEvent(events, { ...event, id: 'old', sequence: 0 }), events);
  assert.equal(appendVisualEvent(events, { ...event, id: 'wrong', sequence: 2, source: 'different', status: 'completed' }), events);
  events = appendVisualEvent(events, { ...event, id: 'cancel', sequence: 2, status: 'cancelled' });
  assert.equal(appendVisualEvent(events, { ...event, id: 'late', sequence: 3, status: 'completed', count: 40 }), events);
});

test('R02-F05: >500 events disclose exact presentation trimming and retained ranges, independently of transport', () => {
  let view = emptyVisualWorkspace();
  for (let i = 1; i <= 602; i++) view = appendVisualJournal(view, { ...event, id: `e${i}`, sequence: i, status: i === 602 ? 'completed' : i === 1 ? 'started' : 'progress', ...(i === 602 ? {transportDropped: 17} : {}) });
  assert.equal(view.events.length, 500); assert.equal(view.historyOmitted, 102);
  const roundtrip = validateVisualWorkspace(JSON.parse(JSON.stringify(view))), disclosure = visualHistoryDisclosure(roundtrip.events, roundtrip.historyOmitted);
  assert.equal(disclosure.partial, true); assert.deepEqual(disclosure.runs[0], {run:'r1',first:103,last:602,retained:500,transportDropped:17,partial:true});
  assert.equal(appendVisualJournal(view, view.events.at(-1)), view);
  assert.equal(appendVisualJournal(view, {...event,id:'late',sequence:603}), view);
  const legacy = structuredClone(view); delete legacy.historyOmitted;
  assert.equal(visualHistoryDisclosure(validateVisualWorkspace(legacy).events).legacy, true);
  for (const n of [-1, 1.5, Infinity]) assert.throws(() => validateVisualWorkspace({...view,historyOmitted:n}));
  assert.throws(() => validateVisualWorkspace({...view,events:[{...event,status:'completed',transportDropped:-1}]}));
});
test('byte-bound and whole-run trimming keep omission disclosure when retained run begins at sequence one', () => {
  let view = emptyVisualWorkspace();
  for (let i = 1; i <= 500; i++) view = appendVisualJournal(view, {...event,id:`first-${i}`,sequence:i,status:i===500?'completed':'progress'});
  for (let i = 1; i <= 500; i++) view = appendVisualJournal(view, {...event,run:'new',id:`second-${i}`,sequence:i,status:i===500?'completed':'progress'});
  assert.equal(view.events[0].sequence,1); assert.equal(view.historyOmitted,500); assert.equal(visualHistoryDisclosure(view.events,view.historyOmitted).partial,true);
  let large = emptyVisualWorkspace();
  for (let i=1;i<=500;i++) large = appendVisualJournal(large,{...event,id:`large-${i}`,sequence:i,status:'progress',message:'x'.repeat(2000)});
  assert.ok(large.events.length<500); assert.equal(large.historyOmitted+large.events.length,500); validateVisualWorkspace(large);
});
test('visual project state is optional, bounded and presentation-only; replay cannot restore machine authority', async () => {
  const view = emptyVisualWorkspace(); view.events = [event]; view.scope = '["invented","Bottom"]'; view.cameras.source = { x: -10, y: -30, width: 50, height: 40 };
  const source = new File(['F1,1,2\n'], 'synthetic.csv'), config = { startRow: 1, columns: { refdes: 1, x: 2, y: 3 }, module: 'invented', side: 'Top', units: 'mm', rotationDirection: 'ccw', decimalSeparator: '.', pairSeparator: ',' };
  const input = { placement: { file: source, settings: { config, sheetIndex: 0, delimiter: ',', validated: true, selectedRow: null, notes: {} } }, gerber: null, original: null, returned: null, notes: {}, machineVersion: '' };
  const saved = await encodeProject({ ...input, visualWorkspace: view }); const restored = await decodeProject(new File([saved], 'saved.json'));
  assert.deepEqual(restored.record.visualWorkspace, view); assert.equal(await restored.placement.source.text(), await source.text()); assert.equal(restored.record.machineExportAllowed, false);
  assert.equal((await decodeProject(new File([await encodeProject(input)], 'legacy.json'))).record.visualWorkspace, undefined);
  for (const changed of [{ ...view, authority: 'machine-verified' }, { ...view, machineExportAllowed: true }, { ...view, events: [{ ...event, status: 'machine-verified' }] }, { ...view, cameras: { source: { x: 0, y: 0, width: 0, height: 10 } } }]) assert.throws(() => validateVisualWorkspace(changed), /visual workspace/);
});


test('overlapping display hit targets choose the clicked native origin without modifying records', async () => {
  const { nearestVisualOrigin } = await import('../lib/scan/visual-workspace.ts');
  const points = [{key:'selected',ref:'A',module:'1',side:'unknown',x:10,y:20}, {key:'overlapping-circle',ref:'B',module:'1',side:'unknown',x:11.7,y:21.8}];
  const frozen = JSON.stringify(points);
  assert.equal(nearestVisualOrigin(points,{x:10,y:20},4)?.key,'selected');
  assert.equal(nearestVisualOrigin([...points].reverse(),{x:10,y:20},4)?.key,'selected');
  assert.equal(nearestVisualOrigin(points,{x:11.7,y:21.8},4)?.key,'overlapping-circle');
  assert.equal(nearestVisualOrigin(points,{x:0,y:0},4),undefined);
  assert.equal(JSON.stringify(points),frozen);
});
