// Entirely authored geometry, pixels and native-like XML. No manufacturing data.
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { authoredDiagnosis } from './native-diagnosis-fixture.mjs';
import { archiveWorker } from '../lib/scan/archive-worker.ts';
import { acceptImageReview, imageRequestFingerprint, newImageRegistration, nativeImageControl, nativeImageBounds } from '../lib/scan/image-registration.ts';
export const sha = b => createHash('sha256').update(b).digest('hex');
export function authoredPng(width=1600,height=1000,features=[[100,100],[900,100],[100,700],[900,700],[500,400]]) {
  function chunk(tag,raw) { const bytes=Buffer.concat([Buffer.from(tag),raw]);let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(raw.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,bytes,checksum]); }
  const pixels=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {const n=y*(width*3+1)+1+x*3,land=features.some(([cx,cy])=>Math.abs(x-cx)<12&&Math.abs(y-cy)<12),board=x>60&&x<950&&y>60&&y<750,grid=x%100===0||y%100===0;pixels[n]=land?220:board?grid?32:16:7;pixels[n+1]=land?190:board?grid?105:65:20;pixels[n+2]=land?90:board?grid?90:48:32;}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export function authoredImageFixture(tag='A') {
  const positions=[[0,0],[40,0],[0,30],[40,30],[20,15],[8,9]],refs=['FIT_A','FIT_B','FIT_C','CHECK_D','VIEW_E','FIT_A'];
  const parts=positions.map(([x,y],i)=>`<PartData><ID>${i+1}</ID><ParentId>${i===5?2:1}</ParentId><RefID>${refs[i]}</RefID><MasterKey>90</MasterKey><PartCode>AUTHORED-MODEL</PartCode><ENABLE>1</ENABLE><Roi><cx>${x}</cx><cy>${y}</cy><w>2</w><h>3</h><a>${i===4?33:0}</a></Roi><Opaque>${tag}</Opaque></PartData>`).join('');
  const job=`<JobContainer><JobXmlVersion>10.1</JobXmlVersion><ModuleDataList><ModuleData><ID>1</ID></ModuleData><ModuleData><ID>2</ID></ModuleData></ModuleDataList><PartDataList>${parts}</PartDataList><WindowDataList /></JobContainer>`,master='<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList><PartData><MasterKey>90</MasterKey><PartCode>AUTHORED-MODEL</PartCode></PartData></PartDataList><WindowDataList /></JobContainer>',member='Fictional/Board/SYNTHETIC-grid.png',raster=authoredPng();
  const selection={root:'Fictional/Board',jobMember:'Fictional/Board/Board.xml',jobRole:'main',masterMember:'Fictional/Master/Master.xml',masterRole:'main'};
  const members={[selection.jobMember]:Buffer.from(job),[selection.masterMember]:Buffer.from(master),[member]:raster,'Fictional/Master/PartImage/AUTHORED-MODEL.png':authoredPng(200,120),'Fictional/Board/Board_Temp.xml':Buffer.from('<DistinctTemp />'),'Fictional/Board/Board.xml.bak':Buffer.from('<DistinctBackup />'),'README.txt':Buffer.from('SYNTHETIC image registration; no machine qualification.')};
  const python=path.join(process.cwd(),'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),made=spawnSync(python,['-c','import io,json,sys,zipfile,base64\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,v in json.loads(sys.stdin.read()).items():z.writestr(zipfile.ZipInfo(n,(1980,1,1,0,0,0)),base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(Object.fromEntries(Object.entries(members).map(([k,b])=>[k,b.toString('base64')]))),maxBuffer:20_000_000});
  if(made.status!==0)throw Error('Authored fixture failed');return {bytes:made.stdout,selection,image:{member,sha256:sha(raster),width:1600,height:1000},raster};
}
export async function authoredMapping(f=authoredImageFixture()) {
  const review=await(await archiveWorker(f.bytes,{action:'preflight',selection:f.selection,expectedArchiveSha256:sha(f.bytes)},new AbortController().signal)).json();
  if(review.status!=='success')throw Error(JSON.stringify(review));const p=review.preflight,state=newImageRegistration(p,f.image),r=state.request;
  r.scope={module:'1',physicalSide:'top',instance:'SYNTHETIC-A',nativeRevision:'AUTHORED-1',imageRevision:'AUTHORED-1'};
  r.conventions={module:'1',physicalSide:'top',instance:'SYNTHETIC-A',unit:'mm',yDirection:'down',roiAngle:'clockwise',anchor:'native-roi-center',distortion:'uniform-similarity',evidence:'SYNTHETIC authored axes, ROI center and uniform pixel rendering, no lens.'};
  r.nativeBounds=nativeImageBounds(p,'1');const records=p.nativeRecords.job.records.filter(x=>x.kind==='part-record'&&x.rawFields.ParentId?.[0]==='1');
  r.points=r.points.map((pt,i)=>({...nativeImageControl(p,records[i].sourcePath,pt),pixel:[[100,100],[900,100],[100,700],[900,700]][i],evidence:'SYNTHETIC exact rendered native ROI feature.'}));
  r.tolerancePx=.5;r.toleranceEvidence='SYNTHETIC exact pixel construction, tolerance below one pixel.';r.scopeEvidence='SYNTHETIC revision/side/module instance authored together.';r.reviewer='SYNTHETIC test reviewer';return {fixture:f,review,state};
}

export async function authoredProcessingMapping() {
  const d=authoredDiagnosis(),controls=[[0,0],[40,0],[0,30],[40,30]],insert=controls.map(([x,y],i)=>`<PartData><ID>${200+i}</ID><ParentId>1</ParentId><RefID>CTRL_${i}</RefID><MasterKey>88</MasterKey><ENABLE>0</ENABLE><Roi><cx>${x}</cx><cy>${y}</cy><w>1</w><h>1</h><a>0</a></Roi></PartData>`).join('');
  const image={member:'Fictional/Board/SYNTHETIC-processing.png',width:1600,height:1000},raster=authoredPng(1600,1000,[...controls,[12,17],[17.2,-14.7]].map(([x,y])=>[20*x+300,-20*y+600]));image.sha256=sha(raster);
  const members={...Object.fromEntries(Object.entries(d.members).map(([k,v])=>[k,Buffer.from(v)])),[d.selection.jobMember]:Buffer.from(d.job.replace('</PartDataList>',insert+'</PartDataList>')),[image.member]:raster};
  const python=path.join(process.cwd(),'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),made=spawnSync(python,['-c','import io,json,sys,zipfile,base64\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,v in json.loads(sys.stdin.read()).items():z.writestr(zipfile.ZipInfo(n,(1980,1,1,0,0,0)),base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(Object.fromEntries(Object.entries(members).map(([k,b])=>[k,b.toString('base64')]))),maxBuffer:20_000_000});
  if(made.status!==0)throw Error('Authored processing ZIP failed');const f={bytes:made.stdout,selection:d.selection,image,raster},review=await(await archiveWorker(f.bytes,{action:'preflight',selection:f.selection,expectedArchiveSha256:sha(f.bytes)},new AbortController().signal)).json(),p=review.preflight,state=newImageRegistration(p,image),r=state.request;
  r.scope={module:'1',physicalSide:'top',instance:'SYNTHETIC-LIVE',nativeRevision:'AUTHORED-LIVE',imageRevision:'AUTHORED-LIVE'};r.conventions={module:'1',physicalSide:'top',instance:'SYNTHETIC-LIVE',unit:'mm',yDirection:'up',roiAngle:'counterclockwise',anchor:'native-roi-center',distortion:'uniform-similarity',evidence:'SYNTHETIC authored native ROI axes and raster rendering.'};r.nativeBounds=nativeImageBounds(p,'1');
  r.points=r.points.map((pt,i)=>({...nativeImageControl(p,p.nativeRecords.job.records.find(x=>x.kind==='part-record'&&x.rawFields.RefID?.[0]===`CTRL_${i}`).sourcePath,pt),pixel:[20*controls[i][0]+300,-20*controls[i][1]+600],evidence:'SYNTHETIC independently rendered same-feature control.'}));r.tolerancePx=.5;r.toleranceEvidence='SYNTHETIC exact pixel construction, below one pixel.';r.scopeEvidence='SYNTHETIC capture/revision/physical side/instance authored together.';r.reviewer='SYNTHETIC fixture reviewer';const bound=acceptImageReview(state,await imageRequestFingerprint(r));return {fixture:f,review,state:bound,diagnosis:d};
}
