import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrigins, initialOriginSettings, validateOriginSettings } from '../lib/scan/origin-resolver.ts';
import { sourceRegistrationAnalysis, emptySourceRegistration, registrationScope } from '../lib/scan/source-registration.ts';
import { coordinateSources } from '../lib/scan/coordinate-sources.ts';

// Entirely authored geometry: an asymmetric origin and a separately declared body.
function fixture(angle=0, knownSide=true, globalAngle=0) {
  const rad=angle*Math.PI/180, c=Math.cos(rad),s=Math.sin(rad), dx=.3*c+.2*s,dy=.3*s-.2*c;
  const layout={artifactType:'scan.accel-source-model',status:'success',sourceSha256:'b'.repeat(64),declaredUnits:'mm',holds:[],warnings:[],machineExportAllowed:false,
    placements:[['A1',0,0],['A2',10,0],['A3',0,10],['A4',10,10],['N1',3,2]].map(([refdes,x,y],i)=>({sourcePath:`/patterns/${i}`,refdes,anchor:{xMm:x,yMm:y},rotation:{degrees:refdes==='N1'?angle:0},isFlippedRaw:'False',side:knownSide?'Top':null,component:{compValue:'fictional'},sourceOwnedPads:[],ownedPadCentersAvailable:true,geometryAvailable:true,holds:[],identityHolds:[]}))};
  const target=coordinateSources({name:'',result:null},[],{name:'authored-REV2.PCB',result:layout},null)[0];
  const ga=globalAngle*Math.PI/180,gc=Math.cos(ga),gs=Math.sin(ga);
  const source={id:'primary',label:'fictional-REV2.csv',sha256:'a'.repeat(64),interpretation:'authored-center-mm-ccw',frame:'declared source center (mm)',inputUnits:'mm',normalizedUnits:'mm',revisionHint:'2',
    points:layout.placements.map((p,i)=>{const x=p.anchor.xMm+(p.refdes==='N1'?dx:0)-11,y=p.anchor.yMm+(p.refdes==='N1'?dy:0)+7;
      return{reference:p.refdes,identity:`row:${i}`,module:'1',side:'Top',x:gc*x+gs*y,y:-gs*x+gc*y,rotation:p.rotation.degrees-globalAngle,holds:[]};})};
  const draft={...emptySourceRegistration(),sourceId:source.id,targetId:'layout',sourceScope:registrationScope(source.points[0]),targetScope:registrationScope(target.points[0]),sourceRevision:'2',targetRevision:'2',sourceSide:'top',targetSide:'top',framesConfirmed:true,frameEvidence:'Authored independent origin controls with package evidence.',fitReferences:['A1','A2','A3'],checkReferences:['A4'],toleranceMm:'0.001'};
  const bom={artifactType:'scan.engineering-bom',status:'success',sourceSha256:'c'.repeat(64),config:{revision:'2'},references:layout.placements.map(p=>({normalizedRefdes:p.refdes,quantityMatches:true,populationEvidence:'engineering-listed',mpn:'fictional-device',scope:{module:'1',side:'Top'}}))};
  const bodyEvidence={status:'success',artifactType:'scan.source-body-evidence',schemaVersion:'1',layoutSha256:layout.sourceSha256,bomSha256:bom.sourceSha256,profilesSha256:'d'.repeat(64),evidenceSha256:'e'.repeat(64),machineQualified:false,nativeEditsApplied:false,
    records:[{reference:'N1',sourcePath:'/patterns/4',profileId:'fictional-independent-profile',profileSha256:'f'.repeat(64),status:'supported',bodyLocalMm:[.3,-.2],bodyBoardMm:[3+dx,2+dy],bodySizeMm:[2.4,4.2],sourceRotationDegrees:angle,sourceSide:knownSide?'Top':null,drawingSha256:'1'.repeat(64),holds:[],mpnMatched:true}]};
  const settings={...initialOriginSettings(),sourceRevision:'2',layoutRevision:'2',bomRevision:'2',sourceAnchor:'declared-center',outputAnchor:'pcb-footprint-origin',relationshipEvidence:'The source header explicitly declares center; body evidence is independently authored.'};
  const input={source,layout,bom,registration:sourceRegistrationAnalysis(source,target,draft),settings,bodyEvidence};
  return {input,draft,target,rebuild:()=>{input.registration=sourceRegistrationAnalysis(input.source,target,draft);}};
}
const n1 = result => result.rows.find(r=>r.reference==='N1');

test('all cardinal rotations, nonzero local offset and rigid board rotation explain a convention without component fitting',()=>{
  for(const angle of [0,90,180,270,-90,360]) for(const global of [0,30]) {
    const {input}=fixture(angle,true,global), before=JSON.stringify(input), result=resolveOrigins(input), item=n1(result);
    assert.equal(item.classification,'explained-convention');
    assert.equal(item.discrepancy,true);assert.equal(item.proposed.operation,'anchor-normalization');assert.equal(item.proposed.x,3);assert.equal(item.proposed.y,2);
    assert.equal(item.exportEligible,true);assert.ok(item.residualsMm.toBodyCenter<1e-10);assert.deepEqual(item.bodyLocalMm,[.3,-.2]);
    assert.equal(result.counts.total,5);assert.equal(result.counts.discrepancies,1);assert.equal(result.counts.classifications['already-consistent'],4);
    assert.equal(JSON.stringify(input),before);assert.equal(result.nativeEditsApplied,false);assert.equal(result.machineQualified,false);
  }
});
test('unknown side remains unknown even when reviewed registration says top; every exclusion is retained',()=>{
  const {input}=fixture(90,false), report=resolveOrigins(input), item=n1(report);
  assert.equal(item.classification,'explained-convention');assert.equal(item.side,null);assert.equal(item.proposed.side,null);assert.equal(item.exportEligible,false);
  assert.equal(report.counts.held,5);assert.ok(item.holds.some(h=>h.code==='ORIGIN_SIDE_UNKNOWN'));
});
test('reviewed unknown side permits numeric convention diagnosis but never normalized export',()=>{
  const f=fixture(90,false);f.draft.targetSide='';f.rebuild();const report=resolveOrigins(f.input);
  assert.equal(n1(report).classification,'explained-convention');assert.equal(report.counts.classifications['already-consistent'],4);assert.equal(report.counts.exportEligible,0);assert.equal(report.counts.held,5);assert.ok(report.rows.every(r=>r.holds.some(h=>h.code==='ORIGIN_SIDE_UNKNOWN')));
});
test('pad envelope coincidence is a geometric witness, never independent body proof',()=>{
  const {input}=fixture();input.bodyEvidence=null;const p=input.layout.placements[4];
  p.sourceOwnedPads=[{padNumber:'1',sourcePath:'pad:1',sourceBoardPoint:{xMm:1.8,yMm:1.8}},{padNumber:'2',sourcePath:'pad:2',sourceBoardPoint:{xMm:4.8,yMm:1.8}}];
  p.explicitLayerGeometry=[{layerNumber:'1',unresolvedClassPaths:[],pads:[-1.2,1.8].map((x,i)=>({padNumber:String(i+1),padSourcePath:`pad:${i+1}`,shape:'Rect',widthMm:.8,heightMm:1.2,local:{xMm:x,yMm:-.2},localRotationDegrees:0}))}];
  const item=n1(resolveOrigins(input));assert.equal(item.classification,'unresolved');assert.equal(item.bodyCenter,null);assert.ok(item.residualsMm.toPadEnvelopeCenter<1e-10);assert.equal(item.proposed,null);
  assert.match(item.summary,/not a proved placement defect/);assert.ok(item.holds.some(h=>h.code==='ORIGIN_BODY_DATUM'));
});
test('explicit anchor correction is distinct from an explained generic center and needs independent evidence',()=>{
  const {input,rebuild}=fixture();input.source.points[4].x+=.5;rebuild();
  assert.equal(n1(resolveOrigins(input)).classification,'unresolved');
  input.settings.sourceAnchor='package-body-center';input.settings.outputAnchor='package-body-center';
  const item=n1(resolveOrigins(input));assert.equal(item.classification,'supported-correction');assert.equal(item.proposed.operation,'local-source-correction');assert.equal(item.proposed.x,3.3);
  input.bodyEvidence=null;assert.equal(n1(resolveOrigins(input)).classification,'unresolved');
});
test('a supported origin-to-body normalization does not claim a placement error',()=>{
  const {input,rebuild}=fixture();input.source.points[4].x-=.3;input.source.points[4].y+=.2;rebuild();input.settings.sourceAnchor='pcb-footprint-origin';input.settings.outputAnchor='package-body-center';
  const item=n1(resolveOrigins(input));assert.equal(item.classification,'supported-normalization');assert.equal(item.discrepancy,false);assert.equal(item.proposed.operation,'anchor-normalization');
});
test('wrong revision, stale mapping/hash/control, mirror and fitted scale cannot authorize corrections',()=>{
  const changes=[
    f=>{f.input.settings.sourceRevision='1';},f=>{f.input.source.sha256='0'.repeat(64);},f=>{f.input.source.interpretation+='changed';},
    f=>{f.input.source.points[0].x+=1;},f=>{f.input.registration.transform.scale=1.01;},f=>{f.input.registration.transform.mirror=true;},
    f=>{f.input.registration.transform.matrix[0][0]=2;},f=>{f.input.bodyEvidence.layoutSha256='0'.repeat(64);},
    f=>{f.input.registration.residuals.find(r=>r.role==='check').role='unselected';},f=>{f.input.settings.relationshipEvidence='';},
  ];
  for(const change of changes){const f=fixture();change(f);const r=resolveOrigins(f.input);assert.equal(r.counts.exportEligible,0);assert.ok(r.holds.length);assert.equal(n1(r).classification,'unresolved');}
});
test('unresolved body ambiguity and changed independent geometry never normalize',()=>{
  const f=fixture();f.input.bodyEvidence.records.push({...f.input.bodyEvidence.records[0],profileId:'other-symmetric-hypothesis'});
  assert.ok(n1(resolveOrigins(f.input)).holds.some(h=>h.code==='ORIGIN_BODY_AMBIGUOUS'));
  const g=fixture();g.input.bodyEvidence.records[0].bodyBoardMm[0]+=.2;
  assert.ok(n1(resolveOrigins(g.input)).holds.some(h=>h.code==='ORIGIN_BODY_FRAME'));
  const h=fixture();h.input.bodyEvidence.records[0].mpnMatched=false;assert.equal(n1(resolveOrigins(h.input)).exportEligible,false);
});
test('DNP, duplicate references, conflicting rotation and unsupported flip remain exact row holds',()=>{
  const f=fixture();f.input.bom.references[4].populationEvidence='engineering-dnp';assert.ok(n1(resolveOrigins(f.input)).holds.some(h=>h.code==='ORIGIN_DNP'));
  const g=fixture();g.input.source.points.push({...g.input.source.points[4],identity:'duplicate'});assert.ok(n1(resolveOrigins(g.input)).holds.some(h=>h.code==='ORIGIN_IDENTITY'));
  const h=fixture();h.input.source.points[4].rotation+=90;assert.ok(n1(resolveOrigins(h.input)).holds.some(h=>h.code==='ORIGIN_ROTATION_CONVENTION'));assert.equal(n1(resolveOrigins(h.input)).exportEligible,false);
  const j=fixture();j.input.layout.placements[4].isFlippedRaw='True';assert.ok(n1(resolveOrigins(j.input)).holds.some(h=>h.code==='ORIGIN_FLIP'));
});
test('strict settings reject malformed state',()=>{assert.throws(()=>validateOriginSettings({...initialOriginSettings(),extra:true}));assert.throws(()=>validateOriginSettings({...initialOriginSettings(),toleranceMm:NaN}));});
