import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {COLLECTIONS} from '../firebase/collections';
import {domesticSeasonComplete,europeanDrawPublished} from '../services/europeanFixtureGate';
import {getCompetitionMatchdayControl,controlCompetitionMatchday} from '../services/competitionMatchdayService';
import {generateCompetitionFixturesFirestore} from '../firebase/firestoreStore';

export const SEASON_ONE_EUROPE={
  'comp-champions-league-2026':'UEFA Champions League',
  'comp-europa-league-2026':'UEFA Europa League',
} as const;
export type SeasonOneEuroId=keyof typeof SEASON_ONE_EUROPE;
export function isSeasonOneEuro(id:string):id is SeasonOneEuroId {
 return Object.prototype.hasOwnProperty.call(SEASON_ONE_EUROPE,id);
}
type Phase='WAITING_LEAGUES'|'WAITING_QUALIFICATION'|'WAITING_PARTICIPANTS'|
  'DRAW_READY'|'DRAW_REVIEW_REQUIRED'|'LEAGUE_PHASE'|'KNOCKOUT_PHASE'|'COMPLETED';
type Overview={
 competitionId:SeasonOneEuroId;seasonId:'season-2026-27';name:string;
 phase:Phase;domesticLeaguesCompleted:boolean;qualificationFinal:boolean;
 drawPublished:boolean;participants:number;fixtures:number;confirmed:number;
 currentMatchday:number;rounds:Array<{matchday:number;count:number;confirmed:number;incomplete:number}>;
 canGenerateDraw:boolean;sourceToken:string;blockReasons:string[];
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only authoritative progress, not a fabricated league table or result. */
export async function getSeasonOneEuropeanOverview(id:string):Promise<Overview>{
 if(!isSeasonOneEuro(id))throw Error('INVALID_SEASON_ONE_EUROPEAN');
 const db=getFirestoreDb();
 const [doc,compsSnap,seasonFixSnap,partSnap]=await Promise.all([
  db.collection(COLLECTIONS.COMPETITIONS).doc(id).get(),
  db.collection(COLLECTIONS.COMPETITIONS).where('seasonId','==','season-2026-27').get(),
  db.collection(COLLECTIONS.FIXTURES).where('seasonId','==','season-2026-27').get(),
  db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId','==',id).get(),
 ]);
 const comp=doc.data();
 if(!doc.exists||comp?.type!=='EUROPEAN_LEAGUE_PHASE'||comp?.seasonId!=='season-2026-27')
  throw Error('EUROPEAN_CATALOG_NOT_READY');
 const competitions=compsSnap.docs.map(d=>({...(d.data() as Record<string,any>),id:d.id}));
 const seasonFixtures=seasonFixSnap.docs.map(d=>({...(d.data() as Record<string,any>),id:d.id}));
 const domesticLeaguesCompleted=domesticSeasonComplete(competitions,seasonFixtures,'season-2026-27');
 const qualificationFinal=comp.europeanQualificationMode==='final'&&Boolean(comp.europeanQualificationToken);
 const drawPublished=europeanDrawPublished(comp);
 const participants=partSnap.docs.map(d=>d.data()).filter(p=>p.seasonId==='season-2026-27');
 const uniqueIds=new Set(participants.map(p=>p.clubId));
 const rows=seasonFixtures.filter(f=>f.competitionId===id);
 const leaguePhase=rows.filter(f=>Number(f.matchday)>=1&&Number(f.matchday)<=8);
 const allConfirmed=rows.length>0&&rows.every(f=>f.status==='CONFIRMED');
 const rounds=Array.from(new Set(rows.map(f=>Number(f.matchday)).filter(Number.isFinite)))
  .sort((a,b)=>a-b).map(matchday=>{
   const fixtures=rows.filter(f=>Number(f.matchday)===matchday);
   return {matchday,count:fixtures.length,
     confirmed:fixtures.filter(f=>f.status==='CONFIRMED').length,
     incomplete:fixtures.filter(f=>f.status!=='CONFIRMED').length};
  });
 const blockers:string[]=[];
 if(!domesticLeaguesCompleted)blockers.push('DOMESTIC_LEAGUES_INCOMPLETE');
 if(!qualificationFinal)blockers.push('FINAL_QUALIFICATION_REQUIRED');
 if(participants.length!==32||uniqueIds.size!==32)blockers.push('EXPECTED_32_UNIQUE_PARTICIPANTS');
 if(rows.length)blockers.push(drawPublished?'DRAW_ALREADY_PUBLISHED':'UNPUBLISHED_FIXTURES_REQUIRE_REVIEW');
 const canGenerateDraw=blockers.length===0;
 const phase:Phase=allConfirmed?'COMPLETED':drawPublished?
   (rounds.some(r=>r.matchday>8)?'KNOCKOUT_PHASE':'LEAGUE_PHASE'):
   rows.length?'DRAW_REVIEW_REQUIRED':!domesticLeaguesCompleted?'WAITING_LEAGUES':
   !qualificationFinal?'WAITING_QUALIFICATION':
   participants.length!==32||uniqueIds.size!==32?'WAITING_PARTICIPANTS':'DRAW_READY';
 const sourceToken=hash({
  id,domesticLeaguesCompleted,qualificationFinal,qualificationToken:comp.europeanQualificationToken||null,
  participants:participants.map(p=>p.clubId).sort(),
  fixtures:rows.map(f=>[f.id,f.status,f.europeanDrawId]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
 });
 return {competitionId:id,seasonId:'season-2026-27',name:SEASON_ONE_EUROPE[id],
  phase,domesticLeaguesCompleted,qualificationFinal,drawPublished,
  participants:participants.length,fixtures:rows.length,
  confirmed:rows.filter(f=>f.status==='CONFIRMED').length,
  currentMatchday:Number(comp.currentMatchday)||1,rounds,canGenerateDraw,sourceToken,blockReasons:blockers};
}
/** Never reset generated/played games. Requires global-admin confirmation. */
export async function publishSeasonOneEuropeanDraw(id:string,options:{
 previewToken:string;confirmation:boolean
}):Promise<{success:true;generated:number;matchdays:number}>{
 if(!options.confirmation)throw Error('EUROPEAN_DRAW_CONFIRMATION_REQUIRED');
 const before=await getSeasonOneEuropeanOverview(id);
 if(!before.canGenerateDraw)throw Error('EUROPEAN_DRAW_BLOCKED:'+before.blockReasons.join(','));
 if(options.previewToken!==before.sourceToken)throw Error('EUROPEAN_DRAW_PREVIEW_CHANGED');
 const latest=await getSeasonOneEuropeanOverview(id);
 if(!latest.canGenerateDraw||latest.sourceToken!==before.sourceToken)
  throw Error('EUROPEAN_DRAW_SOURCE_CHANGED');
 const result=await generateCompetitionFixturesFirestore(id,{force:false});
 const after=await getSeasonOneEuropeanOverview(id);
 if(!after.drawPublished||after.fixtures!==result.generated)
  throw Error('EUROPEAN_DRAW_PUBLICATION_NOT_VERIFIED');
 return {success:true,generated:result.generated,matchdays:result.matchdays};
}
/** A round is opened only when the published draw and actual fixtures exist. */
export async function openSeasonOneEuropeanRound(id:string,options:{
 nextMatchday:number;expectedUpdatedAt:string|null;durationHours:number;adminUserId:string
}){
 if(!isSeasonOneEuro(id))throw Error('INVALID_SEASON_ONE_EUROPEAN');
 const preview=await getSeasonOneEuropeanOverview(id);
 if(!preview.drawPublished)throw Error('EUROPEAN_DRAW_NOT_PUBLISHED');
 const control=await getCompetitionMatchdayControl(id);
 const current=control.currentMatchday;
 if(options.nextMatchday!==current+1||!Number.isSafeInteger(options.nextMatchday))
  throw Error('EUROPEAN_NEXT_ROUND_ONLY');
 const target=control.rounds.find(r=>r.matchday===options.nextMatchday);
 if(!target||!target.fixtureCount)throw Error('EUROPEAN_NEXT_ROUND_EMPTY');
 // Knockout stages depend on confirmed bracket winners, never force-fill TBDs.
 if(current>=9){
  const previous=control.rounds.find(r=>r.matchday===current);
  if(!previous||previous.unfinished.length)throw Error('EUROPEAN_KNOCKOUT_NOT_CONFIRMED');
 }
 return controlCompetitionMatchday(id,{action:'SELECT',matchday:options.nextMatchday,
  expectedUpdatedAt:options.expectedUpdatedAt,durationHours:options.durationHours,
  adminUserId:options.adminUserId});
}
