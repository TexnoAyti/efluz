import type {UState} from '../../types/uzeflife';
import {initialUzeflifeRoster,UZEFLIFE_ROSTER_SOURCE} from '../../data/uzeflifeRoster20261021';
import {UZEFLIFE_LEAGUE_ROUNDS} from '../../lib/uzeflifeLeague';
/** User-requested configuration only applies to the still-empty registration.
 * Existing players, live games and history are never overwritten by a read. */
export async function migrateUzeLeagueRegistration(db:any,ref:any,fallback:()=>UState){
 return db.runTransaction(async(tx:any)=>{
  const snap=await tx.get(ref),s:UState=snap.exists?snap.data():fallback();
  if(s.rosterSource||s.matches.length||s.participants.length||!['draft','registration'].includes(s.status))return s;
  const before=structuredClone(s);
  Object.assign(s,{format:'LEAGUE',totalRounds:UZEFLIFE_LEAGUE_ROUNDS,rosterSource:UZEFLIFE_ROSTER_SOURCE,roster:initialUzeflifeRoster(),description:'15 turlik umumiy liga · 3/1/0 ochko · asl 8 setka va o‘rinlar ro‘yxatda saqlanadi',revision:s.revision+1});
  tx.set(db.collection('uzeflife_config_history').doc('league-roster-20261021'),{at:new Date().toISOString(),reason:'Owner requested shared 15-round league with original roster positions',before});
  tx.set(ref,s);return s;
 });
}
