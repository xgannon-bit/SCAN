import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeArchive, syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';

/** All bytes originate in newly authored public Python fixtures, never real jobs. */
export function authoredDiagnosis({ aligned = false, duplicate = false } = {}) {
  const python = process.env.SCAN_PYTHON || path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', `import json,sys,copy,xml.etree.ElementTree as E
from workers.scan.tests.test_native_placement_diagnosis import setup
d,p,b,expected=setup(90,aligned=${aligned ? 'True' : 'False'},source_shift=(23,-7))
if ${duplicate ? 'True' : 'False'}:
 j=E.fromstring(d['job']);j.find('PartDataList').append(copy.deepcopy(j.findall('PartDataList/PartData')[-1]));d['job']=E.tostring(j)
print(json.dumps(dict(job=d['job'].decode(),master=d['master'].decode(),pcb=d['pcb'].decode(),placement=p.decode(),bom=b.decode(),context=d['context'],expected=expected)))`], { encoding: 'utf8', maxBuffer: 1_000_000 });
  if (result.status !== 0) throw new Error('Wholly authored diagnosis fixture generation failed.');
  const fixture = JSON.parse(result.stdout);
  const members = { ...syntheticMembers, [syntheticSelection.jobMember]: fixture.job, [syntheticSelection.masterMember]: fixture.master,
    'Fictional/Board/unknown-preserved.txt': 'Authored companion bytes remain intact.' };
  return { ...fixture, members, archive: makeArchive(members), selection: syntheticSelection };
}

/** A pending exact proposal; only the server may calculate acceptance digests. */
export function requestFromDiagnosis(report, context) {
  const row = report.rows.find(row => row.identity.RefID === 'N1');
  if (!row || row.proposals.length !== 2) throw new Error('Expected two supported invented scalars.');
  const evidenceId = 'authored-source-derived-evidence';
  const proposals = row.proposals.map((p, i) => ({ id: `authored-derived-${i}`, path: `${row.sourcePath}/${p.field}`, identity: row.identity, before: p.before, after: p.after, beforeRoi: row.beforeRoi, evidenceIds: [evidenceId] }));
  proposals.forEach(p => { p.dependencyProposalIds = proposals.filter(other => other !== p).map(other => other.id); });
  return { artifactType: 'scan.qualification-patch-request', schemaVersion: '1', purpose: 'qualification-only', source: {
    archiveSha256: report.source.archiveSha256, jobSha256: report.source.jobSha256, masterSha256: report.source.masterSha256,
    root: report.source.root, jobMember: report.source.jobMember, masterMember: report.source.masterMember, jobRole: 'main', masterRole: 'main' },
    targetEagleBuild: null, targetMachine: null, reviewer: 'Authored test reviewer', trialPurpose: 'Isolated invented source-derived scalar trial; no machine or physical qualification.',
    evidence: [{ id: evidenceId, kind: 'independent-source-support', independentSupport: true, summary: 'Fresh independently authored source body and original CAD frame contract.', references: [{ sha256: report.diagnosisSha256, label: 'Frozen source-derived diagnosis' }] }],
    proposals, acceptances: [], diagnosis: { ...context, diagnosisSha256: report.diagnosisSha256 } };
}
