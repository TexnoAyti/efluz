import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {COLLECTIONS} from '../firebase/collections';
import {SEED_CLUBS,SEED_COMPETITIONS} from '../db/seed';
import {projectStandings} from './standingsProjection';
import {previewSeasonOneSupercup,SEASON_ONE_SUPERCUPS,isSeasonOneSupercup} from './seasonOneSupercupPlan';

type Row=Record<string,any>;
type Preview=ReturnType<typeof previewSeasonOneSupercup>&{
 sourceToken:string;
 sourceLeagueId:string;
 sourceCupId:string;
 sourceFinalFixtureId:string|null;
 existingParticipants:number;
};
const select=(rows:{docs:Array<{id:string;data:()=>any}>})=>rows.docs.map(d=>({id:d.id,...d.data()}));
function fingerprint(input:unknown):string{
 return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
/** Live read-only preview. Never declares a champion from partial fixtures. */
export async function getSeasonOneSupercupPreview(id:string):Promise<Preview>{
 if(!isSeasonOneSupercup(id))throw Error('INVALID_SEASON_ONE_SUPERCUP');
 const cfg=SEASON_ONE_SUPERCUPS[id];
 const sourceLeague=SEED_COMPETITIONS.find(c=>c.id===cfg.league);
 const sourceCup=SEED_COMPETITIONS.find(c=>c.id===cfg.cup);
 if(!sourceLeague||!sourceCup||!sourceLeague.leagueId||
   sourceLeague.seasonId!=='season-2026-27'||sourceCup.seasonId!=='season-2026-27')
  throw Error('SUPERCUP_SOURCE_CONFIGURATION_INVALID');
 const db=getFirestoreDb();
 const [supercupDoc,leagueCompDoc,cupCompDoc,leagueRows,cupRows,existing,participants]=await Promise.all([
  db.collection(COLLECTIONS.COMPETITIONS).doc(id).get(),
  db.collection(COLLECTIONS.COMPETITIONS).doc(cfg.league).get(),
  db.collection(COLLECTIONS.COMPETITIONS).doc(cfg.cup).get(),
  db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',cfg.league).get(),
  db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',cfg.cup).get(),
  db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',id).get(),
  db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId','==',id).get(),
 ]);
 if(!supercupDoc.exists||supercupDoc.data()?.seasonId!=='season-2026-27'||
   supercupDoc.data()?.type!=='SUPER_CUP')
  throw Error('SUPERCUP_CATALOG_MISSING');
 const league=select(leagueRows).filter(f=>f.seasonId==='season-2026-27');
 const cup=select(cupRows).filter(f=>f.seasonId==='season-2026-27');
 const leagueClubs=SEED_CLUBS.filter(c=>c.leagueId===sourceLeague.leagueId);
 const roster=new Set(leagueClubs.map(c=>c.id));
 const expected=roster.size*(roster.size-1)/2;
 const pairs=new Set<string>();
 let valid=true;
 for(const f of league){
  if(f.status!=='CONFIRMED'||!roster.has(f.homeClubId)||!roster.has(f.awayClubId)||
    f.homeClubId===f.awayClubId||!Number.isInteger(f.homeScore)||
    !Number.isInteger(f.awayScore)||f.homeScore<0||f.awayScore<0){valid=false;break;}
  pairs.add([f.homeClubId,f.awayClubId].sort().join('|'));
 }
 const leagueComplete=Boolean(leagueCompDoc.exists&&leagueCompDoc.data()?.seasonId==='season-2026-27'&&
  league.length===expected&&pairs.size===expected&&valid);
 let rankedClubIds:string[]=[];
 if(leagueComplete){
  rankedClubIds=projectStandings(leagueClubs,league,
   leagueCompDoc.data()?.formatConfig||sourceLeague.formatConfig).map(row=>row.clubId);
 }
 const finals=cup.filter(f=>f.roundName==='Final'||
   f.id===`fix-${cfg.cup}-r5-m0`||f.id===`fix-${cfg.cup}-r4-m0`);
 const final=finals.length===1&&cupCompDoc.exists&&cupCompDoc.data()?.seasonId==='season-2026-27'
  ?finals[0]:null;
 const pre=previewSeasonOneSupercup({
  competitionId:id,leagueComplete,
  cupFinal:final?{status:final.status,homeClubId:final.homeClubId||null,
   awayClubId:final.awayClubId||null,winnerClubId:final.winnerClubId||null}:null,
  rankedClubIds,existingFixtureCount:existing.size,
 });
 const blockReasons=[...pre.blockReasons];
 if(participants.size)blockReasons.push('SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED');
 if(final&&!roster.has(final.winnerClubId))blockReasons.push('CUP_WINNER_OUTSIDE_LEAGUE');
 if(final&&(!roster.has(final.homeClubId)||!roster.has(final.awayClubId)))
  blockReasons.push('CUP_FINALIST_OUTSIDE_LEAGUE');
 const sourceToken=fingerprint({
  id,format:cfg.size,league:league.map(f=>[f.id,f.status,f.homeClubId,f.awayClubId,f.homeScore,f.awayScore]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  cupFinal:final?[final.id,final.status,final.homeClubId,final.awayClubId,final.winnerClubId]:null,
  qualified:pre.qualifiers,existingFixtures:existing.size,existingParticipants:participants.size
 });
 return {...pre,blockReasons,canCreate:pre.canCreate&&blockReasons.length===0,
  pairings:blockReasons.length?[]:pre.pairings,
  sourceToken,sourceLeagueId:cfg.league,sourceCupId:cfg.cup,
  sourceFinalFixtureId:final?.id||null,existingParticipants:participants.size};
}
/** Explicit admin-only apply, idempotent create (never force-delete old matches). */
export async function createSeasonOneSupercup(id:string,params:{
 previewToken:string;confirmed:boolean;adminUserId:string;adminUsername?:string
}):Promise<{success:true;generated:number;competitionId:string}>{
 if(!params.confirmed)throw Error('SUPERCUP_CONFIRMATION_REQUIRED');
 const preview=await getSeasonOneSupercupPreview(id);
 if(!preview.canCreate||!preview.pairings.length)
  throw Error('SUPERCUP_NOT_READY:'+preview.blockReasons.join(','));
 if(params.previewToken!==preview.sourceToken)throw Error('SUPERCUP_PREVIEW_CHANGED');
 const db=getFirestoreDb();
 const now=new Date().toISOString();
 const compRef=db.collection(COLLECTIONS.COMPETITIONS).doc(id);
 const rows:Row[]=[];
 for(let i=0;i<preview.pairings.length;i++){
  const p=preview.pairings[i];
  rows.push({id:`fix-${id}-r1-m${i}`,competitionId:id,competitionName:compRef.id,
   seasonId:'season-2026-27',matchday:1,roundName:preview.size===2?'Final':'Semi-Finals',
   homeClubId:p.homeClubId,awayClubId:p.awayClubId,status:'SCHEDULED',
   homeScore:null,awayScore:null,winnerClubId:null,
   scheduledAt:now,createdAt:now,updatedAt:now});
 }
 if(preview.size===4)rows.push({id:`fix-${id}-r2-m0`,competitionId:id,
  competitionName:compRef.id,seasonId:'season-2026-27',matchday:2,roundName:'Final',
  homeClubId:null,awayClubId:null,status:'SCHEDULED',homeScore:null,awayScore:null,
  winnerClubId:null,homeSourceFixtureId:rows[0].id,awaySourceFixtureId:rows[1].id,
  scheduledAt:now,createdAt:now,updatedAt:now});
 // Recheck everything immediately before preparing the atomic create batch.
 // Existing result-bearing documents are NEVER overwritten.
 const [latest,sourceFinalDoc]=await Promise.all([
  getSeasonOneSupercupPreview(id),
  db.collection(COLLECTIONS.FIXTURES).doc(preview.sourceFinalFixtureId!).get()
 ]);
 if(!latest.canCreate||latest.sourceToken!==preview.sourceToken||
  !sourceFinalDoc.exists||sourceFinalDoc.data()?.status!=='CONFIRMED')
  throw Error('SUPERCUP_SOURCE_CHANGED');
 await db.runTransaction(async tx=>{
  const [competitionDoc,...fixtureDocs]=await Promise.all([
   tx.get(compRef),...rows.map(row=>tx.get(db.collection(COLLECTIONS.FIXTURES).doc(row.id)))
  ]);
  if(!competitionDoc.exists||competitionDoc.data()?.seasonId!=='season-2026-27'||
    competitionDoc.data()?.type!=='SUPER_CUP'||competitionDoc.data()?.hasFixtures||
    fixtureDocs.some(doc=>doc.exists))throw Error('SUPERCUP_ALREADY_GENERATED');
  const participantRefs=preview.qualifiers.map(q=>
   db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(`${id}_${q.clubId}`));
  const participantDocs=await Promise.all(participantRefs.map(ref=>tx.get(ref)));
  if(participantDocs.some(doc=>doc.exists))
   throw Error('SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED');
  for(let i=0;i<preview.qualifiers.length;i++){
   const q=preview.qualifiers[i],ref=participantRefs[i];
   tx.create(ref,{id:ref.id,seasonId:'season-2026-27',competitionId:id,
     clubId:q.clubId,qualificationReason:q.reason,seedNumber:i+1,createdAt:now});
  }
  for(const row of rows)tx.create(db.collection(COLLECTIONS.FIXTURES).doc(row.id),row);
  tx.update(compRef,{status:'active',hasFixtures:true,
   currentMatchday:1,isMatchdayOpen:false,totalMatchdays:preview.size===2?1:2,
   fixtureCount:rows.length,fixturesCount:rows.length,generationStatus:'generated',
   updatedAt:now});
 });
 // Auxiliary audit only: no destructive cleanup or webhook cutover.
 const {createAuditLog}=await import('../services/adminService');
 await createAuditLog(params.adminUserId,'SUPERCUP_CREATED','COMPETITION',id,
   undefined,{participants:preview.qualifiers,fixtures:rows.map(row=>row.id)},
   undefined,params.adminUsername||'admin','Season-one Super Cup created from confirmed domestic results.')
  .catch(()=>{});
 return {success:true,generated:rows.length,competitionId:id};
}
