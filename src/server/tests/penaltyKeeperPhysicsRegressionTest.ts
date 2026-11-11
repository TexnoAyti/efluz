import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('public/games/efl-penalty.html', 'utf8');
const keeperFn = html.match(/function keeperContact\(s, width, height\) \{[\s\S]*?\n\}/)?.[0];
const motionFn = html.match(/function keeperXAt\(phase\)\{[^}]*\}/)?.[0];
const difficultyFn = html.match(/function updateDifficulty\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(keeperFn && motionFn && difficultyFn, 'Moving keeper, saves and difficulty are in the game');

const hud = { speed: { textContent: '' } };
const sandbox = { Math, score: 0, goalieSpeed: 0, $: (id: string) => hud[id as keyof typeof hud] };
vm.createContext(sandbox);
vm.runInContext(motionFn + '\n' + keeperFn + '\n' + difficultyFn, sandbox);
const position = vm.runInContext('keeperXAt', sandbox) as (phase:number)=>number;
const collide = vm.runInContext('keeperContact', sandbox) as (shot:Record<string,unknown>,width:number,height:number)=>boolean;
const adjust = vm.runInContext('updateDifficulty', sandbox) as ()=>void;

const near = (a:number,b:number,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon, `${a} should equal ${b}`);
near(position(-Math.PI/2),.19);
near(position(Math.PI/2),.81);
near(position(Math.PI*3/2),.19);
near(position(Math.PI*5/2),.81);
assert.ok(position(.25)>position(0),'Keeper moves continuously from left toward right');
assert.ok(position(Math.PI*.75)<position(Math.PI*.5),'Keeper reverses smoothly at edge');

const make = (tx:number,ty:number,extra:Record<string,number|boolean>={}) => ({
  tx, ty, out:false, flight:.81, startPhase:-Math.PI/2,
  travelSpeed:1.35, ...extra
});
const atContact = (s:ReturnType<typeof make>) => position(s.startPhase+s.travelSpeed*(s.flight*.86+.105));
const first = make(.5,.34);
const nearX = atContact(first);
assert.equal(collide({...first,tx:nearX},400,700),true,'Moving gloves save high shots where Munfiz actually arrives');
assert.equal(collide({...first,tx:nearX,ty:.44},400,700),true,'Moving body saves middle strikes');
assert.equal(collide({...first,tx:.91},400,700),false,'Missed corner stays a goal, not an automatic save');
assert.equal(collide({...first,tx:nearX,out:true},400,700),false,'Out-of-goal shot is not a save');
assert.equal(collide({...first,tx:.5},400,700),false,'Keeper cannot teleport to a center shot');
const next = make(.5,.34,{startPhase:Math.PI/2,travelSpeed:2.0});
assert.notEqual(atContact(first),atContact(next),'Timing and keeper speed change collision position');

sandbox.score=0;adjust();const base=sandbox.goalieSpeed;
near(base,1.35);
for(let scored=1;scored<=50;scored++){
  sandbox.score=scored;adjust();
  assert.ok(sandbox.goalieSpeed>=base, 'Keeper speed increases monotonically');
  assert.ok(sandbox.goalieSpeed<=1.35*2.5+1e-6, 'Maximum keeper speed is capped');
}
assert.ok(sandbox.goalieSpeed>base*2, 'High streak is visibly more challenging');
assert.match(html,/startPhase:goaliePhase,travelSpeed:goalieSpeed/,'Strike freezes current sweep parameters');
assert.match(html,/goaliePhase\+=dt\*goalieSpeed/,'Visible goalkeeper moves on each animation frame');
assert.doesNotMatch(html,/Math\.random\(\)<Math\.min\(\.66/,'Old random prediction is gone');
console.log('PASS moving goalkeeper: visible sweep, timing-based saves, goals in open corners, smooth bounded speed ramp');
