// Authenticated, strictly paginated UZEFLIFE projection. No writes or
// access to private roster, proof, admin IDs or raw source archive.
export function validateUzeflifeRead(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_UZEFLIFE_REQUEST');
 const section=input.section??'overview';
 if(!['overview','matches','participants'].includes(section))throw Error('INVALID_UZEFLIFE_SECTION');
 const limit=input.limit??40,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>80)throw Error('INVALID_UZEFLIFE_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_UZEFLIFE_CURSOR');
 if(Object.keys(input).some(k=>!['section','limit','cursor'].includes(k)))throw Error('UNKNOWN_UZEFLIFE_FIELD');
 return {section,limit,cursor};
}
export async function readUzeflife(db,input){
 const {section,limit,cursor}=validateUzeflifeRead(input);
 const state=await db.get(`SELECT id,name,status,format,current_round AS currentRound,
   total_rounds AS totalRounds,round_hours AS roundHours,
   participants_count AS participantsCount,matches_count AS matchesCount,
   source_revision AS sourceRevision FROM efl_uzeflife_state WHERE id='uzeflife'`);
 if(!state)return {ok:true,available:false,source:'telegram-serverless'};
 if(section==='overview')return {ok:true,available:true,state,source:'telegram-serverless'};
 const params={':limit':limit+1,':offset':cursor};
 const rows=section==='matches'
  ?await db.all(`SELECT id,round,bracket,home,away,winner,home_score AS homeScore,
       away_score AS awayScore,penalty_home AS penaltyHome,
       penalty_away AS penaltyAway,deadline_at AS deadlineAt
       FROM efl_uzeflife_fixtures ORDER BY round ASC,bracket ASC,id ASC
       LIMIT :limit OFFSET :offset`,params)
  :await db.all(`SELECT id,name,status FROM efl_uzeflife_entrants ORDER BY id ASC
       LIMIT :limit OFFSET :offset`,params);
 const more=rows.length>limit;
 return {ok:true,available:true,state,section,items:rows.slice(0,limit),
   nextCursor:more?cursor+limit:null,source:'telegram-serverless'};
}
