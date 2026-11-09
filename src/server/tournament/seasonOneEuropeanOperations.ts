import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {COLLECTIONS} from '../firebase/collections';
import {domesticSeasonComplete,domesticEuropeanQualificationReady,europeanDrawPublished,europeanManualQualification} from '../services/europeanFixtureGate';
import {getCompetitionMatchdayControl,controlCompetitionMatchday} from '../services/competitionMatchdayService';
import {generateCompetitionFixturesFirestore} from '../firebase/firestoreStore';
import {generateKnockoutBracket} from './knockoutEngine';
import {SEED_CLUBS} from '../db/seed';

export const SEASON_ONE_EUROPE={
  'comp-champions-league-2026':'UEFA Champions League',
  'comp-europa-league-2026':'UEFA Europa League',
} as const;
export type SeasonOneEuroId=keyof typeof SEASON_ONE_EUROPE;
export function isSeasonOneEuro(id:string):id is SeasonOneEuroId {
 return Object.prototype.hasOwnProperty.call(SEASON_ONE_EUROPE,id);
}
type Phase='WAITING_LEAGUES'|'WAITING_QUALIFICATION'|'WAITING_PARTICIPANTS'|
  'DRAW_READY'|'DRAW_REVIEW_REQUIRED'|'LEAGUE_PHASE'|'KNOCKOUT_READY'|'KNOCKOUT_PHASE'|'COMPLETED';
type Overview={
 competitionId:SeasonOneEuroId;seasonId:'season-2026-27';name:string;
 phase:Phase;domesticLeaguesCompleted:boolean;qualificationMathematicallyReady:boolean;qualificationFinal:boolean;
 drawPublished:boolean;participants:number;fixtures:number;confirmed:number;
 currentMatchday:number;rounds:Array<{matchday:number;count:number;confirmed:number;incomplete:number}>;
 canGenerateDraw:boolean;canGenerateKnockout:boolean;sourceToken:string;blockReasons:string[];
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
 const competitions:Array<Record<string,any>&{id:string}>=compsSnap.docs.map(d=>({...(d.data() as Record<string,any>),id:d.id}));
 const seasonFixtures:Array<Record<string,any>&{id:string}>=seasonFixSnap.docs.map(d=>({...(d.data() as Record<string,any>),id:d.id}));
 const domesticLeaguesCompleted=domesticSeasonComplete(competitions,seasonFixtures,'season-2026-27');
 const qualificationMathematicallyReady=domesticEuropeanQualificationReady(competitions,seasonFixtures,'season-2026-27');
 const qualificationFinal=comp.europeanQualificationMode==='final'&&Boolean(comp.europeanQualificationToken);
 const manualQualification=europeanManualQualification(comp);
 const drawPublished=europeanDrawPublished(comp);
 const participants=partSnap.docs.map(d=>d.data()).filter(p=>p.seasonId==='season-2026-27');
 const uniqueIds=new Set(participants.map(p=>p.clubId));
 const rows=seasonFixtures.filter(f=>f.competitionId===id);
 const leaguePhase=rows.filter(f=>Number(f.matchday)>=1&&Number(f.matchday)<=8);
 const leaguePhaseComplete=leaguePhase.length===128&&leaguePhase.every(f=>f.status==='CONFIRMED');
 const knockoutFixtures=rows.filter(f=>Number(f.matchday)>8);
 const completedFinal=knockoutFixtures.some(f=>
   f.roundName==='Final'&&f.status==='CONFIRMED'&&f.winnerClubId&&
   [f.homeClubId,f.awayClubId].includes(f.winnerClubId));
 const rounds=Array.from(new Set(rows.map(f=>Number(f.matchday)).filter(Number.isFinite)))
  .sort((a,b)=>a-b).map(matchday=>{
   const fixtures=rows.filter(f=>Number(f.matchday)===matchday);
   return {matchday,count:fixtures.length,
     confirmed:fixtures.filter(f=>f.status==='CONFIRMED').length,
     incomplete:fixtures.filter(f=>f.status!=='CONFIRMED').length};
  });
 const blockers:string[]=[];
 if(!qualificationMathematicallyReady&&!manualQualification)blockers.push('QUALIFICATION_POSITIONS_NOT_LOCKED');
 if(!qualificationFinal)blockers.push('FINAL_QUALIFICATION_REQUIRED');
 if(participants.length!==32||uniqueIds.size!==32)blockers.push('EXPECTED_32_UNIQUE_PARTICIPANTS');
 if(rows.length)blockers.push(drawPublished?'DRAW_ALREADY_PUBLISHED':'UNPUBLISHED_FIXTURES_REQUIRE_REVIEW');
 const canGenerateDraw=blockers.length===0;
 const canGenerateKnockout=drawPublished&&leaguePhaseComplete&&knockoutFixtures.length===0&&
   participants.length===32&&uniqueIds.size===32;
 const phase:Phase=completedFinal?'COMPLETED':knockoutFixtures.length?'KNOCKOUT_PHASE':
   canGenerateKnockout?'KNOCKOUT_READY':drawPublished?'LEAGUE_PHASE':
   rows.length?'DRAW_REVIEW_REQUIRED':!qualificationMathematicallyReady&&!manualQualification?'WAITING_LEAGUES':
   !qualificationFinal?'WAITING_QUALIFICATION':
   participants.length!==32||uniqueIds.size!==32?'WAITING_PARTICIPANTS':'DRAW_READY';
 const sourceToken=hash({
  id,qualificationMathematicallyReady,domesticLeaguesCompleted,qualificationFinal,manualQualification,qualificationToken:comp.europeanQualificationToken||null,
  participants:participants.map(p=>p.clubId).sort(),
  fixtures:rows.map(f=>[f.id,f.status,f.europeanDrawId,f.matchday,
    f.homeClubId,f.awayClubId,f.homeScore,f.awayScore,f.winnerClubId])
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
 });
 return {competitionId:id,seasonId:'season-2026-27',name:SEASON_ONE_EUROPE[id],
  phase,domesticLeaguesCompleted,qualificationMathematicallyReady,qualificationFinal,drawPublished,
  participants:participants.length,fixtures:rows.length,
  confirmed:rows.filter(f=>f.status==='CONFIRMED').length,
  currentMatchday:Number(comp.currentMatchday)||1,rounds,canGenerateDraw,canGenerateKnockout,sourceToken,blockReasons:blockers};
}
/** Admin freezes a previously registered 32-club roster. No domestic result edits.
 * This is not an automatic claim that the league standings are final. */
export async function finalizeSeasonOneEuropeanManualRoster(id:string,params:{
 previewToken:string;confirmation:boolean;adminUserId:string
}):Promise<{success:true;participants:32}>{
 if(!isSeasonOneEuro(id))throw Error('INVALID_SEASON_ONE_EUROPEAN');
 if(!params.confirmation)throw Error('EUROPEAN_MANUAL_CONFIRMATION_REQUIRED');
 const before=await getSeasonOneEuropeanOverview(id);
 if(before.sourceToken!==params.previewToken)throw Error('EUROPEAN_PREVIEW_CHANGED');
 if(before.drawPublished||before.fixtures!==0)throw Error('EUROPEAN_ALREADY_STARTED');
 const db=getFirestoreDb();
 const compRef=db.collection(COLLECTIONS.COMPETITIONS).doc(id);
 await db.runTransaction(async tx=>{
  const comp=await tx.get(compRef);
  const parts=await tx.get(db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId','==',id));
  const fixtures=await tx.get(db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',id));
  if(!comp.exists||comp.data()?.seasonId!=='season-2026-27'||comp.data()?.type!=='EUROPEAN_LEAGUE_PHASE'||
   comp.data()?.europeanDrawId||!fixtures.empty)throw Error('EUROPEAN_MANUAL_SOURCE_CHANGED');
  const roster=parts.docs.filter(d=>d.data().seasonId==='season-2026-27').map(d=>d.data().clubId);
  const validClubs=new Set(SEED_CLUBS.map(c=>c.id));
  if(roster.length!==32||new Set(roster).size!==32||roster.some(id=>!validClubs.has(id)))
   throw Error('EUROPEAN_NEEDS_32_VALID_REGISTERED_CLUBS');
  const token='admin-manual-'+hash({id,roster:[...roster].sort(),season:'season-2026-27'});
  tx.update(compRef,{europeanQualificationMode:'final',europeanQualificationSource:'admin-manual',
   europeanQualificationToken:token,europeanManualFinalizedBy:params.adminUserId,
   europeanManualFinalizedAt:new Date().toISOString()});
 });
 return {success:true,participants:32};
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
// Initial knockouts: 8 play-offs + 8 R16 + 4 QF + 2 SF + final.
// The generator reprojects standings from confirmed fixtures; neither
// a Redis cache nor a stale standalone standings document is trusted.
export async function createSeasonOneEuropeanKnockout(id:string,options:{
 previewToken:string;confirmation:boolean
}):Promise<{success:true;generated:number;rounds:number}>{
 if(!options.confirmation)throw Error('EUROPEAN_KNOCKOUT_CONFIRMATION_REQUIRED');
 const before=await getSeasonOneEuropeanOverview(id);
 if(!before.canGenerateKnockout)throw Error('EUROPEAN_KNOCKOUT_NOT_READY');
 if(before.sourceToken!==options.previewToken)throw Error('EUROPEAN_KNOCKOUT_PREVIEW_CHANGED');
 const latest=await getSeasonOneEuropeanOverview(id);
 if(!latest.canGenerateKnockout||latest.sourceToken!==before.sourceToken)
  throw Error('EUROPEAN_KNOCKOUT_SOURCE_CHANGED');
 const result=await generateKnockoutBracket(id,{force:false});
 const after=await getSeasonOneEuropeanOverview(id);
 if(after.phase!=='KNOCKOUT_PHASE'||after.fixtures<=before.fixtures)
  throw Error('EUROPEAN_KNOCKOUT_PUBLICATION_NOT_VERIFIED');
 return {success:true,generated:result.generated,rounds:result.rounds};
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
