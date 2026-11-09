import assert from 'node:assert/strict';
import {previewSeasonOneSupercup,previewManualSeasonOneSupercup,SEASON_ONE_SUPERCUPS} from '../tournament/seasonOneSupercupPlan';

const ranking=Array.from({length:20},(_,i)=>`club-${i+1}`);
const cup={status:'CONFIRMED',homeClubId:'club-3',awayClubId:'club-4',winnerClubId:'club-3'};
for(const id of Object.keys(SEASON_ONE_SUPERCUPS)){
 const p=previewSeasonOneSupercup({competitionId:id,leagueComplete:true,cupFinal:cup,
  rankedClubIds:ranking,existingFixtureCount:0});
 assert.equal(p.canCreate,true,id);
 assert.equal(p.qualifiers.length,SEASON_ONE_SUPERCUPS[id as keyof typeof SEASON_ONE_SUPERCUPS].size);
 assert.equal(new Set(p.qualifiers.map(q=>q.clubId)).size,p.size);
 assert.equal(p.pairings.length,p.size/2);
}
const sameWinner={...cup,homeClubId:'club-1',winnerClubId:'club-1'};
const two=previewSeasonOneSupercup({competitionId:'comp-community-shield-2026',leagueComplete:true,
 cupFinal:sameWinner,rankedClubIds:ranking,existingFixtureCount:0});
assert.deepEqual(two.qualifiers.map(q=>q.clubId),['club-1','club-2']);
const four=previewSeasonOneSupercup({competitionId:'comp-supercopa-espana-2026',leagueComplete:true,
 cupFinal:{...cup,homeClubId:'club-1',awayClubId:'club-2',winnerClubId:'club-2'},
 rankedClubIds:ranking,existingFixtureCount:0});
assert.deepEqual(four.qualifiers.map(q=>q.clubId),['club-1','club-2','club-3','club-4']);
assert.deepEqual(four.pairings,[
 {homeClubId:'club-1',awayClubId:'club-4'},
 {homeClubId:'club-2',awayClubId:'club-3'},
]);
for(const [opts,expected] of [
 [{leagueComplete:false},'LEAGUE_NOT_COMPLETE'],
 [{cupFinal:null},'CUP_FINAL_NOT_CONFIRMED'],
 [{existingFixtureCount:1},'SUPERCUP_ALREADY_GENERATED'],
 [{rankedClubIds:['club-1','club-1']},'INVALID_LEAGUE_RANKING'],
] as const){
 const p=previewSeasonOneSupercup({competitionId:'comp-supercopa-espana-2026',
 leagueComplete:true,cupFinal:cup,existingFixtureCount:0,...opts,
 rankedClubIds:'rankedClubIds' in opts?[...opts.rankedClubIds]:ranking});
 assert.equal(p.canCreate,false);
 assert.ok(p.blockReasons.includes(expected),expected);
 assert.deepEqual(p.pairings,[]);
}
assert.throws(()=>previewSeasonOneSupercup({competitionId:'comp-uefa-super-cup-2026',
 leagueComplete:true,cupFinal:cup,rankedClubIds:ranking,existingFixtureCount:0}),
 /INVALID_SEASON_ONE_SUPERCUP/);
console.log('PASS_SEASON_ONE_SUPERCUPS: 4 competitions, duplicate winners, source gates, deterministic seeding');

for(const id of Object.keys(SEASON_ONE_SUPERCUPS)){
 const size=SEASON_ONE_SUPERCUPS[id as keyof typeof SEASON_ONE_SUPERCUPS].size;
 const clubs=ranking.slice(0,size);
 const plan=previewManualSeasonOneSupercup({competitionId:id,selectedClubIds:clubs,
  validClubIds:ranking,existingFixtureCount:0,existingParticipantCount:0});
 assert.equal(plan.canCreate,true,id);
 assert.equal(plan.pairings.length,size===2?1:2);
 assert.deepEqual(plan.qualifiers.map(q=>q.clubId),clubs);
}
assert.equal(SEASON_ONE_SUPERCUPS['comp-supercoppa-italiana-2026'].size,2);
for(const opts of [
 {selectedClubIds:['club-1'],existingFixtureCount:0,existingParticipantCount:0},
 {selectedClubIds:['club-1','club-1'],existingFixtureCount:0,existingParticipantCount:0},
 {selectedClubIds:['club-1','stranger'],existingFixtureCount:0,existingParticipantCount:0},
 {selectedClubIds:['club-1','club-2'],existingFixtureCount:1,existingParticipantCount:0},
 {selectedClubIds:['club-1','club-2'],existingFixtureCount:0,existingParticipantCount:1},
]){
 const p=previewManualSeasonOneSupercup({competitionId:'comp-supercoppa-italiana-2026',
  validClubIds:ranking,...opts});
 assert.equal(p.canCreate,false);
 assert.equal(p.pairings.length,0);
}
console.log('PASS_MANUAL_SUPERCUP_START: 2026 Italian format, manual selection, duplicates and existing fixture safety');
