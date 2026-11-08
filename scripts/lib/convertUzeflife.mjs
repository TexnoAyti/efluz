// Offline normalization of the legacy UZEFLIFE bracket. Keep the original
// ~476 KiB source object separately in the private multipart archive.
// These rows are for read-only staging, never for bracket mutation.
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160;
const textValue=(value,limit=500)=>{
 if(typeof value!=='string')throw Error('UZEFLIFE_INVALID_TEXT');
 if(value.length>limit)throw Error('UZEFLIFE_TEXT_TOO_LONG');
 return value;
};
const number=(value,name,{min=0,max=10000000}={})=>{
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('UZEFLIFE_INVALID_'+name);
 return value;
};
const optionalScore=value=>value==null?null:number(value,'SCORE',{max:999});
const deadline=value=>{
 if(value==null||value==='')return null;
 if(typeof value==='number')return number(value,'DEADLINE',{max:Number.MAX_SAFE_INTEGER});
 if(typeof value==='string'){
  const timestamp=Date.parse(value);
  if(Number.isSafeInteger(timestamp)&&timestamp>=0)return timestamp;
 }
 throw Error('UZEFLIFE_INVALID_DEADLINE');
};
export function convertUzeflife(source){
 if(!source||typeof source!=='object'||Array.isArray(source)||
    !Array.isArray(source.participants)||!Array.isArray(source.matches))
  throw Error('UZEFLIFE_INVALID_SOURCE');
 if(source.matches.length>20000||source.participants.length>10000)
  throw Error('UZEFLIFE_UNBOUNDED_SOURCE');
 const entrants=[],fixtures=[];
 const entrantIds=new Set(),fixtureIds=new Set();
 for(const record of source.participants){
  if(!record||!identifier(record.id)||entrantIds.has(record.id))
    throw Error('UZEFLIFE_DUPLICATE_OR_INVALID_ENTRANT');
  entrantIds.add(record.id);
  entrants.push({id:record.id,name:textValue(record.name,200),
   status:textValue(record.status,80)});
 }
 for(const record of source.matches){
  if(!record||!identifier(record.id)||fixtureIds.has(record.id))
    throw Error('UZEFLIFE_DUPLICATE_OR_INVALID_FIXTURE');
  fixtureIds.add(record.id);
  if(record.winner!=null&&!identifier(record.winner))
    throw Error('UZEFLIFE_INVALID_WINNER');
  fixtures.push({id:record.id,
   round:number(record.round,'ROUND',{max:256}),
   bracket:number(record.bracket,'BRACKET',{max:100000}),
   home:textValue(record.home,160),away:textValue(record.away,160),
   winner:record.winner??null,
   home_score:optionalScore(record.homeScore),
   away_score:optionalScore(record.awayScore),
   penalty_home:optionalScore(record.penaltyHome),
   penalty_away:optionalScore(record.penaltyAway),
   deadline_at:deadline(record.deadlineAt)});
 }
 const state={id:'uzeflife',name:textValue(source.name,160),
  status:textValue(source.status,80),format:textValue(source.format??'',120),
  current_round:number(source.round,'ROUND',{max:256}),
  total_rounds:number(source.totalRounds,'TOTAL_ROUNDS',{max:256}),
  round_hours:number(source.roundHours,'ROUND_HOURS',{max:2160}),
  participants_count:entrants.length,matches_count:fixtures.length,
  source_revision:number(source.revision??0,'REVISION',{max:100000000})};
 return {rows:{uzeflifeState:[state],uzeflifeEntrants:entrants,
   uzeflifeFixtures:fixtures},
  report:{participants:entrants.length,matches:fixtures.length,
   sourceRevision:state.source_revision,privateSourceArchiveRequired:true,
   writesEnabled:false,cutoverReady:false}};
}
