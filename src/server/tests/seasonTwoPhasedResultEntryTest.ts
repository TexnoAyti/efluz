import assert from 'node:assert/strict';
import {backlogResultAllowed,secondSeasonLeagueResultLimit,secondSeasonCupLeagueId} from '../services/backlogResultEntry';

const seasonId='season-2027-28';
function league(id:string,totalMatchdays:number,extra:Record<string,unknown>={}){
  return {id,seasonId,type:'LEAGUE',status:'active',currentMatchday:1,
    totalMatchdays,leagueId:id.replace('comp-','league-').replace('-2027',''),
    resultEntryThroughMatchday:1,...extra};
}
function fixture(competitionId:string,matchday:number){
  return {id:'test-'+matchday,seasonId,competitionId,matchday,status:'SCHEDULED',
    homeClubId:'club-a',awayClubId:'club-b'};
}
for(const [id,total] of [['comp-premier-league-2027',19],['comp-bundesliga-2027',17],
  ['comp-uzbekistan-superliga-2027',15]] as const){
  const initial=league(id,total);
  assert.equal(secondSeasonLeagueResultLimit(id,initial),total);
  // Every scheduled round is playable, even if the header says "current round 1".
  for(const n of [1,3,9,10,total])assert.equal(backlogResultAllowed(fixture(id,n),initial),true);
  // Changing only the displayed/current matchday never locks an unfinished match.
  const advanced=league(id,total,{currentMatchday:total,resultEntryThroughMatchday:1});
  for(const n of [1,10,total])assert.equal(backlogResultAllowed(fixture(id,n),advanced),true);
  const started=league(id,total,{seasonTwoCupStartedAt:'2026-11-17T12:00:00.000Z',
    resultEntryThroughMatchday:total,currentMatchday:10});
  for(const n of [1,9,10,total])
    assert.equal(backlogResultAllowed(fixture(id,n),started),true);
  assert.equal(backlogResultAllowed(fixture(id,total+1),started),false);
  assert.equal(backlogResultAllowed(fixture(id,4),started,{isLocked:true}),false);
  assert.equal(backlogResultAllowed(fixture(id,4),{...started,adminOverrideStatus:'PAUSED'}),false);
  assert.equal(backlogResultAllowed({...fixture(id,4),status:'CONFIRMED'},started),false);
}
assert.equal(secondSeasonCupLeagueId('comp-uzbekistan-cup-2027'),'league-uzbekistan-superliga');
assert.equal(secondSeasonCupLeagueId('comp-fa-cup-2027'),'league-premier-league');
assert.equal(secondSeasonCupLeagueId('comp-champions-league-2027'),null);
const old=league('comp-premier-league-2026',19);
assert.equal(secondSeasonLeagueResultLimit(old.id,{...old,seasonId:'season-2026-27'}),null);
console.log('SEASON_TWO_ALL_ROUNDS_RESULT_ENTRY_PASS');
