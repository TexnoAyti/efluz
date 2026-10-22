// Optional rendered UI audit; uses a local Vite server and synthetic accounts only.
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const moduleName=process.env.EFL_PLAYWRIGHT_MODULE||(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
const {chromium}=await import(moduleName);
const output=process.env.EFL_UI_QA_DIR||path.join(tmpdir(),'efluz-ui-review');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Vite readiness timeout')),15000);server.stdout.on('data',s=>{if(String(s).includes('Local:')){clearTimeout(timer);resolve();}});server.on('exit',code=>reject(Error('Vite exited '+code)));});
process.on('exit',()=>server.kill());
const browser=await chromium.launch({executablePath:process.env.EFL_CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
fs.mkdirSync(output,{recursive:true});
const context=await browser.newContext();let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const reports=[];
for(const width of [320,360,390,768,1280])for(const theme of ['light','dark'])for(const tab of ['overview','fixtures','bracket','participants','results','standings']){
 await page.setViewportSize({width,height:844});
 await page.goto(`http://127.0.0.1:5173/src/server/tests/uzeflifeBrowserFixture.html?tab=${tab}&theme=${theme}`);
 await page.locator('.uzeflife .efl-league-tabs').waitFor();await page.evaluate(()=>document.fonts.ready);
 const geometry=await page.evaluate(()=>({pageWidth:innerWidth,contentWidth:document.documentElement.scrollWidth,tabs:[...document.querySelectorAll('.uzeflife .efl-league-tabs button')].map(el=>({label:el.textContent,width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height),textWidth:el.querySelector('span').scrollWidth,available:el.querySelector('span').clientWidth})),cards:document.querySelectorAll('.competition-fixture-card').length,rows:document.querySelectorAll('tbody tr,.u-participant').length,offscreen:[...document.querySelectorAll('main > .uzeflife > *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>el.className)}));
 assert.ok(geometry.contentWidth<=width+1,`${width}/${theme}/${tab}: page overflow ${geometry.contentWidth}`);
 assert.ok(geometry.tabs.every(t=>t.height>=44&&t.height<=80&&t.width>=70),`${width}/${theme}/${tab}: squeezed tabs ${JSON.stringify(geometry.tabs)}`);
 assert.ok(geometry.tabs.every(t=>t.textWidth<=t.available+1),`${width}/${theme}/${tab}: clipped tab label`);
 assert.equal(geometry.offscreen.length,0,`${width}/${tab}: root section offscreen`);
 if(tab==='fixtures')assert.equal(geometry.cards,8,'Fixture pages stay compact');
 if(['participants','standings'].includes(tab))assert.equal(geometry.rows,20,'Long lists are paginated');
 reports.push({width,theme,tab,...geometry});
 if(width===320&&theme==='light'&&['overview','fixtures','bracket','standings'].includes(tab))await page.screenshot({path:path.join(output,`after-${tab}-${width}.png`),fullPage:true});
 if(tab==='participants'){
  await page.getByRole('button',{name:'Keyingi',exact:true}).click();assert.equal(await page.locator('.u-participant').count(),20);
  await page.getByRole('searchbox').fill('topilmaydiganism');await page.getByText('Nomi bo‘yicha ishtirokchi topilmadi.').waitFor();
 }
 if(tab==='bracket'){
  await page.getByRole('combobox',{name:'UZEFLIFE setkasini tanlash'}).selectOption('8');assert.equal(await page.locator('.u-tree-match').count(),31);
  await page.getByRole('button',{name:'Final bosqichi',exact:true}).click();assert.equal(await page.locator('.u-tree-match').count(),7);
 }
}
// Start modal/administrator interactions in a fresh page after the viewport matrix.
await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.setViewportSize({width:320,height:640});await page.goto('http://127.0.0.1:5173/src/server/tests/uzeflifeBrowserFixture.html?tab=fixtures');await page.locator('.competition-fixture-teams').first().click();
const dialog=page.getByRole('dialog');await dialog.waitFor();await page.getByRole('button',{name:'Natijani tasdiqlash',exact:true}).click();
assert.ok(await dialog.locator('input[name=home]').isVisible());await dialog.locator('input[name=home]').fill('2');await dialog.locator('input[name=away]').fill('2');await dialog.locator('summary').filter({hasText:'Durang'}).click();
assert.ok(await dialog.locator('input[name=penaltyHome]').isVisible());
await page.screenshot({path:path.join(output,'after-dialog-320.png'),fullPage:false});
const dr=await dialog.boundingBox();assert.ok(dr.x>=0&&dr.x+dr.width<=320&&dr.y>=0&&dr.y+dr.height<=641,'Dialog stays inside mobile viewport');await page.getByRole('button',{name:'O‘yinni yopish'}).click();
await page.getByRole('button',{name:'Turnir boshqaruvi',exact:true}).click();
for(const name of ['Turnir','Ishtirokchilar','O‘yinlar','Majburiy obuna','Adminlar','E’lonlar']){
 await page.getByRole('navigation',{name:'Turnir boshqaruvi bo‘limlari'}).getByRole('button',{name,exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Admin section page overflow');
}
await page.screenshot({path:path.join(output,'after-admin-320.png'),fullPage:true});
assert.equal(errors.length,0,JSON.stringify(errors));
fs.writeFileSync(path.join(output,'after.json'),JSON.stringify(reports,null,2));console.log(`PASS ${reports.length} rendered viewport/theme/tab combinations, shared league match/standings UI, pagination/search, 8-setka/final navigation, result dialog and all administration sections; no page overflow or runtime errors.`);await browser.close();server.kill();
