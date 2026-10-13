import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TournamentAdminDrawer} from '../../components/customTournaments/TournamentAdminDrawer';
import {TournamentWizardModal} from '../../components/customTournaments/TournamentWizardModal';
import {tournamentStartBlocker} from '../../lib/customTournamentLabels';
import type {CustomTournament,CustomTournamentParticipant,CustomTournamentFixture} from '../../types/customTournament';
const t:CustomTournament={id:'ct_management_layout',name:'X'.repeat(60),description:'A tournament description',organizerUserId:'owner',organizerTelegramId:'123',organizerUsername:'organizer',assistantAdminIds:['p1'],status:'REGISTRATION_OPEN',visibility:'PUBLIC_MODERATED',spectatorAccess:'PUBLIC_LINK',inviteToken:'inv_layout',spectatorToken:'spec_layout',format:'LEAGUE_AND_PLAYOFF',leagueScope:'TOP5_ALL',maxParticipants:8,currentParticipantsCount:4,rules:{roundsCount:1,playoffLegMode:'TWO_LEG',matchDurationHours:36,playoffQualifiersCount:8},createdAt:'2026-10-13T10:00:00Z',updatedAt:'2026-10-13T10:00:00Z'};
const participants=Array.from({length:4},(_,i)=>({id:'part'+i,tournamentId:t.id,userId:'p'+i,telegramId:String(100+i),username:'name'.repeat(10),clubId:'club'+i,clubName:'Long football club name '+i,clubShortName:'LFC',clubLogoUrl:'',status:'REGISTERED',joinedAt:t.createdAt} as CustomTournamentParticipant));
const fixtures=[{id:'match',tournamentId:t.id,stage:'PLAYOFF_SF',roundOrMatchday:1,matchIndex:0,leg:1,homeClubId:'club0',awayClubId:'club1',homeClubName:'Long home club name',awayClubName:'Long away club name',status:'DISPUTED',deadlineAt:t.createdAt} as CustomTournamentFixture];
function render(tab:'overview'|'participants'|'matches'|'settings'|'history',owner=true,status:CustomTournament['status']='REGISTRATION_OPEN'){
 return renderToStaticMarkup(React.createElement(TournamentAdminDrawer,{isOpen:true,initialTab:tab,isOrganizer:owner,tournament:{...t,status},participants,fixtures,onClose:()=>{},onRefresh:()=>{}}));
}
for(const tab of ['overview','participants','matches','settings','history'] as const){
 const html=render(tab,true,tab==='matches'?'IN_PROGRESS':'REGISTRATION_OPEN');
 assert.ok(html.includes('role="dialog"')&&html.includes('100dvh'));
 assert.ok(html.includes('grid-cols-3 sm:grid-cols-5')&&html.includes('overflow-x-hidden')&&html.includes('min-w-0'));
 const visible=html.replace(/<[^>]*>/g,'');
 for(const code of ['PUBLIC_MODERATED','IN_PROGRESS','PENDING_CONFIRMATION','DISPUTED','Foydalanuvchi IDsi'])assert.equal(visible.includes(code),false,tab+': raw internal labels');
}
assert.ok(render('overview').includes('Qatnashchilar soni guruh yoki pley-off reglamentiga yetmaydi.'));
assert.equal(tournamentStartBlocker(t,participants), 'Qatnashchilar soni guruh yoki pley-off reglamentiga yetmaydi.');
assert.equal(tournamentStartBlocker({...t,rules:{...t.rules,playoffQualifiersCount:4}},participants),null);
assert.ok(render('settings',true).includes('Sozlamalarni saqlash'));
assert.equal(render('settings',false).includes('Sozlamalarni saqlash'),false);
assert.equal(render('settings',false).includes('>Bekor qilish<'),false);
assert.equal(render('overview',false).includes('>Turnirni boshlash<'),false);
assert.ok(render('participants').includes('Turnirdan chiqarish'));
assert.equal(render('participants',true,'IN_PROGRESS').includes('Turnirdan chiqarish'),false);
assert.ok(render('matches',true,'IN_PROGRESS').includes('Nizoli'));
const wizard=renderToStaticMarkup(React.createElement(TournamentWizardModal,{isOpen:true,onClose:()=>{},onTournamentCreated:()=>{}}));
assert.equal(wizard.includes('Sizning klubingiz *'),false);
assert.equal(wizard.includes('Faqat tashkilotchi bo‘laman'),false);
assert.equal(wizard.includes('Klub qidirish'),false);
assert.ok(wizard.includes('o‘zingiz ham qatnashchilar kabi klub tanlab qo‘shilishingiz mumkin'));
console.log('PASS management UI: owner/assistant controls, lifecycle locks, qualifier start blocker, readable labels, responsive structural constraints, and creation without a club. SSR checks do not prove browser layout.');
