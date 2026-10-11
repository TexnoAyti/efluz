import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutKnockout } from '../../lib/knockoutLayout';
import { CustomPlayoffBracket } from '../../components/customTournaments/CustomPlayoffBracket';
import { SofaBracketTree } from '../../components/SofaBracketTree';
import { generatePlayoffBracketFixtures } from '../services/customTournamentEngine';
import type { CustomTournamentParticipant } from '../../types/customTournament';
import type { Fixture } from '../../types';

for (const size of [4, 6, 8, 16, 20, 32]) {
 const participants: CustomTournamentParticipant[]=Array.from({length:size},(_,i)=>({id:`p${i}`,tournamentId:'layout-test',userId:`u${i}`,telegramId:String(i),clubId:`c${i}`,clubName:`Club ${i}`,clubShortName:`C${i}`,clubLogoUrl:'',status:'REGISTERED',joinedAt:''}));
 for(const mode of ['SINGLE_LEG','TWO_LEG'] as const){
  const fixtures=generatePlayoffBracketFixtures('layout-test',participants,mode);
  const before=JSON.stringify(fixtures);
  const first=fixtures.filter(f=>f.leg===1);
  const stages=[...new Set(first.map(f=>f.stage))];
  const rounds=stages.map(stage=>({key:stage==='PLAYOFF_FINAL'?'FINAL':stage,nodes:first.filter(f=>f.stage===stage).map(f=>({id:f.id,round:stage,targetId:f.nextMatchFixtureId||null}))}));
  const layout=layoutKnockout(rounds);
  const final=first.find(f=>f.stage==='PLAYOFF_FINAL')!;
  const center=layout.positions.get(final.id)!;
  assert.equal(center.x+102,layout.width/2,'Final is exactly centered');
  const earliest=first.filter(f=>f.stage===stages[0]);
  assert.equal(earliest.filter(f=>layout.positions.get(f.id)!.side==='left').length,earliest.length/2);
  assert.equal(earliest.filter(f=>layout.positions.get(f.id)!.side==='right').length,earliest.length/2);
  for(const f of first){
   const p=layout.positions.get(f.id)!;
   assert.ok(p.y>=32 && p.y+108<=layout.height,'No clipping above/below canvas');
   if(f.nextMatchFixtureId){const next=layout.positions.get(f.nextMatchFixtureId)!;assert.ok(next.side==='center'||p.side===next.side,'Existing winner links stay on their branch');}
   for(const other of first.filter(o=>o.id!==f.id)) {const q=layout.positions.get(other.id)!;if(q.x===p.x)assert.ok(Math.abs(q.y-p.y)>=108,'Cards do not overlap');}
  }
  const html=renderToStaticMarkup(React.createElement(CustomPlayoffBracket,{fixtures}));
  assert.equal((html.match(/data-fixture-id=/g)||[]).length,first.length,'Each tie renders once, including BYEs and the final');
  if(mode==='TWO_LEG')assert.equal((html.match(/title="2-o/g)||[]).length,first.length-1,'Second-leg results remain visible');
  assert.equal(JSON.stringify(fixtures),before,'Presentation never changes pairings or results');
  if(size===8 && mode==='TWO_LEG'){
   fixtures[0].status='CONFIRMED';
   fixtures[0].winnerClubId=fixtures[0].homeClubId;
   const partial=renderToStaticMarkup(React.createElement(CustomPlayoffBracket,{fixtures}));
   assert.equal(partial.includes('Finished'),false,'A completed first leg cannot mark an unfinished tie as finished');
  }
 }
}
// Domestic play-in links can feed only one half of a seeded R16 bracket.
const fixture=(id:string,roundName:string,homeSourceFixtureId?:string,awaySourceFixtureId?:string):Fixture=>({id,seasonId:'s',competitionId:'cup',roundName,matchday:1,homeClubId:null,awayClubId:null,status:'SCHEDULED',scheduledAt:'',createdAt:'',updatedAt:'',homeSourceFixtureId,awaySourceFixtureId});
const cup=[fixture('fix-cup-r1-m0','Play-in'),...Array.from({length:8},(_,i)=>fixture(`fix-cup-r2-m${i}`,'Round of 16',i===4?'fix-cup-r1-m0':undefined)),...Array.from({length:4},(_,i)=>fixture(`fix-cup-r3-m${i}`,'Quarter-final',`fix-cup-r2-m${i*2}`,`fix-cup-r2-m${i*2+1}`)),fixture('fix-cup-r4-m0','Semi-final','fix-cup-r3-m0','fix-cup-r3-m1'),fixture('fix-cup-r4-m1','Semi-final','fix-cup-r3-m2','fix-cup-r3-m3'),fixture('fix-cup-r5-m0','Final','fix-cup-r4-m0','fix-cup-r4-m1')];
const markup=renderToStaticMarkup(React.createElement(SofaBracketTree,{fixtures:cup}));
assert.equal((markup.match(/data-fixture-id=/g)||[]).length,cup.length);
assert.ok(markup.includes('1-tomon')&&markup.includes('2-tomon')&&markup.includes('Butun bracket'));
console.log('PASS centered knockout brackets: 4/6/8/16/20/32 clubs, both legs, BYEs, preserved winner links, no overlaps, central final, domestic play-in and rendered cards.');
