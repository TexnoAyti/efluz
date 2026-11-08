// Pure, conservative conversion of Serverless fixture rows to EFLUZ React.
// No fabricated opponents, scores, ownership or completed match statuses.
const toTime=(value:unknown):string=>{
 if(typeof value==='string'){
   if(!value)return '';
   const dt=new Date(value);
   if(!Number.isNaN(dt.getTime()))return dt.toISOString();
 }
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0){
   const date=new Date(value<1e11?value*1000:value);
   if(!Number.isNaN(date.getTime()))return date.toISOString();
 }
 return '';
};
export function normalizeNativeFixture(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
 const row=value as Record<string,unknown>;
 if(typeof row.id!=='string'||!row.id||typeof row.seasonId!=='string'||
   !row.seasonId||typeof row.competitionId!=='string'||!row.competitionId||
   typeof row.status!=='string'||!row.status)
  throw Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
 if(!Number.isSafeInteger(row.round)||Number(row.round)<0)
  throw Error('SERVERLESS_FIXTURE_ROUND_INVALID');
 if(row.homeClubId!=null&&typeof row.homeClubId!=='string'||
    row.awayClubId!=null&&typeof row.awayClubId!=='string')
  throw Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
 for(const key of ['homeScore','awayScore']){
   const score=row[key];
   if(score!==null&&score!==undefined&&
     (!Number.isSafeInteger(score)||Number(score)<0))
    throw Error('SERVERLESS_SCORE_CONTRACT_MISMATCH');
 }
 return {
   ...row,
   matchday:row.round,
   homeClubId:row.homeClubId??null,
   awayClubId:row.awayClubId??null,
   homeScore:row.homeScore??null,
   awayScore:row.awayScore??null,
   scheduledAt:toTime(row.scheduledAt),
   createdAt:toTime(row.createdAt),
   updatedAt:toTime(row.updatedAt),
   // The original backend may attach club/owner objects; native read feeds
   // currently carry IDs only. Never manufacture owner profiles.
 };
}
