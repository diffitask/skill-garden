// Run from repository root: node "$AIR_ARTIFACTS_DIR/explore.mjs"
// Deterministic GitHub transport and model response fixture; real scanner/server/UI.
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import fs from 'node:fs/promises';
const root=process.cwd();
const {chromium}=await import(pathToFileURL(root+'/node_modules/playwright/index.mjs'));
const {createWebServer}=await import(pathToFileURL(root+'/src/server.ts'));
const {replay}=await import(pathToFileURL(root+'/src/core/replay.ts'));
const {organizationFixture}=await import(pathToFileURL(root+'/tests/organization-fixture.ts'));
const dir=process.env.AIR_ARTIFACTS_DIR || root+'/red-evidence';
await fs.mkdir(dir,{recursive:true});
const recording=organizationFixture();
const server=createWebServer({github:{fetch:replay(recording)},pairingCode:'fixture-only',ask:async()=>{await new Promise(r=>setTimeout(r,1200));return {clusters:[{label:'Shared skills',skills:['s1','s2']}]};}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
const outcomes=[];
for(const variant of ['server','portable'])for(let attempt=1;attempt<=2;attempt++){
 const context=await browser.newContext({viewport:{width:1280,height:900},recordVideo:{dir,size:{width:1280,height:900}}});
 await context.route(/^https:\/\/(api.github.com|raw.githubusercontent.com)\//,async route=>{
 const item=recording[route.request().url()];if(!item)throw new Error('Unrecorded '+route.request().url());
 await route.fulfill({status:item.status,headers:{...item.headers,'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Link'},contentType:typeof item.body==='string'?'text/plain':'application/json',body:typeof item.body==='string'?item.body:JSON.stringify(item.body)});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(variant==='server'?url:pathToFileURL(root+'/skill-atlas.html').href);
 await page.locator('#repository').fill('https://github.com/Example');await page.locator('#scan').click();
 await page.waitForFunction(()=>!document.querySelector('#repository-form').hasAttribute('aria-busy'));
 const summary=await page.locator('#scan-summary').textContent();
 if(variant==='portable') {await page.locator('#ai-helper-url').fill(url);await page.locator('#ai-pairing-code').fill('fixture-only');}
 await page.locator('#filter-skills').fill('same-name');
 await page.locator('#ai-cluster').click();
 await page.locator('#filter-skills').fill('');
 await page.waitForFunction(()=>!document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
 await page.locator('#ai-clusters').scrollIntoViewIfNeeded();await page.waitForTimeout(700);
 const output={variant,attempt,browser:browser.version(),summary,shown:await page.locator('#count').textContent(),members:await page.locator('#ai-cluster-list button').allTextContents(),unclustered:await page.locator('#ai-unclustered').textContent(),status:await page.locator('#ai-status').textContent(),errors};
 // Narrowing to the skills that were omitted from the AI request should count both as unclustered.
 await page.locator('#filter-skills').fill('elsewhere');await page.locator('#clusters').scrollIntoViewIfNeeded();await page.waitForTimeout(1500);
 output.onlyOmitted={shown:await page.locator('#count').textContent(),unclustered:await page.locator('#ai-unclustered').textContent(),noClusters:await page.locator('#ai-no-clusters').isVisible()};
 await page.screenshot({path:`${dir}/ai-count-${variant}-${attempt}.png`,fullPage:true});
 await page.locator('#filter-skills').fill('');
 await page.locator('#skills button').first().click();await page.locator('#full-document').evaluate(el=>el.open=true);
 await page.locator('#filter-skills').fill('same-name'); output.retainsDocument=await page.locator('#full-document').evaluate(el=>el.open);
 await page.locator('#filter-skills').fill('elsewhere');output.collapsesDocument=!(await page.locator('#full-document').evaluate(el=>el.open));
 await page.locator('#filter-skills').fill('');await page.locator('#ai-cluster').click();
 await page.locator('#repository').fill('https://github.com/Example/alpha');await page.locator('#scan').click();
 await page.waitForFunction(()=>!document.querySelector('#repository-form').hasAttribute('aria-busy'));await page.waitForTimeout(1500);
 output.lateResponseIgnored=(await page.locator('#ai-cluster-list button').count())===0;
 await context.close();const video=await page.video().path();const videoName=`ai-count-${variant}-${attempt}.webm`;await fs.rename(video,`${dir}/${videoName}`);output.video=videoName;
 outcomes.push(output);console.log(JSON.stringify(output));
}
await fs.writeFile(dir+'/replay.json',JSON.stringify(recording,null,2));
await fs.writeFile(dir+'/explore-results.json',JSON.stringify(outcomes,null,2));
await browser.close();await new Promise(r=>server.close(r));
