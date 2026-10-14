import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeProject } from '../../lib/scan/project-session';
import { authoredDiagnosis } from '../native-diagnosis-fixture.mjs';
import type { ArchiveSelection } from '../../lib/scan/archive-types';

test('real worker activity, cancellation, static results, replay return and reduced motion remain distinct', async ({page},info)=>{
  test.setTimeout(120_000);
  const fixture=authoredDiagnosis(), context=fixture.context, selection=fixture.selection as ArchiveSelection;
  const project=await encodeProject({placement:{file:new File([fixture.placement],'SYNTHETIC-activity.csv'),settings:{config:context.placementConfig.config,sheetIndex:0,delimiter:',',validated:true,selectedRow:null,notes:{}}},layout:{file:new File([fixture.pcb],'SYNTHETIC-activity.pcb'),checked:true},bom:{file:new File([fixture.bom],'SYNTHETIC-BOM.csv'),config:context.bomConfig.config,sheet:0,delimiter:',',checked:true},original:{file:new File([new Uint8Array(fixture.archive)],'SYNTHETIC-native.zip'),selection,draft:{root:selection.root,job:JSON.stringify({role:selection.jobRole,member:selection.jobMember}),master:JSON.stringify({role:selection.masterRole,member:selection.masterMember})}},returned:null,gerber:null,notes:{},machineVersion:'',nativeDiagnosis:{settings:context.settings,reviewer:'Synthetic activity test'},nativePreparation:{review:null,reviewer:'',history:[],packageProfiles:context.packageProfiles}});
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/workspace');
  await page.getByLabel('Saved placement review file',{exact:true}).setInputFiles({name:'SYNTHETIC-live.json',mimeType:'application/json',buffer:Buffer.from(await project.arrayBuffer())});
  await expect(page.getByRole('status').filter({hasText:'Project reopened.'})).toBeVisible();
  await page.getByLabel('Coordinate view').selectOption('native');
  const canvas=page.getByRole('img',{name:'Interactive board canvas'});
  const before=await canvas.locator('[data-ref]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('data-entity-key'),n.getAttribute('data-x'),n.getAttribute('data-y')]));
  // Delay only the test transport: all geometry/events below come from the real worker.
  // This makes genuine in-flight events observable without slowing the production engine.
  let hold=true, release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/archive',async route=>{
    if(route.request().postData()?.includes('placement-diagnosis')){
      try{const response=await route.fetch(); if(hold)await gate; await route.fulfill({response});}catch{try{await route.abort();}catch{}}
    }else await route.continue();
  });
  await page.route('**/api/archive/progress',async route=>{
    // APIRequestContext does not supply the browser's same-origin fetch metadata.
    const response=await route.fetch({headers:{...route.request().headers(),origin:new URL(route.request().url()).origin}}), value=await response.json();
    if(hold&&Array.isArray(value.events)&&value.events.length) value.events=value.events.slice(0,1);
    await route.fulfill({response,json:value});
  });
  await page.getByRole('button',{name:'Analyze on board',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-component-display','live');
  const ring=page.getByTestId('component-processing-ring').first(); await expect(ring).toBeVisible();
  expect(await ring.evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
  await expect(page.getByTestId('component-display-mode')).toContainText('Live activity');
  await page.screenshot({path:info.outputPath('SYNTHETIC-real-inflight-reduced-motion.png'),fullPage:true});
  await page.getByRole('button',{name:'Cancel analysis',exact:true}).click(); hold=false; release();
  await expect(page.getByTestId('component-processing-ring')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-component-display','off');
  await expect(page.getByTestId('native-analyzed').locator('strong')).toHaveText('0');
  await expect(page.getByLabel('Actual processing events')).toContainText('cancelled');
  await page.unroute('**/api/archive'); await page.unroute('**/api/archive/progress');
  await page.getByRole('button',{name:'Analyze on board',exact:true}).click();
  await expect(page.getByTestId('native-analyzed').locator('strong')).not.toHaveText('0');
  await expect(page.getByTestId('component-processing-ring')).toHaveCount(0);
  await expect(page.getByTestId('component-display-mode')).toContainText('highlights hidden');
  await page.getByRole('button',{name:'Show results of last run',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-component-display','results');
  await expect(page.getByTestId('component-display-mode')).toContainText('static event layer');
  await expect(page.getByTestId('component-processing-ring').first()).toBeVisible();
  await page.getByRole('button',{name:'Locate worker component',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Board inspector'}).getByRole('heading',{name:'N1',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('SYNTHETIC-completed-static-results.png'),fullPage:true});
  await page.getByRole('button',{name:'Hide results of last run',exact:true}).click();
  const downloading=page.waitForEvent('download'); await page.getByRole('button',{name:'Save project',exact:true}).click();
  const saved=JSON.parse((await readFile((await (await downloading).path())!)).toString());
  const position=saved.visualWorkspace.events.findIndex((e:any)=>e.componentPhase==='analysis-started'); expect(position).toBeGreaterThanOrEqual(0);
  await page.getByRole('button',{name:'Recorded replay',exact:true}).click(); await page.getByLabel('Recorded event position').fill(String(position));
  await expect(canvas).toHaveAttribute('data-component-display','replay');
  await expect(page.getByTestId('component-display-mode')).toContainText('Recorded historical');
  await page.getByRole('button',{name:'Return to live',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-component-display','off'); await expect(page.getByTestId('component-processing-ring')).toHaveCount(0);
  expect(await canvas.locator('[data-ref]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('data-entity-key'),n.getAttribute('data-x'),n.getAttribute('data-y')]))).toEqual(before);
  expect(saved.machineExportAllowed).toBe(false);
});
