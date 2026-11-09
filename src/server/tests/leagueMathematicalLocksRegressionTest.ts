import assert from 'node:assert/strict';
import {evaluateLeagueMathematicalLocks} from '../tournament/leagueMathematicalLocks';

// Generate a complete 14-club single round-robin. The final fixture between
// the bottom two is unplayed; the champion and top-6/top-12 cannot change.
const clubs=Array.from({length:14},(_,i)=>({
 id:'club-'+i,name:'Club '+i,shortName:'C'+i
}));
const fixtures: Array<{
 id:string;homeClubId:string;awayClubId:string;status:string;
 homeScore:number|null;awayScore:number|null
}>=[];
for(let i=0;i<14;i++)for(let j=i+1;j<14;j++){
 const unplayed=i===12&&j===13;
 fixtures.push({id:'game-'+i+'-'+j,homeClubId:clubs[i].id,
  awayClubId:clubs[j].id,status:unplayed?'SCHEDULED':'CONFIRMED',
  homeScore:unplayed?null:2,awayScore:unplayed?null:0});
}
const result=evaluateLeagueMathematicalLocks({clubs,fixtures});
assert.equal(result.validSchedule,true);
assert.equal(result.remaining,1);
assert.equal(result.championClubId,'club-0');
assert.equal(result.lockedTop6.length,6);
assert.equal(result.lockedTop12.length,12);
assert.ok(!result.lockedTop12.includes('club-12'));
assert.ok(!result.lockedTop12.includes('club-13'));
const missing=evaluateLeagueMathematicalLocks({clubs,fixtures:fixtures.slice(1)});
assert.equal(missing.validSchedule,false);
assert.equal(missing.championClubId,null);
const duplicated=evaluateLeagueMathematicalLocks({clubs,fixtures:[...fixtures.slice(1),fixtures[1]]});
assert.equal(duplicated.validSchedule,false);
const equalPoints=evaluateLeagueMathematicalLocks({
 clubs:clubs.slice(0,2),
 fixtures:[{id:'tie',homeClubId:'club-0',awayClubId:'club-1',
  status:'SCHEDULED',homeScore:null,awayScore:null}]
});
assert.equal(equalPoints.championClubId,null);
const unfinishedUnknown=evaluateLeagueMathematicalLocks({clubs,
 fixtures:fixtures.map(f=>f.id==='game-12-13'?{...f,status:'DISPUTED'}:f)});
assert.equal(unfinishedUnknown.validSchedule,false);
const wrongScore=evaluateLeagueMathematicalLocks({clubs,
 fixtures:fixtures.map(f=>f.id==='game-0-1'?{...f,homeScore:-1}:f)});
assert.equal(wrongScore.validSchedule,false);
console.log('PASS_MATHEMATICAL_LOCKS: title, fixed UCL/UEL groups, ties, disputed and incomplete schedules');
