import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeProject } from '../../lib/scan/project-session';
import { emptyVisualWorkspace } from '../../lib/scan/visual-workspace';
// All geometry, codes and colored raster pixels below are independently authored.
function png(width: number, height: number) {
  function chunk(tag: string, raw: Buffer) {
    const bytes = Buffer.concat([Buffer.from(tag), raw]); let crc = 0xffffffff;
    for (const b of bytes) { crc ^= b; for (let k=0;k<8;k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(raw.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size,bytes,checksum]);
  }
  const pixels=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) { const n=y*(width*3+1)+1+x*3; const patch=x>width*.15 && x<width*.85 && ((y>height*.1 && y<height*.4)||(y>height*.6 && y<height*.9)); pixels[n]=patch?27:8;pixels[n+1]=patch?112:28;pixels[n+2]=patch?73:42; }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const panel=png(6400,4000), model=png(200,120), member='Fictional/Board/SYNTHETIC-panel.png';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(population=2) {
  const part=(i:number)=>`<PartData><ID>${i}</ID><ParentId>${i===2?'2':'1'}</ParentId><RefID>${i<=2?'TEST1':`TEST${i}`}</RefID><MasterKey>90</MasterKey><PartCode>AUTHORED-ALPHA</PartCode><ENABLE>1</ENABLE><Roi><cx>${10+i%70}</cx><cy>${20+Math.floor(i/70)}</cy><w>1</w><h>2</h><a>0</a></Roi></PartData>`;
  const job=`<JobContainer><JobXmlVersion>10.1</JobXmlVersion><ModuleDataList><ModuleData><ID>1</ID></ModuleData><ModuleData><ID>2</ID></ModuleData></ModuleDataList><PartDataList>${Array.from({length:population},(_,i)=>part(i+1)).join('')}</PartDataList><WindowDataList /></JobContainer>`;
  const master='<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList><PartData><MasterKey>90</MasterKey><PartCode>AUTHORED-ALPHA</PartCode></PartData></PartDataList><WindowDataList /></JobContainer>';
  const members:Record<string,Buffer>={'Fictional/Board/Board.xml':Buffer.from(job),'Fictional/Master/Master.xml':Buffer.from(master),[member]:panel,'Fictional/Master/PartImage/AUTHORED-ALPHA.png':model,'Fictional/Master/PatternModel/opaque.tif':Buffer.from('II*\0'),'Fictional/Board/bad.jpg':Buffer.from('<svg/>'),'Fictional/Board/truncated.png':panel.subarray(0,33)};
  const python=path.join(process.cwd(),'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const result=spawnSync(python,['-c','import io,json,base64,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for n,v in json.loads(sys.stdin.read()).items():z.writestr(n,base64.b64decode(v))\nsys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(Object.fromEntries(Object.entries(members).map(([k,b])=>[k,b.toString('base64')]))),maxBuffer:20_000_000});
  if(result.status!==0) throw Error('Authored ZIP generation failed');
  return {bytes:result.stdout,selection:{root:'Fictional/Board',jobMember:'Fictional/Board/Board.xml',jobRole:'main' as const,masterMember:'Fictional/Master/Master.xml',masterRole:'main' as const}};
}
async function load(page:import('@playwright/test').Page,population=2) {
  const f=fixture(population), view=emptyVisualWorkspace();view.frame='native';
  const project=await encodeProject({placement:null,gerber:null,original:{file:new File([new Uint8Array(f.bytes)],'SYNTHETIC-images.zip'),selection:f.selection,draft:{root:f.selection.root,job:JSON.stringify({member:f.selection.jobMember,role:"main"}),master:JSON.stringify({member:f.selection.masterMember,role:"main"})}},returned:null,notes:{},machineVersion:'',visualWorkspace:view});
  await page.goto('/workspace');await page.getByLabel('Saved placement review file').setInputFiles({name:'SYNTHETIC.scan-project.json',mimeType:'application/json',buffer:Buffer.from(await project.arrayBuffer())});
  await expect(page.getByRole('status').filter({hasText:'Project reopened.'})).toBeVisible({timeout:60000});return f;
}
test('image-first: high-resolution pixels, exact model reference, unregistered boundary, saved view and read-only replay',async({page},info)=>{
  test.setTimeout(120000); const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=await load(page);
  const canvas=page.getByRole('img',{name:'Interactive board canvas'});
  await expect(canvas.locator('[data-ref]')).toHaveCount(1);
  await page.getByLabel('Search component references').fill('TEST1');await page.getByLabel('Search component references').press('Enter');
  await page.getByRole('button',{name:'Reference image',exact:true}).click();
  await expect(page.getByTestId('model-reference-photo')).toBeVisible({timeout:60000});
  await expect(page.getByLabel('Component image evidence')).toContainText('Reference/model image — not this board capture');
  await expect(page.getByLabel('Component image evidence')).toContainText('Exact MasterKey and PartCode');
  await page.screenshot({path:info.outputPath('SYNTHETIC-exact-model-reference.png'),fullPage:true});
  await page.getByRole('button',{name:'On-board detail',exact:true}).click();await expect(page.getByText('On-board crop — registration required',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Photo gallery',exact:true}).click();
  await expect(page.getByLabel('Eagle image gallery')).toContainText('5 assets');
  await expect(page.getByRole('button',{name:/View opaque.tif/})).toBeDisabled();await expect(page.getByRole('button',{name:/View bad.jpg/})).toBeDisabled();
  const imageRequests:string[]=[];page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/archive'))imageRequests.push(r.url());});
  await page.getByRole('button',{name:/View SYNTHETIC-panel.png/}).click();
  await expect(page.getByTestId('preserved-scan-image')).toBeVisible({timeout:60000});
  await expect(page.getByTestId('preserved-scan-image')).toHaveAttribute('width','6400');await expect(page.getByTestId('preserved-scan-image')).toHaveAttribute('data-image-sha256',sha(panel));
  await expect(canvas.locator('[data-ref],[data-cad-key],[data-testid="component-processing-ring"]')).toHaveCount(0);await expect(page.getByText('Pixel view — not registered',{exact:false})).toBeVisible();
  await expect(page.getByRole('img',{name:'Image viewport overview'})).toBeVisible();
  await page.getByRole('button',{name:'100% pixels',exact:true}).click();const photoView=await canvas.getAttribute('viewBox');
  const width=Number(photoView!.split(' ')[2]),size=(await canvas.boundingBox())!;expect(width).toBeCloseTo(size.width,0);
  await page.getByLabel('Image opacity').fill('0.7');await page.getByLabel('Display brightness').fill('1.2');
  await page.getByRole('button',{name:'Bookmark visible pixel region',exact:true}).click();await expect(page.getByRole('img',{name:'Unregistered manual pixel note'})).toBeVisible();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const saved=await readFile((await(await downloading).path())!);const data=JSON.parse(saved.toString());
  expect(data.archives.original.source.sha256).toBe(sha(f.bytes));expect(data.visualWorkspace.image.member).toBe(member);expect(data.visualWorkspace.imageDisplay.opacity).toBe(.7);expect(data.visualWorkspace.imageDisplay.note.label).toBe('Unregistered image note');expect(data.visualWorkspace.selected).not.toBe('');
  await page.screenshot({path:info.outputPath('SYNTHETIC-full-resolution-pixel-view.png'),fullPage:true});
  expect(imageRequests.length).toBe(1);
  await page.getByRole('button',{name:'Recorded replay',exact:true}).click();await page.getByLabel('Recorded event position').fill('0');const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});await page.getByRole('button',{name:'Next recorded event',exact:true}).click();await page.waitForTimeout(300);expect(posts).toEqual([]);
  await page.getByRole('button',{name:'Exit replay',exact:true}).click();await expect(page.getByLabel('Coordinate view')).toHaveValue('image');await expect(canvas).toHaveAttribute('viewBox',photoView!);
  await page.reload();await page.getByLabel('Saved placement review file').setInputFiles({name:'SYNTHETIC-reopen.json',mimeType:'application/json',buffer:saved});
  await expect(page.getByRole('status').filter({hasText:'Project reopened.'})).toBeVisible({timeout:60000});await expect(page.getByTestId('preserved-scan-image')).toBeVisible({timeout:60000});await expect(canvas).toHaveAttribute('viewBox',photoView!);
  await page.getByRole('button',{name:'Native coordinates',exact:true}).click();await expect(canvas.locator('[data-ref]')).toHaveCount(1);await expect(canvas.locator('[data-ref]')).toHaveAttribute('data-x','11');
  await page.getByLabel('Canvas module and side').selectOption('["2","native side unqualified"]');await expect(canvas.locator('[data-ref]')).toHaveCount(1);await expect(canvas.locator('[data-ref]')).toHaveAttribute('data-x','12');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('selected malformed raster fails decode; 3000 native records survive photography toggles',async({page})=>{
  test.setTimeout(120000);await load(page,3000);const canvas=page.getByRole('img',{name:'Interactive board canvas'});await expect(canvas.locator('[data-ref]')).toHaveCount(2999);
  await page.getByRole('button',{name:'Photo gallery',exact:true}).click();await page.getByRole('button',{name:/View truncated.png/}).click();
  await expect(page.getByRole('alert').filter({hasText:/decode|decoded|source image/i})).toBeVisible({timeout:60000});await expect(page.getByTestId('preserved-scan-image')).toHaveCount(0);await expect(canvas.locator('[data-ref]')).toHaveCount(0);
  await page.route('**/api/archive',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'x-scan-source-sha256':'0'.repeat(64)}});},{times:1});
  await page.getByRole('button',{name:/View SYNTHETIC-panel.png/}).click();await expect(page.getByRole('alert').filter({hasText:'Image provenance differs'})).toBeVisible({timeout:60000});await expect(page.getByTestId('preserved-scan-image')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry selected image',exact:true}).click();await expect(page.getByTestId('preserved-scan-image')).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Native coordinates',exact:true}).click();await expect(canvas.locator('[data-ref]')).toHaveCount(2999);await expect(page.getByTestId('native-total').locator('strong')).toHaveText('3000');
});
