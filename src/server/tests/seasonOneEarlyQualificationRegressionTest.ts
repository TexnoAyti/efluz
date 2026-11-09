import assert from 'node:assert/strict';
import {SEED_CLUBS,SEED_COMPETITIONS} from '../db/seed';
import {isSeasonCompetitionEnabled} from '../../lib/seasonParticipationPolicy';
import {domesticSeasonComplete,domesticEuropeanQualificationReady} from '../services/europeanFixtureGate';
import {evaluateLeagueMathematicalLocks,lockedTopClubs} from '../tournament/leagueMathematicalLocks';
import {withSeasonQualificationPolicy,seasonQualificationRanges} from '../../lib/seasonQualificationPolicy';

const seasonId='season-2026-27';
const comps=SEED_COMPETITIONS.filter(c=>c.type==='LEAGUE'&&c.seasonId===seasonId&&
 isSeasonCompetitionEnabled(c.id,seasonId));
assert.equal(comps.length,4);
const fixtures:Array<{id:string;competitionId:string;seasonId:string;
 homeClubId:string;awayClubId:string;homeScore:number|null;awayScore:number|null;
 status:string}>=[];
for(const comp of comps){
 const clubs=SEED_CLUBS.filter(c=>c.leagueId===comp.leagueId);
 for(let i=0;i<clubs.length;i++)for(let j=i+1;j<clubs.length;j++){
  const pending=i===clubs.length-2&&j===clubs.length-1;
  fixtures.push({id:comp.id+':'+i+':'+j,competitionId:comp.id,
   seasonId,homeClubId:clubs[i].id,awayClubId:clubs[j].id,
   status:pending?'SCHEDULED':'CONFIRMED',
   homeScore:pending?null:2,awayScore:pending?null:0});
 }
 const locked=evaluateLeagueMathematicalLocks({clubs,
  fixtures:fixtures.filter(f=>f.competitionId===comp.id),config:comp.formatConfig});
 const cfg=seasonQualificationRanges(withSeasonQualificationPolicy(comp,seasonId),seasonId);
 assert.equal(cfg.uclEnd,8);
 assert.equal(cfg.uelEnd,16);
 assert.equal(locked.championClubId,clubs[0].id);
 assert.equal(lockedTopClubs(locked,cfg.uclEnd).length,cfg.uclEnd);
 assert.equal(lockedTopClubs(locked,cfg.uelEnd).length,cfg.uelEnd);
}
assert.equal(domesticSeasonComplete(comps,fixtures,seasonId),false);
assert.equal(domesticEuropeanQualificationReady(comps,fixtures,seasonId),true);
const tampered=fixtures.slice(1);
assert.equal(domesticEuropeanQualificationReady(comps,tampered,seasonId),false);
const contested=fixtures.map(f=>f.status==='SCHEDULED'?{...f,status:'DISPUTED'}:f);
assert.equal(domesticEuropeanQualificationReady(comps,contested,seasonId),false);
console.log('PASS_SEASON_ONE_EUROPEAN_EARLY: four leagues, 8+8 allocation, incomplete fixture gate, fail closed');
