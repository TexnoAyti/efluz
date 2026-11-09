import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {COLLECTIONS} from '../firebase/collections';
import {SEED_CLUBS,SEED_COMPETITIONS} from '../db/seed';
import {controlCompetitionMatchday,getCompetitionMatchdayControl} from '../services/competitionMatchdayService';
import {SEASON_ONE_SUPERCUPS,isSeasonOneSupercup,previewManualSeasonOneSupercup} from './seasonOneSupercupPlan';

type Row=Record<string,any>;
type Preview=ReturnType<typeof previewManualSeasonOneSupercup>&{
 sourceToken:string;
 sourceLeagueId:string;
 sourceCupId:string;
 existingParticipants:number;
 availableClubs:Array<{id:string;name:string}>;
};
const select=(rows:{docs:Array<{id:string;data:()=>any}>})=>rows.docs.map(d=>({id:d.id,...d.data()}));
function fingerprint(input:unknown):string{
 return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
/** Admin-selected qualifiers: domestic matches may remain unconfirmed. No changes to their results. */
export async function getSeasonOneSupercupPreview(id:string):Promise<Preview>{
 if(!isSeasonOneSupercup(id))throw Error('INVALID_SEASON_ONE_SUPERCUP');
 const cfg=SEASON_ONE_SUPERCUPS[id];
 const sourceLeague=SEED_COMPETITIONS.find(c=>c.id===cfg.league);
 if(!sourceLeague?.leagueId)throw Error('SUPERCUP_SOURCE_CONFIGURATION_INVALID');
 const db=getFirestoreDb();
 const [supercupDoc,existing,participants]=await Promise.all([
  db.collection(COLLECTIONS.COMPETITIONS).doc(id).get(),
  db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',id).get(),
  db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId','==',id).get(),
 ]);
 if(!supercupDoc.exists||supercupDoc.data()?.seasonId!=='season-2026-27'||
   supercupDoc.data()?.type!=='SUPER_CUP')throw Error('SUPERCUP_CATALOG_MISSING');
 const availableClubs=SEED_CLUBS.filter(c=>c.leagueId===sourceLeague.leagueId)
  .map(c=>({id:c.id,name:c.name}));
 const pre=previewManualSeasonOneSupercup({
  competitionId:id,selectedClubIds:availableClubs.slice(0,cfg.size).map(c=>c.id),validClubIds:availableClubs.map(c=>c.id),
  existingFixtureCount:existing.size,existingParticipantCount:participants.size
 });
 const sourceToken=fingerprint({
  id,competition:supercupDoc.data(),fixtures:select(existing),
  participants:select(participants),availableClubs
 });
 return {...pre,sourceToken,sourceLeagueId:cfg.league,sourceCupId:cfg.cup,
  existingParticipants:participants.size,availableClubs};
}
/** Explicit admin-only apply, idempotent create (never force-delete old matches). */
export async function createSeasonOneSupercup(id:string,params:{
 previewToken:string;confirmed:boolean;selectedClubIds:string[];adminUserId:string;adminUsername?:string
}):Promise<{success:true;generated:number;competitionId:string}>{
 if(!params.confirmed)throw Error('SUPERCUP_CONFIRMATION_REQUIRED');
 const preview=await getSeasonOneSupercupPreview(id);
 if(!preview.canCreate)throw Error('SUPERCUP_NOT_READY:'+preview.blockReasons.join(','));
 if(params.previewToken!==preview.sourceToken)throw Error('SUPERCUP_PREVIEW_CHANGED');
 const selection=previewManualSeasonOneSupercup({
  competitionId:id,selectedClubIds:params.selectedClubIds,
  validClubIds:preview.availableClubs.map(c=>c.id),
  existingFixtureCount:0,existingParticipantCount:0
 });
 if(!selection.canCreate)throw Error('SUPERCUP_INVALID_SELECTION:'+selection.blockReasons.join(','));
 const db=getFirestoreDb();
 const now=new Date().toISOString();
 const compRef=db.collection(COLLECTIONS.COMPETITIONS).doc(id);
 const rows:Row[]=[];
 for(let i=0;i<selection.pairings.length;i++){
  const p=selection.pairings[i];
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
 const latest=await getSeasonOneSupercupPreview(id);
 if(!latest.canCreate||latest.sourceToken!==preview.sourceToken)
  throw Error('SUPERCUP_SOURCE_CHANGED');
 await db.runTransaction(async tx=>{
  const [competitionDoc,...fixtureDocs]=await Promise.all([
   tx.get(compRef),...rows.map(row=>tx.get(db.collection(COLLECTIONS.FIXTURES).doc(row.id)))
  ]);
  if(!competitionDoc.exists||competitionDoc.data()?.seasonId!=='season-2026-27'||
    competitionDoc.data()?.type!=='SUPER_CUP'||competitionDoc.data()?.hasFixtures||
    fixtureDocs.some(doc=>doc.exists))throw Error('SUPERCUP_ALREADY_GENERATED');
  const participantRefs=selection.qualifiers.map(q=>
   db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(`${id}_${q.clubId}`));
  const participantDocs=await Promise.all(participantRefs.map(ref=>tx.get(ref)));
  if(participantDocs.some(doc=>doc.exists))
   throw Error('SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED');
  for(let i=0;i<selection.qualifiers.length;i++){
   const q=selection.qualifiers[i],ref=participantRefs[i];
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
   undefined,{participants:selection.qualifiers,fixtures:rows.map(row=>row.id)},
   undefined,params.adminUsername||'admin','Season-one Super Cup created from explicitly selected admin qualifiers.')
  .catch(()=>{});
 return {success:true,generated:rows.length,competitionId:id};
}

/**
 * Owner-admin only via route authorization. Unlike generic matchday controls,
 * opening the final requires both real semifinal winners in final slots.
 */
export async function controlSeasonOneSupercupRound(id:string,params:{
 action:'OPEN'|'NEXT'|'LOCK';expectedUpdatedAt:string|null;
 durationHours:number;adminUserId:string
}){
 if(!isSeasonOneSupercup(id))throw Error('INVALID_SEASON_ONE_SUPERCUP');
 const db=getFirestoreDb();
 const doc=await db.collection(COLLECTIONS.COMPETITIONS).doc(id).get();
 if(!doc.exists||doc.data()?.seasonId!=='season-2026-27'||
   doc.data()?.type!=='SUPER_CUP'||!doc.data()?.hasFixtures)
   throw Error('SUPERCUP_NOT_GENERATED');
 const control=await getCompetitionMatchdayControl(id);
 const current=control.currentMatchday, total=SEASON_ONE_SUPERCUPS[id].size===2?1:2;
 const action=params.action;
 if(!['OPEN','NEXT','LOCK'].includes(action)||
   !Number.isFinite(params.durationHours)||params.durationHours<=0||params.durationHours>720)
  throw Error('SUPERCUP_BAD_ROUND_ACTION');
 if(current<1||current>total)throw Error('SUPERCUP_INVALID_CURRENT_ROUND');
 const next=action==='NEXT'?current+1:current;
 if(next>total)throw Error('SUPERCUP_FINAL_ALREADY_REACHED');
 const currentRows=await db.collection(COLLECTIONS.FIXTURES).where('competitionId','==',id).get();
 const fixtures:Row[]=currentRows.docs.map(d=>Object.assign({},d.data() as Row,{id:d.id}) as Row)
   .filter(f=>f.seasonId==='season-2026-27');
 if(fixtures.length!==(total===2?3:1))
  throw Error('SUPERCUP_FIXTURE_STRUCTURE_MISMATCH');
 if(action==='NEXT'){
  const previous=fixtures.filter(f=>Number(f.matchday)===current);
  if(previous.length!==2||previous.some(f=>f.status!=='CONFIRMED'||
    !f.winnerClubId||![f.homeClubId,f.awayClubId].includes(f.winnerClubId)))
   throw Error('SUPERCUP_SEMIFINALS_NOT_CONFIRMED');
  const final=fixtures.find(f=>Number(f.matchday)===2&&f.roundName==='Final');
  if(!final||!final.homeClubId||!final.awayClubId||
    final.homeClubId===final.awayClubId||
    final.homeClubId!==previous[0].winnerClubId||
    final.awayClubId!==previous[1].winnerClubId||
    final.status==='CONFIRMED')
   throw Error('SUPERCUP_FINAL_SLOTS_UNRESOLVED');
 }
 return controlCompetitionMatchday(id,{
   action:action==='NEXT'?'SELECT':action,
   matchday:next,
   expectedUpdatedAt:params.expectedUpdatedAt,
   durationHours:params.durationHours,adminUserId:params.adminUserId
 });
}
