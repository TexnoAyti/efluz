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
function module(file){const context={require,module:{exports:{}},exports:{},console,window:{innerWidth:390,innerHeight:844},guideLanguage:'uz'};context.exports=context.module.exports;vm.createContext(context);vm.runInContext(file.text,context);return context;}
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
const mobileNav={left:70,top:760,width:90,height:50};
const mobile=helper.guidePlacement(mobileNav,390,844,330);
assert.ok(mobile.top+330<mobileNav.top,'The mobile sheet leaves the highlighted bottom navigation visible');
assert.equal(mobile.left,12,'Mobile uses the app’s 12px side spacing');
const desktop=helper.guidePlacement({left:200,top:70,width:90,height:40},1440,900,330);
assert.ok(desktop.top>=110,'Desktop coachmark sits beside its target rather than covering it');
const globalCss=readFileSync(path.join(root,'src/admin-preview.css'),'utf8');
const dialogSelectors=globalCss.match(/[^{}]*\[role="dialog"\][^{}]*\{/g)||[];
assert.ok(dialogSelectors.length>0);
assert.ok(dialogSelectors.every(selector=>selector.includes('[role="dialog"]:not(:where(.efl-guide-card))')),'The overlay theme must never paint the solid coachmark as a transparent backdrop');
for(const language of ['uz','ru','en']){
 component.guideLanguage=language;
 const html=renderToStaticMarkup(React.createElement(component.module.exports.FirstVisitGuide,{onFinish:()=>{throw new Error('Rendering never changes data');}}));
 assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);assert.match(html,/aria-live="polite"/);
 assert.match(html,/efl-guide-card-scroll/);assert.match(html,/efluz-logo-light.png/);assert.match(html,/btn-glass-primary/);
 assert.equal((html.match(/data-active=/g)||[]).length,6,'All six steps are represented');
 assert.doesNotMatch(html,/Admin|\/api\//,'Public guidance never exposes admin controls or performs requests');
 if(language==='uz'){assert.match(html,/Bosh sahifa/);assert.match(html,/Keyingi/);assert.match(html,/O‘tkazib yuborish/);}
 if(language==='uz'&&process.env.EFL_GUIDE_REVIEW_HTML)writeFileSync(process.env.EFL_GUIDE_REVIEW_HTML,html);
}
console.log('PASS first-visit guide: account-isolated completed/skipped state, blocked storage, card placement on mobile/desktop/short viewports, accessible localized modal and public-only instructions.');
