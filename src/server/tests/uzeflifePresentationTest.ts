import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UzeflifeChampionship} from '../../components/uzeflife/UzeflifeChampionship';
import {UzeflifeBracket} from '../../components/uzeflife/UzeflifeBracket';
import {uDisplayMatches,uCanSeeCustomNavigation,uSourceLabel} from '../../lib/uzeflifePresentation';
import {initialUState,applyUAction} from '../services/uzeflifeService';
import type {UViewState} from '../../lib/uzeflifeApi';
import type {User} from '../../types';

const state:UViewState={...initialUState(),permissions:[],isOwner:false,isSuper:false};
const render=(s=state,initialTab:any='overview',userId?:string)=>renderToStaticMarkup(React.createElement(UzeflifeChampionship,{state:s,userId,busy:false,error:'',notice:'',missing:[],act:async()=>true,onRefresh:()=>{},initialTab}));
const html=render();
assert.ok(html.includes('Saralash setkalari')&&html.includes('Final bosqichi'));
assert.equal((html.match(/class="u-bracket-entry"/g)||[]).length,8);
assert.ok(!html.includes('<form'),'Spectators see the championship, not setup forms');
assert.ok(!html.includes('Yaratish')&&!html.includes('generator')&&!html.includes('Turnir admin paneli'));
assert.ok(html.includes('Ro‘yxatdan o‘tish boshlanishi'));
const registration=render({...state,status:'registration'},'overview','user1');
assert.ok(registration.includes('Ro‘yxatdan o‘tish</button>'));
const pending=render({...state,status:'registration',participants:[{id:'user1',name:'Sinov',status:'pending'}]},'overview','user1');
assert.ok(pending.includes('Arizangiz qabul qilindi')&&!pending.includes('Ro‘yxatdan o‘tish</button>'));
const ownerView=render({...state,isOwner:true,isSuper:true,permissions:['brackets','participants','registrations']});
assert.ok(ownerView.includes('Turnir admin paneli</strong>'),'Owner entry has a visible text label');
for(const role of [{isSuper:true,permissions:['brackets'] as const},{isSuper:false,permissions:['participants'] as const}]){
 const roleState={...state,...role,permissions:[...role.permissions]};
 assert.ok(render(roleState).includes('Turnir admin paneli</strong>'),'Assigned super admins and assistants can discover management without global admin status');
 const management=renderToStaticMarkup(React.createElement(UzeflifeChampionship,{state:roleState,busy:false,error:'',notice:'',missing:[],act:async()=>true,onRefresh:()=>{},initialAdmin:true}));
 assert.ok(management.includes('UZEFLIFE boshqaruvi'),'Admin entry opens management directly');
 assert.equal(management.includes('Adminlar boshqaruvi'),false,'Role management is a separate section');
}
const denied=renderToStaticMarkup(React.createElement(UzeflifeChampionship,{state,busy:false,error:'',notice:'',missing:[],act:async()=>true,onRefresh:()=>{},initialAdmin:true}));
assert.ok(!denied.includes('UZEFLIFE boshqaruvi'),'Initial admin request cannot grant missing permissions');
assert.ok(!ownerView.includes('<form')&&!ownerView.includes('Qur’a tashlash va turnirni boshlash'),'Owner setup stays behind management');
assert.equal(uCanSeeCustomNavigation(false),false,'Temporary hide also applies to owner');
assert.equal(uCanSeeCustomNavigation(true),true,'Explicit restoration still works');
const before=JSON.stringify(state);
const slots=uDisplayMatches(state);
assert.equal(slots.length,255);assert.ok(slots.every(m=>!m.home&&!m.away&&!m.winner));assert.equal(JSON.stringify(state),before,'Viewing fixed structure never changes enrollment or persisted fixtures');
for(let b=1;b<=8;b++){
 const tree=renderToStaticMarkup(React.createElement(UzeflifeBracket,{state,bracket:b,onMatch:()=>{}}));
 assert.equal((tree.match(/class="u-tree-match[ "]/g)||[]).length,31);
 assert.equal((tree.match(/class="u-tree-lines">([\s\S]*?)<\/svg>/)![1].match(/<path /g)||[]).length,30);
 assert.ok(!tree.includes('slot-'),'Display placeholders never masquerade as registered players');
}
const final=renderToStaticMarkup(React.createElement(UzeflifeBracket,{state,bracket:0,onMatch:()=>{}}));
assert.equal((final.match(/class="u-tree-match[ "]/g)||[]).length,7);
assert.equal((final.match(/class="u-tree-lines">([\s\S]*?)<\/svg>/)![1].match(/<path /g)||[]).length,6);
assert.ok(final.includes('1-setka g‘olibi')&&final.includes('8-setka g‘olibi'));
assert.ok(uSourceLabel(slots.find(m=>m.id==='r3m8')!,'home').includes('1-o‘yin'));
assert.ok(render(state,'fixtures').includes('Raqiblar qur’ada aniqlanadi'));
assert.ok(render(state,'results').includes('Natijalar hali yo‘q'));
// UI placeholders cannot be treated as actual scheduled matches by the backend.
const owner={id:'owner',telegramId:'5209126900'} as User;
assert.throws(()=>applyUAction(state,owner,'schedule',{matchId:slots[0].id,scheduledAt:new Date().toISOString()}),/topilmadi/);
assert.equal(state.matches.length,0);
const played={...state,status:'playing' as const,round:1,participants:Array.from({length:256},(_,i)=>({id:'qa-'+i,name:'Uzun ism '+i,status:'approved' as const})),matches:slots.map((m,i)=>({...m,home:m.round===1?'qa-'+(i*2):null,away:m.round===1?'qa-'+(i*2+1):null}))};
const fixturesHtml=render(played,'fixtures');assert.equal((fixturesHtml.match(/competition-fixture-card /g)||[]).length,8);assert.ok(fixturesHtml.includes('aria-label="O‘yinlar bosqichi"'));
const peopleHtml=render(played,'participants');assert.equal((peopleHtml.match(/class="u-participant"/g)||[]).length,20);
const standingsHtml=render(played,'standings');assert.ok(standingsHtml.includes('competition-standings'));assert.equal((standingsHtml.match(/<tr/g)||[]).length,21);
console.log('PASS UZEFLIFE tournament experience: fixed eight-bracket overview, 255 connected empty slots without database mutations, final qualifier sources, registration states, owner controls separated, custom navigation hidden until explicit restoration, and no phantom match actions.');
