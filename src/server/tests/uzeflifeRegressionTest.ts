import assert from 'node:assert/strict';
import {initialUState,generateUBracket,applyUAction,validateUAction,verifyUChannels,uPermissions,publicUState} from '../services/uzeflifeService';
import type {User} from '../../types';
const user=(id:string,tg=id):User=>({id,telegramId:tg,firstName:id,username:id,isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''});
const owner=user('owner','5209126900'),superAdmin=user('super'),assistant=user('assistant'),stranger=user('stranger');
const s=initialUState();const act=(u:User,a:string,d:any={})=>{const v=validateUAction(a,d);applyUAction(s,u,v.action,v.data);};
assert.throws(()=>act(stranger,'superAdmin',{target:'super'}),/ruxsat/);
act(owner,'superAdmin',{target:superAdmin.id});assert.equal(superAdmin.isAdmin,false);
act(superAdmin,'assistant',{target:assistant.id,permissions:['channels','participants']});
assert.deepEqual(uPermissions(s,assistant),['channels','participants']);
for(const a of ['superAdmin','assistant','customNavigation','generate','pause','announce','open','clearProposal'])assert.throws(()=>act(assistant,a,a==='superAdmin'?{target:'assistant'}:a==='assistant'?{target:'stranger',permissions:['results']}:a==='customNavigation'?{enabled:true}:a==='announce'?{text:'test'}:a==='clearProposal'?{matchId:'x'}:{}),/ruxsat/);
act(assistant,'addChannel',{id:'@uzeflife',title:'UZEFLIFE',url:'https://t.me/uzeflife'});
assert.throws(()=>act(assistant,'addChannel',{id:'@uzeflife',title:'X',url:'javascript:alert(1)'}),/noto‘g‘ri/);
assert.throws(()=>validateUAction('__proto__',{}),/Noma’lum/);
for(const status of ['member','creator','administrator','restricted','left','kicked']){
 const mock=(async()=>Response.json({ok:true,result:{status,is_member:status==='restricted'}})) as typeof fetch;
 assert.equal((await verifyUChannels(s.channels,'1234','test-token',mock)).length,['left','kicked'].includes(status)?1:0);
}
await assert.rejects(verifyUChannels(s.channels,'1234','test-token',(async()=>Response.json({ok:false})) as typeof fetch),/tasdiqlanmadi/);
await assert.rejects(verifyUChannels(s.channels,'1234','test-token',(async()=>{throw Error('timeout');}) as typeof fetch),/tekshirib bo‘lmadi/);
await assert.rejects(verifyUChannels(s.channels,'','test-token'),/imkonsiz/);
act(superAdmin,'removeAssistant',{target:assistant.id});assert.deepEqual(uPermissions(s,assistant),[]);
assert.equal(publicUState(s,stranger).superAdmin,null);
// Administrator enrollment: approval, restoration, capacity, and post-draw freeze.
const enrollment=initialUState();enrollment.assistants[assistant.id]=['participants'];
const add=(actor:User,id:string)=>applyUAction(enrollment,actor,'addParticipant',{participant:{id,name:'Verified '+id}});
assert.throws(()=>add(stranger,'p0'),/ruxsat/);
add(assistant,'p0');assert.equal(enrollment.participants[0].status,'approved');assert.throws(()=>add(owner,'p0'),/allaqachon/);
enrollment.participants[0].status='pending';add(owner,'p0');assert.equal(enrollment.participants.length,1);
enrollment.participants[0].status='removed';add(owner,'p0');assert.equal(enrollment.participants.length,1);
for(let i=1;i<256;i++)add(owner,'p'+i);
assert.throws(()=>add(owner,'overflow'),/256/);
enrollment.participants.push({id:'removed',name:'Removed',status:'removed'});
assert.throws(()=>applyUAction(enrollment,owner,'review',{target:'removed',status:'approved'}),/256/);
enrollment.status='playing';assert.throws(()=>add(owner,'later'),/boshlangan/);
assert.deepEqual(validateUAction('addParticipant',{target:' 12345 ',name:'Forged'}).data,{target:'12345'},'Enrollment accepts only an account reference, never caller-supplied player identity');
act(owner,'open');for(let i=0;i<256;i++){const u=user(`p${i}`);act(u,'register');act(superAdmin,'review',{target:u.id,status:'approved'});}
assert.throws(()=>act(stranger,'register'),/256/);assert.throws(()=>act(user('p0'),'register'),/allaqachon/);
assert.throws(()=>generateUBracket(['p0']),/256/);
assert.throws(()=>generateUBracket(Array(256).fill('same')),/256/);
act(superAdmin,'generate');assert.equal(s.matches.length,255);
assert.equal(Buffer.byteLength(JSON.stringify(s))<500000,true);
assert.deepEqual(Array.from({length:8},(_,i)=>s.matches.filter(m=>m.bracket===i+1).length),Array(8).fill(31));
assert.equal(s.matches.filter(m=>m.bracket===0).length,7);
assert.throws(()=>act(superAdmin,'next'),/tugamagan/);
const first=s.matches[0];const h=user(first.home!),a=user(first.away!);
assert.throws(()=>act(stranger,'result',{matchId:first.id,home:1,away:0}),/bekor/);
assert.throws(()=>act(h,'result',{matchId:first.id,home:1,away:1}),/penaltilar/);
assert.throws(()=>act(h,'result',{matchId:first.id,home:-1,away:0}),/noto‘g‘ri/);
act(h,'result',{matchId:first.id,home:2,away:1});assert.equal(first.winner,null);
assert.throws(()=>act(h,'result',{matchId:first.id,home:2,away:1}),/kut/);
assert.equal(publicUState(s,stranger).matches[0].proposal,null);
assert.throws(()=>act(a,'result',{matchId:first.id,home:1,away:0}),/mos kelmadi/);
act(a,'result',{matchId:first.id,home:2,away:1});assert.equal(first.winner,h.id);
act(superAdmin,'pause');assert.throws(()=>act(h,'result',{matchId:first.id,home:3,away:1}),/qabul qilinmaydi/);act(superAdmin,'resume');
for(let r=1;r<=8;r++){
 for(const m of s.matches.filter(m=>m.round===r&&!m.winner))act(superAdmin,'result',{matchId:m.id,home:1,away:0});
 if(r<8)act(superAdmin,'next');
}
const final=s.matches.find(m=>m.round===8)!;assert.ok(final.winner);
assert.equal(s.matches.filter(m=>m.winner===final.winner).length,8);
assert.equal(s.matches.filter(m=>m.winner).length,255);
assert.equal(new Set(s.matches.filter(m=>m.round===6).flatMap(m=>[m.home,m.away])).size,8);
act(superAdmin,'complete');assert.equal(s.status,'completed');
act(owner,'superAdmin',{target:null});assert.equal(uPermissions(s,superAdmin).length,0);
console.log('PASS UZEFLIFE: hierarchy, scoped permissions, URL/score validation, fail-closed Telegram memberships, pending approvals, 8x32 brackets, opponent confirmation, pause/resume, manual progression and 255-match completion (8 champion wins).');
