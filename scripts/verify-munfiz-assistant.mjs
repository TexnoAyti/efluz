import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['src/lib/munfizAssistant.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const context={module:{exports:{}},exports:{}};context.exports=context.module.exports;vm.runInNewContext(compiled.outputFiles[0].text,context);
const {parkMunfiz,assistantPage}=context.module.exports;
for(const [w,h] of [[320,568],[390,844],[844,390],[320,240]]){
 const result=parkMunfiz(w,h,[],{x:2000,y:2000});
 assert.ok(result.x>=0&&result.x+72<=w);assert.ok(result.y>=0&&result.y+104<=h);
}
const obstacle={left:0,top:80,right:92,bottom:300};
const p=parkMunfiz(390,844,[obstacle],{x:8,y:100});
assert.ok(p.x>=obstacle.right||p.y>=obstacle.bottom,'Clicked controls must be left clear when a free edge exists');
assert.equal(assistantPage('leagues','uzeflife'),'uzeflife');
assert.equal(assistantPage('team','uzeflife'),'team','A prior competition category cannot override a team profile');
assert.equal(assistantPage('dashboard',null),'dashboard');
console.log('PASS Munfiz: small/short viewports, obstacle avoidance and page category isolation.');
