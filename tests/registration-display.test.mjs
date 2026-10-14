import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationDisplay } from '../lib/scan/registration-display.ts';
import { isProperRigidMatrix } from '../lib/scan/rigid-matrix.ts';
const fixture = () => ({ basis: 'current', scope: { module: '1', side: 'Top', boardInstance: 'invented' }, status: 'success', holds: [], toleranceMm: .1, maxResidualMm: .02, transform: { matrix: [[1, 0, 1], [0, 1, 2]], scale: 1, mirror: false }, residuals: ['fit','fit','fit','check'].map(role => ({ role, residualMm: .02, withinTolerance: true })) });
test('R02-F04: the authored near-rigid shear is refused by the shared guard and both display modes', () => {
  const a = fixture(); a.transform.matrix = [[1, .0001, 1], [0, Math.sqrt(1 - 1e-8), 2]];
  assert.equal(isProperRigidMatrix(a.transform.matrix), false);
  for (const diagnostic of [false, true]) {
    const result = registrationDisplay(a, 'current', '1', 'Top', diagnostic);
    assert.equal(result.passed, false); assert.equal(result.matrix, null); assert.equal(result.diagnosticAvailable, false);
  }
});
test('proper rigid guard retains rotations/translations and rejects reflection, scale and invalid shapes', () => {
  for (const angle of [0, 90, 180, 270, 37]) {
    const r = angle * Math.PI / 180;
    assert.equal(isProperRigidMatrix([[Math.cos(r), -Math.sin(r), -42], [Math.sin(r), Math.cos(r), 9]]), true);
  }
  for (const m of [null, [[1, 0], [0, 1]], [[1, 0, 0], [0, -1, 0]], [[2, 0, 0], [0, 2, 0]], [[1, 0, Infinity], [0, 1, 0]], [[1, 0, '1'], [0, 1, 0]]]) assert.equal(isProperRigidMatrix(m), false);
});
test('failed independent checks cannot appear registered; explicit diagnostic is orange/unregistered', () => {
  for (const change of [a => a.status = 'blocked', a => a.holds.push('check failed'), a => a.residuals[3].withinTolerance = false, a => a.residuals.pop(), a => a.maxResidualMm = .2]) {
    const a = fixture(); change(a);
    assert.equal(registrationDisplay(a, 'current', '1', 'Top', false).matrix, null);
    const diagnostic = registrationDisplay(a, 'current', '1', 'Top', true);
    assert.equal(diagnostic.passed, false); assert.ok(diagnostic.matrix); assert.match(diagnostic.label, /UNREGISTERED DIAGNOSTIC/);
  }
});
test('stale interpretation/scope and malformed transforms stay absent even in diagnostic mode', () => {
  for (const change of [a => a.basis = 'old', a => a.scope.module = '2', a => a.scope.side = 'Bottom', a => a.scope.boardInstance = '', a => a.transform.matrix[0][0] = 2, a => a.transform.matrix[1][2] = NaN]) {
    const a = fixture(); change(a); assert.equal(registrationDisplay(a, 'current', '1', 'Top', true).matrix, null);
  }
  assert.equal(registrationDisplay(fixture(), 'current', '1', 'Top', false).passed, true);
});
