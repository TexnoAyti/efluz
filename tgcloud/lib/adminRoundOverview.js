// Bounded, private admin summary of existing competition rounds.
// No fixtures are generated and no counters, results or notifications change.
import {readCompetitionRoundPlan} from './competitionRoundPlan.js';

const validTelegram=id=>/^[1-9][0-9]{0,19}$/.test(String(id??''));
export async function readAdminRoundOverview(db,telegramId){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const actor=await db.get(`SELECT id,is_admin AS admin,is_banned AS banned
  FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!actor?.admin||actor.banned)throw Error('ROUND_PLAN_FORBIDDEN');
 const season=await db.get(`SELECT id,name FROM efl_seasons
  WHERE is_active=1 ORDER BY created_at DESC,id DESC LIMIT 1`);
 if(!season)return {ok:true,season:null,items:[],hasMore:false,readOnly:true};
 const competitions=await db.all(`SELECT id FROM efl_competitions
   WHERE season_id=:season AND UPPER(type) IN
    ('LEAGUE','CUP','SUPER_CUP','DOMESTIC_CUP','DOMESTIC_SUPER_CUP',
     'INTERNATIONAL_CUP','KNOCKOUT')
   ORDER BY CASE WHEN UPPER(type)='LEAGUE' THEN 0 ELSE 1 END,
    name ASC,id ASC LIMIT 21`,{':season':season.id});
 const items=[];
 for(const competition of competitions.slice(0,20)){
  const plan=await readCompetitionRoundPlan(db,telegramId,{competitionId:competition.id});
  items.push({
   id:plan.competition.id,
   name:String(plan.competition.name??'Musobaqa').replace(/[\r\n\t]/g,' ').slice(0,55),
   type:plan.competition.type,
   currentRound:plan.competition.currentRound,
   nextRound:plan.next.round,
   nextFixtures:plan.next.existingFixtures,
   unresolved:plan.current.unresolved,
   disputes:plan.current.openDisputes,
   canAdvanceManually:plan.canAdvanceManually,
   reasons:plan.reasons
  });
 }
 return {ok:true,season:{name:String(season.name).slice(0,64)},
  items,hasMore:competitions.length>20,readOnly:true,source:'telegram-serverless'};
}
