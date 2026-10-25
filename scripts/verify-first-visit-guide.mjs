import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const result=await build({absWorkingDir:root,entryPoints:['src/components/FirstVisitGuide.tsx','src/lib/firstVisitGuide.ts'],outdir:'test-guide',bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},plugins:[{name:'guide-isolated-i18n',setup(build){
 build.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'guide-test'}));
 build.onLoad({filter:/.*/,namespace:'guide-test'},()=>({contents:'export const useI18n=()=>({language:globalThis.guideLanguage});'}));
}}]});
function module(file){
 const context={module:{exports:{}},exports:{},console,window:{innerWidth:390,innerHeight:844},guideLanguage:'uz',guideStep:0,guideStateIndex:0};
 const react={...React,useState(initial){const state=React.useState(initial);return context.guideStateIndex++===0?[context.guideStep,state[1]]:state;}};
 context.require=name=>name==='react'?react:require(name);
 context.exports=context.module.exports;vm.createContext(context);vm.runInContext(file.text,context);return context;
}
const helper=module(result.outputFiles.find(f=>f.path.endsWith('/firstVisitGuide.js'))).module.exports;
const component=module(result.outputFiles.find(f=>f.path.endsWith('/FirstVisitGuide.js')));
const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
assert.equal(helper.readGuideStatus('new-user',storage),null);
helper.saveGuideStatus('new-user','completed',storage);
assert.equal(helper.readGuideStatus('new-user',storage),'completed');
assert.equal(helper.readGuideStatus('another-user',storage),null,'One account completing a guide must not hide it for another account');
helper.saveGuideStatus('another-user','skipped',storage);
assert.equal(helper.readGuideStatus('another-user',storage),'skipped','Skip is remembered so the guide does not nag on every opening');
assert.equal(helper.readGuideStatus('no-storage'),null);
const blocked={getItem(){throw new Error('storage blocked');},setItem(){throw new Error('storage blocked');}};
assert.equal(helper.readGuideStatus('blocked',blocked),null);assert.doesNotThrow(()=>helper.saveGuideStatus('blocked','completed',blocked));
for(const width of [320,390,768,1440])for(const height of [220,568,844])for(const target of [null,{left:12,top:8,width:40,height:40},{left:width-54,top:height-78,width:44,height:50}]){
 const p=helper.guidePlacement(target,width,height,330);
 assert.ok(p.left>=0&&p.left+p.width<=width,`card fits ${width}px screen`);
 assert.ok(p.top>=0&&p.top+Math.min(330,p.maxHeight)<=height,`card fits ${height}px viewport`);
}
// Native fullscreen controls and landscape notches stay outside the guide card.
for (const [width,height,insets] of [[390,844,{top:84,bottom:34,left:0,right:0}],[844,390,{top:56,bottom:20,left:44,right:44}]]) {
 const p=helper.guidePlacement(null,width,height,300,insets);
 assert.ok(p.left>=insets.left && p.left+p.width<=width-insets.right);
 assert.ok(p.top>=insets.top && p.top+Math.min(300,p.maxHeight)<=height-insets.bottom);
}
const mobileNav={left:70,top:760,width:90,height:50};
const mobile=helper.guidePlacement(mobileNav,390,844,330);
assert.ok(mobile.top+330<mobileNav.top,'The mobile sheet leaves the highlighted bottom navigation visible');
assert.equal(mobile.left,12,'Mobile uses the app’s 12px side spacing');
// The score button may be below the fold while the club navigation is visible.
const button={getBoundingClientRect:()=>({width:140,height:40,top:1100,bottom:1140})};
const nav={getBoundingClientRect:()=>({width:90,height:50,top:760,bottom:810})};
const hidden={getBoundingClientRect:()=>({width:0,height:0,top:0,bottom:0})};
const rootWithControls={querySelectorAll:selector=>selector==='score'?[hidden,button]:[nav]};
assert.equal(helper.findGuideTarget(rootWithControls,'score, nav'),button,'The offscreen score button wins over the visible club navigation');
assert.equal(helper.findGuideTarget({querySelectorAll:selector=>selector==='standings'?[button]:[nav]},'standings, nav'),button,'The standings control also wins over visible navigation');
assert.equal(helper.findGuideTarget({querySelectorAll:()=>[]},'score'),undefined,'Missing fixtures do not manufacture a score action');
for(const height of [568,844])for(const top of [170,Math.floor(height/2),height-150]){
 const target={left:30,top,width:220,height:48};
 const p=helper.guidePlacement(target,390,height,330);
 const bottom=p.top+Math.min(330,p.maxHeight);
 assert.ok(bottom<=target.top || p.top>=target.top+target.height,'The mobile guide must not cover the score button');
 assert.ok(bottom<=height && p.top>=16,'The targeted mobile guide stays in the viewport');
}
const desktop=helper.guidePlacement({left:200,top:70,width:90,height:40},1440,900,330);
assert.ok(desktop.top>=110,'Desktop coachmark sits beside its target rather than covering it');
const globalCss=readFileSync(path.join(root,'src/admin-preview.css'),'utf8');
const dialogSelectors=globalCss.match(/[^{}]*\[role="dialog"\][^{}]*\{/g)||[];
assert.ok(dialogSelectors.length>0);
assert.ok(dialogSelectors.every(selector=>selector.includes('[role="dialog"]:not(:where(.efl-guide-card,.team-dialog))')),'The overlay theme must never paint a solid coachmark or TEAMS dialog as a transparent backdrop');
for(const language of ['uz','ru','en']){
 component.guideLanguage=language; component.guideStep=0; component.guideStateIndex=0;
 const html=renderToStaticMarkup(React.createElement(component.module.exports.FirstVisitGuide,{onFinish:()=>{throw new Error('Rendering never changes data');}}));
 assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);assert.match(html,/aria-live="polite"/);
 assert.match(html,/efl-guide-card-scroll/);assert.match(html,/efluz-logo-light.png/);assert.match(html,/btn-glass-primary/);
 assert.equal((html.match(/data-active=/g)||[]).length,7,'All seven steps are represented');
 assert.doesNotMatch(html,/Admin|\/api\//,'Public guidance never exposes admin controls or performs requests');
 if(language==='uz'){assert.match(html,/Bosh sahifa/);assert.match(html,/Keyingi/);assert.match(html,/O‘tkazib yuborish/);}
 const headings={uz:['Hisob qanday kiritiladi?','Turnir jadvali','Muhim xabarlar'],ru:['Как отправить счёт?','Турнирная таблица','Важные уведомления'],en:['How to submit a score','League standings','Important notifications']};
 for(const [index,step] of [3,4,6].entries()){
   component.guideStep=step;component.guideStateIndex=0;
   const stepHtml=renderToStaticMarkup(React.createElement(component.module.exports.FirstVisitGuide,{onFinish:()=>{throw new Error('Rendering never changes data');}}));
   assert.ok(stepHtml.includes(headings[language][index]),`Score, standings and final notification steps remain aligned in ${language}`);
   assert.equal(stepHtml.includes('efl-guide-replay-hint'),step===6,'Only the seventh and final step shows replay help');
 }
 if(language==='uz'&&process.env.EFL_GUIDE_REVIEW_HTML)writeFileSync(process.env.EFL_GUIDE_REVIEW_HTML,html);
}
console.log('PASS first-visit guide: account-isolated completed/skipped state, blocked storage, card placement on mobile/desktop/short viewports, accessible localized modal and public-only instructions.');
