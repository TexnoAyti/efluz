import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('public/games/efl-penalty.html','utf8');
const section=(start:string,end:string)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Expected game function '+start);
 return html.slice(a,b);
};
const geometry=section('function ballStartY(){','function goalBack(){');
const keeperMotion=section('function keeperXAt(phase)','function updateDifficulty(){');
const collision=section('function keeperContact(s, width, height)','function resolve(){');
const shotCode=section('function tryShot(sx,sy,ex,ey)','canvas.addEventListener(\'pointerdown\'');
const sandbox:any={
 Math, W:390,H:844,score:0,goaliePhase:-Math.PI/2,goalieSpeed:1.35,
 run:true,phase:'ready',aim:null,shot:null,anim:'idle',poseT:0,shotCount:0,
 clamp:(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v)),
 $:()=>({textContent:''}), sound:()=>{}
};
vm.createContext(sandbox);
vm.runInContext(geometry+keeperMotion+collision+shotCode,sandbox);
for(const [width,height] of [[320,568],[360,640],[390,844],[430,932],[844,390]]){
 sandbox.W=width;sandbox.H=height;
 const goal=vm.runInContext('goalCoords()',sandbox);
 assert.ok(goal.x>=0&&goal.y>=0&&goal.x+goal.w<=width&&goal.y+goal.h<=height,'Goal fits visible viewport');
 assert.ok(goal.w/goal.h>2.5&&goal.w/goal.h<4,'Goal maintains football proportions');
 assert.ok(vm.runInContext('ballStartY()',sandbox)<height-95,'Ball is above scoreboard');
}
sandbox.W=390;sandbox.H=844;
const g=vm.runInContext('goalCoords()',sandbox);
const releaseX=g.x+g.w*.64,releaseY=g.y+g.h*.42;
vm.runInContext('tryShot(195,670,releaseX,releaseY)',vm.createContext({...sandbox,releaseX,releaseY}));
// The actual game state is checked separately to avoid cross-realm lexical scope.
vm.runInContext('tryShot(195,670,releaseX,releaseY)',Object.assign(sandbox,{releaseX,releaseY}));
const shot=sandbox.shot;
assert.ok(shot,'Upward swipe fires');
assert.ok(Math.abs(shot.tx-releaseX/390)<1e-8,'Ball target X equals finger-release X');
assert.equal(shot.ty,releaseY,'Ball target Y equals finger-release Y');
assert.equal(shot.out,false,'Goal-area release stays on target');
assert.ok(shot.flight>=.29&&shot.flight<=.51,'Fast shot duration under half a second');
const xAt=vm.runInContext('keeperXAt',sandbox);
const contact=vm.runInContext('keeperContact',sandbox);
const phase=shot.startPhase+shot.travelSpeed*(shot.flight*.86+.105);
const keeperX=xAt(phase);
const fullH=Math.min(390*.295,g.h*.9),ground=g.y+g.h+390*.045;
const bodyY=ground-fullH*.52,gloveY=ground-fullH*.84;
const make=(tx:number,ty:number,extra:any={})=>({...shot,tx,ty,out:false,...extra});
assert.equal(contact(make(keeperX,bodyY),390,844),true,'Keeper saves ball hitting his body');
assert.equal(contact(make(keeperX+.044,gloveY),390,844),true,'Keeper gloves save upper shot');
assert.equal(contact(make(.80,bodyY),390,844),false,'Ball outside keeper reach scores');
assert.equal(contact(make(keeperX,bodyY,{out:true}),390,844),false,'Out ball is never counted as save');
assert.match(html,/if\(s\.resultT>\.43\)/,'New shot ready after shorter result pause');
assert.match(html,/height:100dvh;min-height:0;max-height:none;max-width:none/,'Fullscreen shell does not retain portrait size cap');
console.log('PASS penalty: real finger target, sub-second shot, short reload, geometric goal, real Munfiz saves and fullscreen bounds');
