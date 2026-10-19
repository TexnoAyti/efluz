import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {TeamLeagueDetail} from '../../components/teamLeaguePreview/TeamLeagueDetail';
import {TeamTournamentWizard} from '../../components/teamLeaguePreview/TeamTournamentWizard';
import {makeTeamSchedule,teamFormatPreview,teamStandings,teamPlayerStats} from '../../lib/teamLeagueEngine';
import type {PreviewTeam,TeamLeague} from '../../types/teamLeaguePreview';
const teams:PreviewTeam[]=Array.from({length:4},(_,i)=>({id:`tp_uxteam0${i}`,name:['Tashkent United','Samarqand Stars','Buxoro Legends','Farg‘ona City'][i],ownerId:'test',logo:'',members:Array.from({length:4},(_,m)=>({id:`tp_player${i}00${m}`,name:`Player ${i}-${m}`})),captainMemberId:`tp_player${i}000`,version:1,updatedAt:''}));
const base:TeamLeague={id:'tp_uxleague',name:'Team Cup',description:'Tarkiblar va turlar',format:'LEAGUE_AND_PLAYOFF',qualifiers:2,ownerId:'test',teamIds:teams.map(t=>t.id),starterCount:3,rounds:1,status:'ACTIVE',currentRound:1,totalRounds:4,fixtures:makeTeamSchedule('tp_uxleague',teams.map(t=>t.id),1),teams:Object.fromEntries(teams.map(t=>[t.id,t])),version:1,updatedAt:'',audit:[]};
const props={teams,busy:false,act:()=>{},edit:()=>{},confirm:()=>{},onBack:()=>{},onRefresh:()=>{}};
const view=(league:TeamLeague,tab?:string,open='')=>render(React.createElement(TeamLeagueDetail,{...props,league,initialTab:tab,initialOpenFixtureId:open}));
const overview=view(base);assert.ok(overview.includes('1-TUR'));assert.ok(overview.includes('Tur tanlash'));assert.equal(overview.includes('team-secondary-nav'),false);assert.equal(overview.includes('Turnir reglamenti'),false);assert.ok(overview.includes('Boshqaruv'));assert.equal(overview.includes('TEAM <'),false,'No separate marketing hero inside the competition flow');
const fixture=base.fixtures[0],lineup=view(base,'fixtures',fixture.id);assert.ok(lineup.includes('Sardor:'));assert.ok(lineup.includes('Player'));assert.ok(lineup.includes('Tarkibni tasdiqlash'));assert.equal(lineup.includes(teams.find(t=>t.id===fixture.awayTeamId)!.members[0].name),false,'Only the current captain roster is expanded');assert.equal(lineup.includes('Team turniri bo‘limlari'),false,'Fixture is a focused page, outside the tournament navigation');assert.ok(lineup.includes('Uchrashuvlar'));assert.equal(lineup.includes('Juftliklarni tuzish'),false,'Pairing is not the first task before lineups');
assert.ok(view(base,'standings').includes('Birinchi 2 team pley-offga chiqadi'));assert.ok(view(base,'players').includes('O‘yinchi statistikasi'));assert.ok(view(base,'rules').includes('Turnir reglamenti'));assert.ok(view({...base,status:'DRAFT'}).includes('Turnirni boshlash'));assert.equal(view({...base,status:'CANCELLED'}).includes('Turnirni boshlash'),false);
for(const step of [1,2,3] as const){const html=render(React.createElement(TeamTournamentWizard,{league:{...base,status:'DRAFT'},teams,busy:false,save:()=>{},initialStep:step}));assert.ok(html.includes(`${step}/3`));if(step===1)for(const label of ['Liga','Pley-off','Liga + pley-off'])assert.ok(html.includes(label));if(step===2)assert.ok(html.includes('Samarqand Stars'));if(step===3){assert.ok(html.includes('7'));assert.ok(html.includes('21'));assert.ok(html.includes('4'));assert.ok(html.includes('O‘zgarishlarni saqlash'));}}

const shortRoster=render(React.createElement(TeamLeagueDetail,{...props,teams:teams.map((t,i)=>i===0?{...t,members:t.members.slice(0,1)}:t),league:{...base,status:'DRAFT'}}));
assert.ok(shortRoster.includes('Tarkib yetarli emas:'));assert.match(shortRoster,/disabled=""[^>]*>Turnirni boshlash/,'A draft with an undersized roster cannot be started from the client');
const homeTeam=teams.find(t=>t.id===fixture.homeTeamId)!,awayTeam=teams.find(t=>t.id===fixture.awayTeamId)!;
const line=(team:PreviewTeam)=>({starters:team.members.slice(0,3).map(m=>m.id),reserves:[team.members[3].id]});
const homeReady={...fixture,homeLineup:line(homeTeam)};
const withFixture=(f:typeof fixture)=>({...base,fixtures:base.fixtures.map(g=>g.id===f.id?f:g)});
const awayView=view(withFixture(homeReady),'fixtures',fixture.id);
assert.ok(awayView.includes(awayTeam.members[0].name));assert.equal(awayView.includes(homeTeam.members[0].name),false,'After the home captain saves, the next task is the away lineup');
const bothReady={...homeReady,awayLineup:line(awayTeam)};
const pairView=view(withFixture(bothReady),'fixtures',fixture.id);
assert.ok(pairView.includes('Ikkala tarkib tayyor'));assert.ok(pairView.includes('Juftliklarni tuzish'));assert.equal(pairView.includes('Tarkibni tasdiqlash'),false);
const paired={...bothReady,bouts:homeReady.homeLineup.starters.map((id,i)=>({id:`uxbout${i}`,homeMemberId:id,awayMemberId:bothReady.awayLineup.starters[i],homeScore:null,awayScore:null}))};
const resultView=view(withFixture(paired),'fixtures',fixture.id);
assert.equal((resultView.match(/class="team-individual-result"/g)||[]).length,3);
assert.equal((resultView.match(/class="team-individual-result"[^>]*open=""/g)||[]).length,1,'Only the first pending score form opens initially');
assert.ok(resultView.includes('zaxira almashtirish'));assert.equal(resultView.includes('Tarkibni tasdiqlash'),false);
const wizardWithCreate=render(React.createElement(TeamTournamentWizard,{teams:[],busy:false,save:()=>{},onCreateTeam:()=>{},initialStep:2}));
assert.ok(wizardWithCreate.includes('Team qo‘shish'));assert.ok(wizardWithCreate.includes('Shu oynaning o‘zida'));assert.equal(wizardWithCreate.includes('Avval Teamlar bo‘limida'),false);

assert.deepEqual(teamFormatPreview(4,'PLAYOFF'),{matches:3,rounds:2});assert.deepEqual(teamFormatPreview(4,'LEAGUE_AND_PLAYOFF',2,4),{matches:15,rounds:8});
const legacy={...base,format:undefined,qualifiers:undefined};assert.ok(view(legacy,'standings').includes('Liga jadvali'));assert.equal(teamStandings(base).length,4);assert.equal(teamPlayerStats(base).length,16);
console.log('PASS team tournament workspace: four main sections, focused fixture pages, sequential captain lineups, gated pairing, one pending result editor, reserves, inline team creation, wizard formats, qualification, statistics, cancellation and legacy rendering.');
