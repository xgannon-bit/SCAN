import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArchiveSourceRead } from '../lib/scan/archive-source-read.ts';
const form=()=>{const f=new FormData();f.set('action','inventory');f.set('file',new File(['AUTHORED'],'SYNTHETIC.zip'));return f;};
test('only identified worker contention on source reads is retried; source bodies and abort signals stay exact',async()=>{
  const f=form(),signal=new AbortController().signal;let calls=0;
  const response=await fetchArchiveSourceRead(f,signal,async(url,options)=>{assert.equal(options.body,f);assert.equal(options.signal,signal);return ++calls===1?Response.json({code:'WORKER_BUSY'},{status:429}):Response.json({status:'success'});});assert.equal(calls,2);assert.equal((await response.json()).status,'success');
  for(const [status,code] of [[400,'STALE_SOURCE'],[503,'WORKER_FAILED'],[429,'OTHER']]){let n=0;await fetchArchiveSourceRead(form(),signal,async()=>{n++;return Response.json({code},{status});});assert.equal(n,1);}
  const write=form();write.set('action','repair-export');await assert.rejects(fetchArchiveSourceRead(write,signal),/Only source reads/);
});
test('cancelled wait never sends an old source again',async()=>{const a=new AbortController();let calls=0;const pending=fetchArchiveSourceRead(form(),a.signal,async()=>{calls++;setTimeout(()=>a.abort(),10);return Response.json({code:'WORKER_BUSY'},{status:429});});await assert.rejects(pending);assert.equal(calls,1);});
