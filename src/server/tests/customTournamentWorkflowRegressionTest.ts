import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {generateTournamentPreview} from '../../lib/customTournamentEngine';
import {generatePlayoffBracketFixtures,generateRoundRobinFixtures} from '../services/customTournamentEngine';
import {initialSchedule,reconcileLeague,reconcilePlayoff} from '../services/customTournamentLifecycle';
import {isCustomMatchReady,customMatchNeedsPenalties} from '../../lib/customTournamentMatches';
import {TournamentAdminDrawer} from '../../components/customTournaments/TournamentAdminDrawer';
import type {CustomTournament,CustomTournamentParticipant} from '../../types/customTournament';

const tournament:CustomTournament={id:'workflow',name:'Workflow',organizerUserId:'owner',organizerTelegramId:'',assistantAdminIds:[],status:'IN_PROGRESS',visibility:'PUBLIC_OPEN',spectatorAccess:'PUBLIC_LINK',inviteToken:'',spectatorToken:'',format:'LEAGUE_AND_PLAYOFF',leagueScope:'TOP5_ALL',maxParticipants:8,currentParticipantsCount:8,rules:{roundsCount:1,playoffLegMode:'SINGLE_LEG',matchDurationHours:24,playoffQualifiersCount:2},createdAt:'',updatedAt:''};
const players:CustomTournamentParticipant[]=Array.from({length:32},(_,i)=>({id:'p'+i,tournamentId:tournament.id,userId:'u'+i,telegramId:'',clubId:'c'+i,clubName:'Club '+i,clubShortName:'C'+i,clubLogoUrl:'',status:'REGISTERED',joinedAt:''}));
for(let n=4;n<=32;n++)for(const roundsCount of [1,2] as const){
 const fixtures=generateRoundRobinFixtures('test',players.slice(0,n),roundsCount);
 const preview=generateTournamentPreview('LEAGUE',n,{roundsCount});
 assert.equal(preview.totalMatches,fixtures.length);
 assert.equal(preview.totalStagesOrRounds,Math.max(...fixtures.map(f=>f.roundOrMatchday)));
 for(const playoffLegMode of ['SINGLE_LEG','TWO_LEG'] as const){
  const knockout=generatePlayoffBracketFixtures('test',players.slice(0,n),playoffLegMode);
  assert.equal(generateTournamentPreview('PLAYOFF',n,{playoffLegMode}).totalMatches,knockout.filter(f=>f.status!=='BYE_AUTO_ADVANCED').length);
  for(const groupStageMode of ['GROUPS','SINGLE_TABLE'] as const)for(const groupsCount of [2,4] as const){
   if(groupStageMode==='GROUPS'&&groupsCount*2>n)continue;
   const rules={roundsCount,playoffLegMode,groupStageMode,groupsCount,playoffQualifiersCount:4 as const,matchDurationHours:24};
   const t={...tournament,rules};
   const league=initialSchedule(t,structuredClone(players.slice(0,n)),Date.now());
   const ko=generatePlayoffBracketFixtures('test',players.slice(0,4),playoffLegMode);
   const p=generateTournamentPreview('LEAGUE_AND_PLAYOFF',n,rules);
   assert.equal(p.totalMatches,league.length+ko.length);
   assert.equal(p.totalStagesOrRounds,Math.max(...league.map(f=>f.roundOrMatchday))+2);
  }
 }
}
const t=structuredClone(tournament), participants=players.slice(0,4);
const fixtures=generateRoundRobinFixtures(t.id,participants);
for(const f of fixtures){f.status='CONFIRMED';f.homeScore=1;f.awayScore=0;}
reconcileLeague(t,participants,fixtures,new Date().toISOString());
const ko=fixtures.filter(f=>f.stage.startsWith('PLAYOFF'));
assert.equal(ko.length,1,'Two qualifiers go straight to the final, without phantom semifinal BYEs');
assert.equal(ko[0].stage,'PLAYOFF_FINAL');
assert.equal(ko[0].roundOrMatchday,1);
assert.ok(isCustomMatchReady(ko[0],fixtures));
ko[0].status='CONFIRMED';ko[0].homeScore=1;ko[0].awayScore=1;ko[0].penaltyHomeScore=3;ko[0].penaltyAwayScore=1;
reconcilePlayoff(t,fixtures,new Date().toISOString());
assert.equal(t.status,'COMPLETED');assert.equal(t.winnerClubId,ko[0].homeClubId);

const two=generatePlayoffBracketFixtures('two',participants,'TWO_LEG');
const first=two.find(f=>f.leg===1&&f.roundOrMatchday===1)!;
const second=two.find(f=>f.id===first.id.replace('_l1','_l2'))!;
assert.equal(isCustomMatchReady(second,two),false);
assert.equal(customMatchNeedsPenalties(first,two,1,1),false,'First-leg draw needs no shootout');
first.status='CONFIRMED';first.homeScore=2;first.awayScore=0;
assert.ok(isCustomMatchReady(second,two));
assert.ok(customMatchNeedsPenalties(second,two,2,0),'Aggregate, rather than second-leg draw, controls the shootout');
assert.equal(customMatchNeedsPenalties(second,two,0,0),false);
const locked=renderToStaticMarkup(React.createElement(TournamentAdminDrawer,{isOpen:true,onClose:()=>{},tournament:{...tournament,format:'PLAYOFF'},participants,fixtures:two.map(f=>f.id===first.id?{...f,status:'SCHEDULED' as const}:f),onRefresh:()=>{},isOrganizer:true,initialTab:'matches',initialFixtureId:second.id}));
assert.equal(locked.includes('Rasmiy natijani saqlash'),false);
const html=renderToStaticMarkup(React.createElement(TournamentAdminDrawer,{isOpen:true,onClose:()=>{},tournament:{...tournament,format:'PLAYOFF'},participants,fixtures:two,onRefresh:()=>{},isOrganizer:true,initialTab:'matches',initialFixtureId:second.id}));
assert.ok(html.includes('Rasmiy natijani saqlash'),'A ready match opens its official result form directly');
console.log('PASS tournament workflow: 4–32 team preview/schedule matrix, one/two rounds and legs, uneven groups, two-qualifier final/champion, aggregate shootouts and direct/locked management forms.');
