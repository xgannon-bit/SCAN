// Wholly synthetic join benchmark. No parser, native job or machine is involved.
// Run: node --import tsx scripts/benchmark-board-processing.mjs
import { performance } from 'node:perf_hooks';
import { boardProcessingEvent, indexBoardEntities } from '../lib/scan/board-processing.ts';

const hash = c => c.repeat(64);
const baseline = { source: { sha256: hash('a') }, packageSha256: hash('b'), selection: { job: { member: 'synthetic/job.xml' }, master: { member: 'synthetic/Master.xml' } }, integrity: { status: 'verified-against-capture-hash', allArchivedFilesVerified: true } };
const samples = [];
for (const size of [1000, 3000]) {
  const entities = Array.from({ length: size }, (_, i) => ({ key: String(i), id: String(i), module: '1', ref: `SYN${i}`, master: String(i + size), side: 'unqualified', x: i % 100, y: Math.floor(i / 100), width: 2, height: 1, angle: 0 }));
  const events = entities.slice(-500).map((e, i) => ({ source: hash('a'), run: 'synthetic-run', sequence: i + 2, componentPhase: 'analysis-checked', nativeSource: { contextHash: hash('c'), packageSha256: hash('b'), jobMember: 'synthetic/job.xml', masterMember: 'synthetic/Master.xml' }, geometry: { frame: 'native-roi-unqualified', identity: { id: e.id, module: e.module, ref: e.ref, master: e.master }, before: { x: e.x, y: e.y, width: e.width, height: e.height, angle: e.angle }, after: { x: e.x, y: e.y, width: e.width, height: e.height, angle: e.angle } } }));
  const buildStart = performance.now(), index = indexBoardEntities(entities), indexBuildMs = performance.now() - buildStart;
  for (const [mode, joinedEntities] of [['linear', entities], ['indexed', index]]) {
  const times = [];
  for (let sample = 0; sample < 70; sample++) {
    const start = performance.now();
    const phases = new Map();
    for (const event of events) { const joined = boardProcessingEvent(event, baseline, joinedEntities, hash('c')); if (joined.entity) phases.set(joined.entity.key, event.componentPhase); }
    const elapsed = performance.now() - start;
    if (phases.size !== 500) throw new Error('Synthetic provenance/geometry join failed.');
    if (sample >= 10) times.push(elapsed);
  }
  times.sort((a,b)=>a-b);
  samples.push({ synthetic: true, mode, placements: size, retainedComponentEvents: events.length, measuredIterations: times.length, indexBuildMs: mode === 'indexed' ? +indexBuildMs.toFixed(3) : null, medianMs: +times[Math.floor(times.length / 2)].toFixed(3), p95Ms: +times[Math.floor(times.length * .95)].toFixed(3) });
  }
}
console.log(JSON.stringify({ kind: 'exact-identity join; timings are environment-specific, not an FPS or machine benchmark', samples }, null, 2));
