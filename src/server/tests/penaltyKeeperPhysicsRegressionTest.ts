import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('public/games/efl-penalty.html','utf8');
const source=html.match(/function keeperContact\(s, width, height\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(source,'Goalkeeper reach calculation exists in the shipped game');
const sandbox={clamp:(x:number,a:number,b:number)=>Math.min(b,Math.max(a,x)),lerp:(a:number,b:number,t:number)=>a+(b-a)*t,smooth:(x:number)=>x*x*(3-2*x),Math};
vm.createContext(sandbox);
const keeperContact=vm.runInContext(source+';keeperContact',sandbox) as (s:Record<string,number|boolean>,w:number,h:number)=>boolean;
const make=(tx:number,ty:number,extra:Record<string,number|boolean>={})=>({
 tx,ty,out:false,flight:.81,startX:.5,keeperEnd:.5,reactionDelay:.27,diveDuration:.56,direction:0,...extra,
});
assert.equal(keeperContact(make(.5,.33),400,700),true,'Center-upper strike is reachable by hands');
assert.equal(keeperContact(make(.5,.44),400,700),true,'Middle strike can hit body');
assert.equal(keeperContact(make(.1,.27),400,700),false,'Top corner can defeat stationary keeper');
assert.equal(keeperContact(make(.5,.33,{out:true}),400,700),false,'Out-of-goal strikes are not saves');
assert.equal(keeperContact(make(.5,.33,{reactionDelay:.98}),400,700),false,'Keeper cannot save a high shot before reacting');
assert.equal(keeperContact(make(.72,.34,{keeperEnd:.71,direction:1}),400,700),true,'Committed correct-direction dive can reach angled shot');
assert.equal(keeperContact(make(.72,.34,{keeperEnd:.29,direction:-1}),400,700),false,'Wrong-direction dive never becomes an invisible save');
assert.match(html,/score-4/,'Difficulty starts gradually after four goals');
assert.doesNotMatch(html,/Math\.min\(\.18,\.025\+level\*\.004\)/,'Old almost-always-blind keeper removed');
console.log('PASS realistic penalty goalkeeper: center/high saves, corners, reaction timing, committed dives');
