import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['src/lib/munfizAssistant.ts','src/content/munfizHelp.ts'],outdir:'test-munfiz',bundle:true,write:false,platform:'node',format:'cjs'});
const context={module:{exports:{}},exports:{}};context.exports=context.module.exports;vm.runInNewContext(compiled.outputFiles.find(f=>f.path.endsWith('/munfizAssistant.js')).text,context);
const {parkMunfiz,assistantPage,selectMunfizControls,MUNFIZ_SIZE}=context.module.exports;
for(const [w,h] of [[320,568],[390,844],[844,390],[320,240]]){
 const result=parkMunfiz(w,h,[],{x:2000,y:2000});
 assert.ok(result.x>=0&&result.x+MUNFIZ_SIZE.width<=w);assert.ok(result.y>=0&&result.y+MUNFIZ_SIZE.height<=h);
}
const obstacle={left:0,top:80,right:92,bottom:300};
const p=parkMunfiz(390,844,[obstacle],{x:8,y:100});
assert.ok(p.x>=obstacle.right||p.y>=obstacle.bottom,'Clicked controls must be left clear when a free edge exists');
assert.equal(assistantPage('leagues','uzeflife'),'uzeflife');
assert.equal(assistantPage('team','uzeflife'),'team','A prior competition category cannot override a team profile');
assert.equal(assistantPage('dashboard',null),'dashboard');
console.log('PASS Munfiz: small/short viewports, obstacle avoidance and page category isolation.');

assert.equal(assistantPage('cups',null),'cups','An unmounted category cannot turn cup help into league help');
const controls=[
 {id:'category-cups',target:'category',title:'Cups',description:'Cup formats'},
 {id:'section-standings',target:'tab',title:'Standings',description:'Read points'},
 {id:'section-fixtures',target:'active',title:'Matches',description:'Review fixtures',selected:true},
 {id:'nav-dashboard',target:'global',title:'Home',description:'Home'},
 {id:'score-entry',target:'score',title:'Score',description:'Submit score'},
 {id:'SCORE-ENTRY',target:'other-selector',title:'Score again',description:'Duplicate'},
 {id:'result-confirm',target:'disabled',title:'Confirm',description:'Confirm',disabled:true},
 {id:'local-search',target:'search',title:'Search',description:'Find a player'},
];
assert.deepEqual(Array.from(selectMunfizControls(controls,'page'),x=>x.id),['score-entry','local-search'],'Page tours exclude global/category menus, disabled actions and duplicate keys');
assert.deepEqual(Array.from(selectMunfizControls(controls,'sections'),x=>x.id),['section-standings'],'Section tours prefer local tabs, omit the active tab and do not mix in global categories');
const help={module:{exports:{}},exports:{}};help.exports=help.module.exports;vm.runInNewContext(compiled.outputFiles.find(f=>f.path.endsWith('/munfizHelp.js')).text,help);
for(const language of ['uz','ru','en']){
 const api=help.module.exports;
 assert.notEqual(api.munfizControlDescription('section-standings',language),api.munfizControlDescription('section-participants',language),'Each section needs its own explanation');
 assert.equal(api.munfizControlDescription('unknown-control',language),null,'Unknown buttons cannot get invented instructions');
 assert.notEqual(api.munfizSectionDescription('uzeflife','standings',language),api.munfizSectionDescription('uzeflife','fixtures',language),'Switching a section must change its explanation');
}
console.log('PASS contextual help: page-specific steps, local sections, unique targets and explicit explanations in three languages.');
