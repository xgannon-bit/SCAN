import test from 'node:test';
import assert from 'node:assert/strict';
import { packageIdentityEvidence } from '../lib/scan/package-identity.ts';
const bom = { sourceSha256: 'a'.repeat(64), references: [{ normalizedRefdes: 'R1', sourceRow: 2, mpn: 'FICTIONAL-100', populationEvidence: 'engineering-listed', scope: { module: '1' } }] };
const pcb = { sourceSha256: 'b'.repeat(64), placements: [{ refdes: 'R1', component: { compRef: 'FICTIONAL-100', compValue: 'synthetic' } }] };
const archive = { preflight: { selection: { job: { sha256: 'c'.repeat(64) } }, nativeRecords: { job: { records: [{ kind: 'cad-record', rawFields: { RefID: ['R1'], ModuleID: ['1'], PrntPartName: ['FICTIONAL-100'] } }] } } } };
test('package identity checks exact BOM PCB and native literals without approving package or population', () => {
  const result = packageIdentityEvidence('R1', '1', bom, pcb, archive);
  assert.equal(result.status, 'exact-identity-literals-agree');
  assert.equal(result.packageQualified, false); assert.equal(result.workOrderApproved, false);
  const changed = structuredClone(pcb); changed.placements[0].component.compRef = 'FICTIONAL100';
  const mismatch = packageIdentityEvidence('R1', '1', bom, changed, archive);
  assert.equal(mismatch.status, 'package-qualification-held');
  assert.equal(mismatch.comparisons[0].state, 'different-literal-review-required');
  assert.match(mismatch.reason, /punctuation similarity is not an approved alias/);
});
test('unknown, duplicate, wrong-module and DNP identity evidence cannot silently qualify a populated package', () => {
  for (const [b,l,a] of [[null,pcb,archive],[bom,null,archive],[bom,pcb,null],[{ ...bom, references: [...bom.references,...bom.references] },pcb,archive]]) assert.equal(packageIdentityEvidence('R1','1',b,l,a).status,'package-qualification-held');
  assert.equal(packageIdentityEvidence('R1','2',bom,pcb,archive).status,'package-qualification-held');
  const dnp = structuredClone(bom);dnp.references[0].populationEvidence='engineering-dnp';dnp.references[0].mpn=null;
  assert.equal(packageIdentityEvidence('R1','1',dnp,pcb,archive).status,'population-review-needed');
});
