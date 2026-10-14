import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { POST } from '../app/api/archive/route.ts';
import { syntheticMembers, syntheticSelection } from './synthetic-archive.mjs';
const python = path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVR4nGNQKGgAAAG0ASGQiDnRAAAAAElFTkSuQmCC', 'base64');
const member = 'Fictional/Board/Invented.png';
const members = { ...Object.fromEntries(Object.entries(syntheticMembers).map(([name, value]) => [name, Buffer.from(value).toString('base64')])), [member]: png.toString('base64') };
members['Fictional/Master/PartImage/AUTHORED.png'] = png.toString('base64');
members['Fictional/Master/PatternModel/AUTHORED.tif'] = Buffer.from('II*\0').toString('base64');
const generated = spawnSync(python, ['-c', 'import sys,json,base64,zipfile,io\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,v in json.loads(sys.stdin.read()).items():z.writestr(n,base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(members) });
assert.equal(generated.status, 0); const bytes = generated.stdout;
const hash = b => createHash('sha256').update(b).digest('hex');
const base = { action: 'preflight', expectedArchiveSha256: hash(bytes), selection: syntheticSelection };
test('image API rereads exact snapshot and member hashes, returns only bounded raster bytes and no registration', async () => {
  const review = await (await archiveWorker(bytes, base, new AbortController().signal)).json(); assert.equal(review.status, 'success');
  const control = { ...base, action: 'image', expectedPackageSha256: review.capture.packageSha256, imageMember: member };
  const response = await archiveWorker(bytes, control, new AbortController().signal);
  assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('x-scan-registration'), 'unregistered');
  assert.equal(response.headers.get('x-scan-sha256'), hash(png)); assert.equal(response.headers.get('x-scan-source-sha256'), hash(bytes));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  for (const change of [{ expectedArchiveSha256: '0'.repeat(64) }, { expectedPackageSha256: '0'.repeat(64) }, { imageMember: '../Invented.png' }, { imageMember: syntheticSelection.masterMember }]) {
    const refused = await (await archiveWorker(bytes, { ...control, ...change }, new AbortController().signal)).json(); assert.equal(refused.status, 'blocked');
  }
  const form = new FormData(); form.set('file', new File([bytes], 'synthetic.zip'));
  for (const [key, value] of Object.entries(control)) form.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
  form.append('imageMember', member);
  const duplicate = await POST(new Request('http://127.0.0.1:3210/api/archive', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3210', Host: '127.0.0.1:3210' }, body: form }));
  assert.equal(duplicate.status, 400); assert.match((await duplicate.json()).message, /missing, duplicated or unknown/);
});

test('image catalog binds exact source/Master selection and exposes TIFF hold without decoding all assets', async () => {
  const review = await (await archiveWorker(bytes, base, new AbortController().signal)).json();
  const control = { ...base, action:'image-catalog', expectedPackageSha256:review.capture.packageSha256 };
  const catalog = await (await archiveWorker(bytes,control,new AbortController().signal)).json();
  assert.equal(catalog.entries.length,3);assert.equal(catalog.sourceSha256,hash(bytes));assert.equal(catalog.registration,'unregistered');
  assert.equal(catalog.entries.find(e=>e.role==='pattern-model').preview,'held');
  const ref=await archiveWorker(bytes,{...control,action:'image',imageMember:'Fictional/Master/PartImage/AUTHORED.png'},new AbortController().signal);
  assert.deepEqual(Buffer.from(await ref.arrayBuffer()),png);
  for(const change of [{expectedPackageSha256:'0'.repeat(64)},{expectedArchiveSha256:'0'.repeat(64)}]) assert.equal((await (await archiveWorker(bytes,{...control,...change},new AbortController().signal)).json()).status,'blocked');
});
