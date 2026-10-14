import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageCatalog, assetRole, referenceForPlacement } from '../lib/scan/image-evidence.ts';
import { emptyVisualWorkspace, validateVisualWorkspace, nativeEntities } from '../lib/scan/visual-workspace.ts';
const h=d=>d.repeat(64);
function fixture() {
  const selection={root:'Invented/Board',job:{member:'Invented/Board/Board.xml',role:'main',sha256:h('b'),size:100},master:{member:'Invented/Master/Master_Temp.xml',role:'temp',sha256:h('c'),size:100}};
  const part={kind:'part-record',sourcePath:'JobContainer/PartDataList/PartData[1]',rawFields:{ParentId:['1'],RefID:['TEST1'],ID:['17'],MasterKey:['89'],PartCode:['FICTIONAL-PACKAGE'], 'Roi/cx':['5'],'Roi/cy':['8']}};
  const model={kind:'part-record',sourcePath:'JobContainer/PartDataList/PartData[2]',rawFields:{MasterKey:['89'],PartCode:['FICTIONAL-PACKAGE']}};
  const doc=records=>({status:'recorded',readerProfile:'jobcontainer-10.1-observed-readonly-1',schemaVersionClaim:'10.1',records});
  const asset={member:'Invented/Master/PartImage/FICTIONAL-PACKAGE.png',sha256:h('d'),size:100,role:'model-reference',width:120,height:60,mime:'image/png',preview:'supported-header',reason:'Header only',dimensionEvidence:'raster-header-only'};
  const p={status:'success',source:{sha256:h('a')},packageSha256:h('e'),snapshotId:'authored',selection,integrity:{status:'verified-against-capture-hash',allArchivedFilesVerified:true},preservedFiles:[{originalName:asset.member,size:100,sha256:h('d')}],nativeRecords:{job:doc([part]),master:doc([model])}};
  const catalog={status:'success',artifactType:'scan.image-catalog',schemaVersion:'1',sourceSha256:h('a'),packageSha256:h('e'),snapshotId:'authored',selection,entries:[asset],omittedAssets:0,registration:'unregistered',machineExportAllowed:false};
  return {p,catalog,entity:nativeEntities(p)[0]};
}
test('source-bound catalog and exact scoped Master image correspondence; no geometry or instance authority',()=>{
  const {p,catalog,entity}=fixture(), before=structuredClone(p);
  assert.equal(validateImageCatalog(catalog,p),catalog);
  const linked=referenceForPlacement(p,catalog,entity);assert.equal(linked.asset,catalog.entries[0]);assert.match(linked.reason,/unqualified/);
  assert.deepEqual(p,before);assert.equal(assetRole('Invented/Board/UV_Module2.png',p.selection),'board-candidate');assert.equal(catalog.registration,'unregistered');
  assert.equal(assetRole('Other/Master/PartImage/FICTIONAL-PACKAGE.png',p.selection),null);
});
test('catalog rejects stale source/snapshot/hash/roles, duplicate members, oversize and false registration',()=>{
  const {p,catalog}=fixture();
  for(const change of [{sourceSha256:h('f')},{packageSha256:h('f')},{snapshotId:'stale'},{registration:'verified'},{entries:[catalog.entries[0],catalog.entries[0]]},{omittedAssets:-1}]) assert.throws(()=>validateImageCatalog({...catalog,...change},p));
  for(const change of [{role:'board-candidate'},{sha256:h('f')},{width:40000,height:40000},{size:32_000_001},{member:'Invented/Master/PartImage/../Other.png'}]) assert.throws(()=>validateImageCatalog({...catalog,entries:[{...catalog.entries[0],...change}]},p));
});
test('reference holds duplicate Master/placement, wrong instance, conflicting code, missing or ambiguous assets and unsupported schema',()=>{
  const mutate=[
    p=>p.nativeRecords.master.records.push(structuredClone(p.nativeRecords.master.records[0])),
    p=>p.nativeRecords.job.records.push(structuredClone(p.nativeRecords.job.records[0])),
    p=>p.nativeRecords.job.records[0].rawFields.ParentId=['2'],
    p=>p.nativeRecords.master.records[0].rawFields.PartCode=['DIFFERENT'],
    p=>p.nativeRecords.master.records[0].rawFields.PartCode=['../FICTIONAL-PACKAGE'],
    p=>p.nativeRecords.job.records[0].rawFields.PartCode=['FICTIONAL-PACKAGE','DIFFERENT'],
    p=>p.nativeRecords.master.schemaVersionClaim='99',
  ];
  for(const alter of mutate){const {p,catalog,entity}=fixture();alter(p);assert.equal(referenceForPlacement(p,catalog,entity).asset,null);}
  const {p,catalog,entity}=fixture();assert.equal(referenceForPlacement(p,{...catalog,sourceSha256:h('f')},entity).asset,null);
  assert.equal(referenceForPlacement(p,{...catalog,entries:[]},entity).asset,null);
  assert.equal(referenceForPlacement(p,{...catalog,entries:[catalog.entries[0],{...catalog.entries[0],member:'Invented/Master/PartImage/FICTIONAL-PACKAGE.jpg'}]},entity).asset,null);
});
test('optional saved image presentation remains presentation only; no saved mapping or RefID crop authority',()=>{
  const v=emptyVisualWorkspace();assert.equal(validateVisualWorkspace(v),v);
  v.image={archiveSha256:h('a'),member:'Invented/Board/whole.png'};
  v.imageDisplay={preset:'clean-image',role:'board-candidate',opacity:.7,brightness:1.2,referenceOpen:true,note:{archiveSha256:h('a'),member:v.image.member,imageSha256:h('d'),x:10,y:20,width:300,height:200,label:'Unregistered image note'}};
  assert.deepEqual(validateVisualWorkspace(JSON.parse(JSON.stringify(v))),v);
  for(const change of [{opacity:2},{brightness:9},{registration:'verified'},{note:{...v.imageDisplay.note,RefID:'TEST1'}},{note:{...v.imageDisplay.note,x:-1}}]) assert.throws(()=>validateVisualWorkspace({...v,imageDisplay:{...v.imageDisplay,...change}}));
});
