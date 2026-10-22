import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium:pw}=require('playwright');
const root=path.resolve('.');
const browser=await pw.launch({headless:true, ...(process.env.EFL_PREVIEW_CHROMIUM ? {executablePath:process.env.EFL_PREVIEW_CHROMIUM} : {}), args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer', ...(process.env.EFL_PREVIEW_CHROMIUM ? ['--single-process','--no-zygote'] : [])]});
const origin='https://preview.efl.test';
const context=await browser.newContext({viewport:{width:390,height:844}});
const errors=[],network=[],blocked=[];
await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.origin!==origin){network.push(u.href);return route.abort();}
 if(u.pathname.startsWith('/_vercel/')) return route.fulfill({contentType:'application/javascript',body:''});
 if(u.pathname.startsWith('/api/')){blocked.push(u.pathname);return route.fulfill({status:403,contentType:'application/json',body:'{"error":"No backend in static package"}'});}
 const dir=process.env.PRODUCTION_TEST==='1'?'dist':'build/design-preview-site';
 let file=path.join(root,dir,decodeURIComponent(u.pathname));
 try{if(!(await stat(file)).isFile())throw 0;}catch{file=path.join(root,dir,'index.html');}
 const ext=path.extname(file); const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm'};
 return route.fulfill({contentType:types[ext]||'application/octet-stream',body:await readFile(file)});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
if(process.env.PRODUCTION_TEST==='1'){
 await page.goto(origin+'/?designPreview=1');
 await page.getByText('Bu turnir platformasi Telegram Mini App orqali ishlaydi. Davom etish uchun uni Telegram ichidan oching.').waitFor();
 assert.equal(await page.locator('main[data-preview-page]').count(),0);console.log('PASS production query flag keeps Telegram authentication wall');
}else{
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/','/leagues','/cups','/champions-league','/my-club','/clubs/club-arsenal']){
   await page.goto(origin+route+'?designPreview=1');
   await page.locator('main[data-preview-page]').waitFor();
   await page.waitForTimeout(650);
   assert.equal(await page.getByText('DESIGN PREVIEW · test ko‘rinishi').count(),0);
   assert.equal(await page.getByText('Something went wrong').count(),0);
   const expected = route === '/cups' ? 'Cup' : route === '/champions-league' ? 'UEFA' : route === '/leagues' ? 'Premier League' : route === '/' ? 'ARS' : 'Arsenal';
   await page.locator('main[data-preview-page]').getByText(expected,{exact:false}).first().waitFor();
   assert.ok((await page.locator('main[data-preview-page]').innerText()).includes(expected),route);
   console.log('PASS real component',width,route);
  }
 }
 await page.goto(origin+'/?designPreview=1');await page.locator('main[data-preview-page]').waitFor();
 await page.locator('details').filter({has:page.locator('summary', {hasText:'Design Preview'})}).locator('summary').click();
 await page.getByLabel('Preview page').selectOption('standings');await page.locator('main[data-preview-page]').waitFor();await page.getByRole('button',{name:'To‘liq',exact:true}).waitFor();
 assert.ok((await page.locator('main[data-preview-page]').innerText()).includes('Arsenal'));
 console.log('PASS panel -> populated Premier League standings');
 await page.locator('summary').filter({hasText:'Design Preview'}).click();await page.getByLabel('Preview page').selectOption('fixtures');await page.waitForURL('**/*previewPage=fixtures*');await page.locator('main[data-preview-page]').waitFor();await page.getByText('Arsenal',{exact:true}).first().waitFor();console.log('PASS fixtures page navigation');
 await page.locator('summary').filter({hasText:'Design Preview'}).click();await page.getByLabel('Preview page').selectOption('uzeflife');await page.waitForURL('**/*previewPage=uzeflife*');await page.locator('main[data-preview-page]').waitFor();await page.getByText('256',{exact:false}).first().waitFor();console.log('PASS populated UZEFLIFE tournament');

 await page.locator('summary').filter({hasText:'Design Preview'}).click();await page.getByLabel('Preview league').selectOption('league-la-liga');await page.locator('main[data-preview-page]').waitFor();await page.waitForTimeout(500);
 assert.ok((await page.locator('main[data-preview-page]').innerText()).includes('Barcelona'));console.log('PASS league switch');
 await page.locator('summary').filter({hasText:'Design Preview'}).click();await page.getByLabel('Preview season').selectOption('season-2025-26');await page.locator('main[data-preview-page]').waitFor();assert.ok(page.url().includes('previewSeason=season-2025-26'));console.log('PASS season switch');
 await page.locator('summary').filter({hasText:'Design Preview'}).click();await page.getByLabel('Preview theme').selectOption('light');assert.ok(await page.locator('.theme-light').count());console.log('PASS theme switch');
 await page.getByLabel('Preview viewport').selectOption('mobile');await page.frameLocator('iframe').locator('main[data-preview-page]').waitFor();assert.equal(await page.locator('iframe').evaluate(e=>e.clientWidth),390);await page.getByText('Yopish ×',{exact:true}).click();console.log('PASS real 390px iframe responsive viewport');
 const result=await page.evaluate(async()=>({post:(await fetch('/api/me',{method:'POST'})).status,admin:(await fetch('/api/admin/users')).status,external:(await fetch('https://efluz.vercel.app/api/me')).status}));assert.deepEqual(result,{post:403,admin:403,external:403});
 assert.equal(blocked.length,0,'No API request should leave transport');
 console.log('PASS no private API network traffic or mutations');
 if (process.env.EFL_PREVIEW_SCREENSHOT) await page.screenshot({path:process.env.EFL_PREVIEW_SCREENSHOT,fullPage:false});
 await page.goto(origin+'/');await page.getByText('Bu turnir platformasi Telegram Mini App orqali ishlaydi. Davom etish uchun uni Telegram ichidan oching.').waitFor();console.log('PASS preview requires explicit query flag');
}
await browser.close();assert.deepEqual(errors,[]);console.log('PASS zero uncaught browser errors');
