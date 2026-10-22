import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UzeflifeChampionship} from '../../components/uzeflife/UzeflifeChampionship';
import {UzeflifeImageExport} from '../../components/uzeflife/UzeflifeImageExport';
import {canExportUzeflifeImage,uzeflifeImageModel} from '../../lib/uzeflifeImage';
import {UzeflifeParticipants} from '../../components/uzeflife/UzeflifeParticipants';
import {UzeflifeBracket} from '../../components/uzeflife/UzeflifeBracket';
import {uDisplayMatches,uCanSeeCustomNavigation,uSourceLabel} from '../../lib/uzeflifePresentation';
import {initialUState,applyUAction} from '../services/uzeflifeService';
import type {UViewState} from '../../lib/uzeflifeApi';
import type {User} from '../../types';

const state:UViewState={...initialUState(),permissions:[],isOwner:false,isSuper:false};
const render=(s=state,initialTab:any='overview',userId?:string)=>renderToStaticMarkup(React.createElement(UzeflifeChampionship,{state:s,userId,busy:false,error:'',notice:'',missing:[],act:async()=>true,onRefresh:()=>{},initialTab}));
const html=render();
assert.ok(html.includes('Saralash setkalari')&&html.includes('Final bosqichi'));
assert.equal((html.match(/class="competition-panel u-bracket-entry"/g)||[]).length,8);
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
 assert.ok(management.includes('UZEFLIFE admin paneli'),'Admin entry opens management directly');
 assert.equal(management.includes('Adminlar boshqaruvi'),false,'Role management is a separate section');
}
const denied=renderToStaticMarkup(React.createElement(UzeflifeChampionship,{state,busy:false,error:'',notice:'',missing:[],act:async()=>true,onRefresh:()=>{},initialAdmin:true}));
assert.ok(!denied.includes('UZEFLIFE admin paneli'),'Initial admin request cannot grant missing permissions');
assert.ok(!ownerView.includes('<form')&&!ownerView.includes('Qur’a tashlash va turnirni boshlash'),'Owner setup stays behind management');
assert.equal(uCanSeeCustomNavigation(false),false,'Temporary hide also applies to owner');
assert.equal(uCanSeeCustomNavigation(true),true,'Explicit restoration still works');
const before=JSON.stringify(state);
const slots=uDisplayMatches(state);
assert.equal(slots.length,255);assert.ok(slots.every(m=>!m.home&&!m.away&&!m.winner));assert.equal(JSON.stringify(state),before,'Viewing fixed structure never changes enrollment or persisted fixtures');
for(let b=1;b<=8;b++){
 const tree=renderToStaticMarkup(React.createElement(UzeflifeBracket,{state,bracket:b,onMatch:()=>{}}));
 assert.equal((tree.match(/class="u-tree-match[ "]/g)||[]).length,31);
 assert.equal((tree.match(/class="u-tree-lines"[^>]*>([\s\S]*?)<\/svg>/)![1].match(/<path /g)||[]).length,30);
 assert.ok(!tree.includes('slot-'),'Display placeholders never masquerade as registered players');
}
const final=renderToStaticMarkup(React.createElement(UzeflifeBracket,{state,bracket:0,onMatch:()=>{}}));
assert.equal((final.match(/class="u-tree-match[ "]/g)||[]).length,7);
assert.equal((final.match(/class="u-tree-lines"[^>]*>([\s\S]*?)<\/svg>/)![1].match(/<path /g)||[]).length,6);
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

const playersView=(s:UViewState)=>renderToStaticMarkup(React.createElement(UzeflifeParticipants,{state:s,busy:false,act:async()=>true}));
const emptyPlayers=playersView(state);assert.ok(emptyPlayers.includes('O‘yinchini qo‘shish')&&emptyPlayers.includes('Telegram ID yoki EFLUZ akkaunt ID'));
const adminPeople=playersView(played);assert.equal((adminPeople.match(/class="u-player-row"/g)||[]).length,20);assert.ok(adminPeople.includes('O‘yinchini qidirish'));assert.ok(!adminPeople.includes('O‘yinchini qo‘shish'),'Enrollment is closed after the draw');

// Every championship state uses league primitives without organizer-workspace classes.
for(const stage of [state,{...state,status:'registration' as const},played])for(const tab of ['overview','fixtures','bracket','participants','results','standings']){
 const markup=render(stage,tab);
 assert.ok(markup.includes('competition-page uzeflife')&&markup.includes('efl-league-banner-content'),'Championship shares league layout and heading');
 assert.ok(markup.includes('competition-tabs-grid'),'Dense navigation retains the shared horizontal league tabs');
 assert.ok(!markup.includes('tourney-')&&!markup.includes('efl-custom-tournaments'),'No organizer controls or layout inheritance in public championship');
}
assert.ok(!emptyPlayers.includes('tourney-'),'Player enrollment uses the league control scale');
console.log('PASS shared league presentation across draft, registration, playing, six public sections, enrollment and management permissions.');

// Keep the approved compact bracket geometry while presenting richer match states.
const bracketMarkup=(s:UViewState,b=1,userId?:string)=>renderToStaticMarkup(React.createElement(UzeflifeBracket,{state:s,bracket:b,userId,onMatch:()=>{}}));
const compact=bracketMarkup(state);
assert.ok(compact.includes('width:1976px;height:1040px'),'32-player qualifier footprint is unchanged');
assert.equal((compact.match(/width:200px;height:108px/g)||[]).length,31,'All match cards retain their exact dimensions');
assert.ok(compact.includes('left:888px;top:482px;width:200px;height:108px'),'Final remains centered in the existing tree');
assert.ok(bracketMarkup(state,0).includes('width:1088px;height:296px'),'Eight-player finals footprint is unchanged');
const firstMatch=slots[0];
const detailed={...state,status:'playing' as const,round:1,participants:[{id:'home',name:'Abdurahmonov Muhammadazizbek',status:'approved' as const},{id:'away',name:'Azamatjon Arslonov',status:'approved' as const}],matches:slots.map(m=>m.id===firstMatch.id?{...m,home:'home',away:'away',winner:'home',homeScore:2,awayScore:2,penaltyHome:5,penaltyAway:4}:m)};
const scored=bracketMarkup(detailed,1,'home');
assert.ok(scored.includes('u-tree-link-complete')&&scored.includes('u-tree-winner')&&scored.includes('u-tree-loser'));
assert.ok(scored.includes('(5)')&&scored.includes('(4)')&&scored.includes('penaltilar 5:4'));
assert.ok(scored.includes('G‘olib: Abdurahmonov Muhammadazizbek')&&scored.includes('Sizning o‘yiningiz'),'Match details remain accessible with full names, winner, scores and own-match context');
const waiting=bracketMarkup({...detailed,matches:detailed.matches.map(m=>m.id===firstMatch.id?{...m,winner:null,homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null}:m)},1,'away');
assert.ok(waiting.includes('is-current')&&waiting.includes('is-mine'));
console.log('PASS playoff styling states and unchanged 32-player / eight-player tree geometry.');

// Cup-style connections have an explicit no-fill SVG contract, even before CSS loads.
const connectorSvg=compact.match(/class="u-tree-lines"[^>]*>([\s\S]*?)<\/svg>/)![1];
const connections=[...connectorSvg.matchAll(/<path ([^>]+)>/g)].map(m=>m[1]);
assert.equal(connections.length,30);
for(const attributes of connections){assert.ok(attributes.includes('fill="none"')&&attributes.includes('stroke="url(#uzeflife-cup-line-'));assert.ok(/d="M [^"]+ C /.test(attributes),'Connections use the cup bracket curves instead of square elbows');}
assert.ok(compact.includes('efl-theme-connector-start')&&compact.includes('efl-theme-connector-end'));
assert.ok(compact.includes('u-tree-final efl-theme-final'),'Final shares the existing cup gold surface');
const twoTrees=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(UzeflifeBracket,{state,bracket:1,onMatch:()=>{}}),React.createElement(UzeflifeBracket,{state,bracket:2,onMatch:()=>{}})));
const gradientIds=[...twoTrees.matchAll(/<linearGradient id="([^"]+)"/g)].map(m=>m[1]);
assert.equal(gradientIds.length,2);assert.equal(new Set(gradientIds).size,2,'Separate brackets never reference another SVG gradient');
console.log('PASS cup gradient/curved connectors, explicit no-fill paths, gold final and unique SVG IDs.');

// The existing PNG export pipeline is exposed only to tournament match/result admins.
for(const permissions of [[],['participants'],['channels'],['registrations']] as any[]){
 assert.equal(canExportUzeflifeImage(permissions),false);
 const hidden=renderToStaticMarkup(React.createElement(UzeflifeImageExport,{state:{...played,permissions},matches:played.matches.slice(0,8)}));
 assert.equal(hidden,'','Players and unrelated assistants never receive an export control');
}
for(const permission of ['matches','results'] as const){
 const visible=render({...played,permissions:[permission]},'fixtures');
 assert.ok(visible.includes('O‘yinlar rasmini yuklab olish')&&visible.includes('shu sahifadagi 8 ta o‘yin'));
}
const exported=uzeflifeImageModel(detailed,[detailed.matches[0]],'season-2026-27');
assert.equal(exported.identityKind,'players');assert.equal(exported.rows[0].name,'Abdurahmonov Muhammadazizbek');
assert.equal(exported.rows[0].score,'2 : 2');assert.equal(exported.rows[0].winner,'home');assert.equal(exported.rows[0].status,'Pen: 5 : 4');assert.ok(exported.rows[0].detail?.includes('1-setka'));
assert.throws(()=>uzeflifeImageModel(state,[slots[0]],'season-2026-27'),/haqiqiy/,'Display-only placeholders cannot be exported as scheduled matches');
console.log('PASS admin-only game PNG control, page selection, verified scores/shootouts, player identities and no placeholder exports.');
