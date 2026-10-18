import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { clubsRouter } from '../routes/clubs.routes';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';
import { loadFixtureClubPositions } from '../../lib/useFixtureClubPositions';
import type { Fixture } from '../../types';

await initDatabase();
const bridge = await startMockUpstashBridge();
const db = getFirestoreDb(), season = 'season-2026-27';
const league = 'comp-premier-league-2026', cup = 'comp-fa-cup-2026', supercup = 'comp-community-shield-2026', euro = 'comp-champions-league-2026';
const stamp = '2026-10-18T12:00:00.000Z';
const home = { id:'club-ipswich',name:'Ipswich Town',shortName:'IPS',leagueId:'league-premier-league',logoUrl:'',country:'England',active:true,createdAt:stamp,claimedByUsername:'secret-user' };
const away = { ...home,id:'club-sunderland',name:'Sunderland',shortName:'SUN' };
const fixture = (id:string, competitionId = league, patch:any = {}) => ({
  id,competitionId,seasonId:season,matchday:1,homeClubId:home.id,awayClubId:away.id,
  homeClub:home,awayClub:away,scheduledAt:stamp,status:'SCHEDULED',createdAt:stamp,updatedAt:stamp,
  homeScore:99,awayScore:98,proofUrl:'private-proof',userSubmission:{homeScore:99},opponentSubmission:{awayScore:98}, ...patch,
});
const rows = Array.from({length:103},(_,i) => fixture(`profile-league-${String(i).padStart(3,'0')}`,league,{matchday:i+1}));
rows.push(fixture('profile-cup',cup,{status:'CONFIRMED',homeScore:1,awayScore:1,homeExtraTimeScore:2,awayExtraTimeScore:2,homePenaltyScore:4,awayPenaltyScore:3}));
rows.push(fixture('profile-supercup',supercup),fixture('profile-europe',euro,{europeanDrawId:'published-draw'}),fixture('profile-hidden-europe',euro,{europeanDrawId:'previous-draw'}));
rows.push(fixture('profile-deleted'),fixture('profile-old-season',league,{seasonId:'season-2025-26'}),fixture('profile-other-clubs',league,{homeClubId:'club-arsenal',awayClubId:'club-chelsea'}));
await db.collection('competitions').doc(euro).set({id:euro,seasonId:season,europeanQualificationMode:'final',europeanQualificationToken:'approved',europeanDrawId:'published-draw',europeanDrawQualificationToken:'approved'});
await redisSetRaw(ReadModelKeys.adminFixtures(season),{data:rows,generatedAt:stamp});
await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:[{...home,isOccupied:false},{...away,isOccupied:false}]});
await addFixtureTombstone({fixtureId:'profile-deleted',seasonId:season,deletedAt:stamp});
const app = express();app.use('/api/clubs',clubsRouter);
const server = app.listen(0,'127.0.0.1');await once(server,'listening');
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
try {
  const response = await fetch(`${origin}/api/clubs/${home.id}/fixtures?seasonId=${season}`);
  assert.equal(response.status,200,await response.clone().text());
  const result = await response.json() as any;
  assert.equal(result.fixtures.length,106,'All pages are included, not only the first 100 league games');
  const ids = new Set(result.fixtures.map((f:any)=>f.id));
  for (const id of ['profile-cup','profile-supercup','profile-europe','profile-league-102']) assert.ok(ids.has(id),id);
  for (const id of ['profile-hidden-europe','profile-old-season','profile-other-clubs','profile-deleted']) assert.equal(ids.has(id),false,id);
  for (const f of result.fixtures) {
    assert.equal(f.proofUrl,undefined);assert.equal(f.userSubmission,undefined);assert.equal(f.opponentSubmission,undefined);
    assert.equal(f.homeClub?.claimedByUsername,undefined);
    if(f.status!=='CONFIRMED') assert.equal(f.homeScore,null,'A pending proposal is never published as a final score');
  }
  assert.equal(result.fixtures.find((f:any)=>f.id==='profile-cup').homePenaltyScore,4);
  assert.equal((await fetch(`${origin}/api/clubs/${home.id}/fixtures?seasonId=bad`)).status,400);

  const comps = [{id:league,type:'LEAGUE',leagueId:home.leagueId,seasonId:season}, {id:'wrong-season',type:'LEAGUE',leagueId:home.leagueId,seasonId:'season-2025-26'}];
  const requests:string[]=[];
  const client:any = { getCompetitions:async()=>({competitions:comps}),getCompetitionStandings:async(id:string,_skip:boolean,selectedSeason:string)=>{
    requests.push(id);assert.equal(selectedSeason,season);
    return {standings:[{clubId:'club-current-user',position:20},{clubId:home.id,position:16},{clubId:away.id,position:7}]};
  }};
  const positions = await loadFixtureClubPositions(fixture('rank') as Fixture,season,client);
  assert.deepEqual(positions,{[home.id]:16,[away.id]:7});assert.deepEqual(requests,[league]);
  const reversed = await loadFixtureClubPositions(fixture('reverse',cup,{homeClubId:away.id,awayClubId:home.id,homeClub:away,awayClub:home}) as Fixture,season,client);
  assert.deepEqual(reversed,positions,'Home/away reversal never substitutes the selected user club rank');
  const cross = {...fixture('cross',euro),awayClubId:'club-barcelona',awayClub:{...away,id:'club-barcelona',leagueId:'league-la-liga'}} as Fixture;
  const crossClient:any = {getCompetitions:async()=>({competitions:[...comps,{id:'la-liga',type:'LEAGUE',leagueId:'league-la-liga',seasonId:season}]}),getCompetitionStandings:async(id:string)=>({standings:id==='la-liga'?[{clubId:'club-barcelona',position:2}]:[{clubId:home.id,position:16}]})};
  assert.deepEqual(await loadFixtureClubPositions(cross,season,crossClient),{[home.id]:16,'club-barcelona':2});
  crossClient.getCompetitionStandings=async(id:string)=>{if(id==='la-liga')throw new Error('offline');return {standings:[{clubId:home.id,position:16}]};};
  assert.deepEqual(await loadFixtureClubPositions(cross,season,crossClient),{[home.id]:16},'Missing opponent table remains unknown, never copied from another club');
  console.log('PASS public club all-competition fixtures, pagination, season and publication gates, deleted fixtures, public score projection, independent home/away ranks and cross-league failure isolation.');
} finally { server.close(); await bridge.close(); }
