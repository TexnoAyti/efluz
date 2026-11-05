// Isolated browser check of the real task panel and API client. No live requests.
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const root=process.cwd(),dir=mkdtempSync(path.join(tmpdir(),'efl-tasks-'));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminTaskPanel} from './src/components/admin/AdminTaskPanel';
window.calls=[];window.mode='ok';const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,ms===25000?250:ms,...args);
window.fetch=async(url,init)=>{if(!String(url).startsWith('/api/admin/telegram-ai/tasks?'))throw Error('Unexpected API '+url);window.calls.push(url);if(window.mode==='hang')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));if(window.mode==='reject')return Response.json({error:'offline'},{status:503});const q=new URL(url,location.origin).searchParams;let rows=Array.from({length:65},(_,i)=>({id:'task-'+i,kind:'review',group:i%2?'UZEFLIFE':'EFL',priority:i%3?'HIGH':'URGENT',title:'Raqib — juda uzun klub nomi '.repeat(3)+i,reason:'Hisobni tekshirish kerak.',nextStep:'Dalillarni solishtirib, keyin qaror qiling.',where:'Admin → Natijalar',verified:true}));if(q.get('group'))rows=rows.filter(t=>t.group===q.get('group'));if(q.get('priority'))rows=rows.filter(t=>t.priority===q.get('priority'));const offset=Number(q.get('offset')||0);return Response.json({success:true,items:rows.slice(offset,offset+30),total:rows.length,allTotal:65,offset,nextOffset:offset+30<rows.length?offset+30:null,generatedAt:'2026-11-05T03:00:00Z',complete:true,stale:false,unavailable:[],summary:{URGENT:22,HIGH:43,NORMAL:0},catalog:[{kind:'review',group:'EFL',name:'Natija tekshiruvi'}]});};
createRoot(document.getElementById('root')).render(<div className="efl-preview theme-light"><AdminTaskPanel/></div>);`;
await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',outdir:dir+'/assets'});
const css=readdirSync(root+'/dist/assets').find(f=>/^index-.*\.css$/.test(f));copyFileSync(root+'/dist/assets/'+css,dir+'/base.css');
writeFileSync(dir+'/index.html','<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="assets/stdin.css"><div id="root"></div><script type="module" src="assets/stdin.js"></script>');
const server=http.createServer((req,res)=>{try{const file=path.join(dir,req.url==='/'?'index.html':req.url);res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.EFL_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.EFL_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
try{const context=await browser.newContext();
 for(const width of [320,393,844]){const page=await context.newPage();await page.setViewportSize({width,height:850});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('status').filter({hasText:'65 ta mos vazifa'}).waitFor();assert.equal(await page.locator('.admin-task-list>li').count(),30);
  await page.getByRole('button',{name:'Keyingi',exact:true}).click();await page.getByText('31–60 / 65',{exact:true}).waitFor();
  await page.getByLabel('Bo‘lim',{exact:true}).selectOption('UZEFLIFE');await page.getByRole('status').filter({hasText:'32 ta mos vazifa'}).waitFor();assert.equal(await page.evaluate(()=>new URL(window.calls.at(-1),location.origin).searchParams.get('offset')),'0');
  await page.getByLabel('Muhimlik',{exact:true}).selectOption('URGENT');await page.getByRole('status').filter({hasText:'11 ta mos vazifa'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Task cards fit the phone width');
  await page.addStyleTag({content:'.admin-task-panel :is(p,button,select,h4){font-size:22px !important}'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Enlarged type fits');
  await page.evaluate(()=>{document.querySelector('.efl-preview').className='efl-preview theme-dark';window.mode='hang';});await page.getByRole('button',{name:'Vazifalarni yangilash'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Vazifalarni yangilash'}).isEnabled(),true,'Timeout releases refresh control');
  await page.evaluate(()=>window.mode='ok');await page.getByRole('button',{name:'Vazifalarni yangilash'}).click();await page.getByRole('status').filter({hasText:'11 ta mos vazifa'}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS '+width+'px: real task panel/API, pagination, filters reset offset, responsive long text/enlarged type, dark mode, timeout/retry recovery.');await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
