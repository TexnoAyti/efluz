import { createHash } from 'node:crypto';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { canUseDangerZone } from '../../lib/adminPermissions';
import type { User } from '../../types';
import { getFirestoreDb } from '../firebase/admin';

export function preparedPlanFingerprint() {
  return createHash('sha256').update(JSON.stringify(EFL_SECOND_SEASON)).digest('hex');
}
export function preparationReadiness(input: { startDate?: string|null; sourceArchived?: boolean; draftFingerprint?: string|null } = {}) {
  const blockers: Array<{code:string;subject:string}> = [];
  const add=(code:string,subject:string)=>blockers.push({code,subject});
  if(!input.sourceArchived)add('SOURCE_SEASON_ONGOING',EFL_SECOND_SEASON.sourceSeasonId);
  if(!input.startDate)add('START_DATE_REQUIRED',EFL_SECOND_SEASON.id);
  if(input.draftFingerprint!==preparedPlanFingerprint())add('DRAFT_NOT_SAVED_OR_OUTDATED',EFL_SECOND_SEASON.id);
  for(const league of EFL_SECOND_SEASON.leagues)if(league.rankingRule.verification!=='VERIFIED')add('RULE_VERIFICATION_REQUIRED',league.id);
  for(const cup of EFL_SECOND_SEASON.domesticCups){
    if(cup.verification!=='VERIFIED')add('CUP_RULE_VERIFICATION_REQUIRED',cup.id);
    if(!cup.expectedEntrants||cup.participantClubIds.length!==cup.expectedEntrants)add('CUP_PARTICIPANTS_MISSING',cup.id);
  }
  add('SUPER_CUP_PLANS_REQUIRED',EFL_SECOND_SEASON.id);
  for(const comp of EFL_SECOND_SEASON.europeanCompetitions){
    if(!comp.qualificationSlots)add('UEFA_ACCESS_LIST_REQUIRED',comp.id);
    if(comp.participantClubIds.length!==comp.totalTeams)add('UEFA_PARTICIPANTS_MISSING',comp.id);
  }
  // Existing production reads are still tied to season-one seeds and 32-team paths.
  // Never claim readiness or switch active season before those adapters are completed.
  add('RUNTIME_TRANSITION_REQUIRED',EFL_SECOND_SEASON.id);
  return {seasonId:EFL_SECOND_SEASON.id,canActivate:false,blockers,counts:{leagues:EFL_SECOND_SEASON.leagues.length,clubs:EFL_SECOND_SEASON.leagues.reduce((sum,l)=>sum+l.roster.clubs.length,0),verifiedRankingRules:EFL_SECOND_SEASON.leagues.filter(l=>l.rankingRule.verification==='VERIFIED').length,cups:EFL_SECOND_SEASON.domesticCups.length,europeanCompetitions:EFL_SECOND_SEASON.europeanCompetitions.length},fingerprint:preparedPlanFingerprint()};
}

function requireOwner(actor:User) {
  if(!canUseDangerZone(actor))throw Object.assign(new Error('MAIN_ADMIN_REQUIRED'),{statusCode:403});
}
function validateStartDate(value:string|null) {
  if(value===null)return;
  const date=new Date(value+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw Object.assign(new Error('INVALID_START_DATE'),{statusCode:400});
}
export async function readSeasonPreparationWorkflow(actor:User) {
  requireOwner(actor);
  const db=getFirestoreDb();
  const [draftDoc,archiveDoc,sourceDoc]=await Promise.all([
    db.collection('season_preparation_drafts').doc(EFL_SECOND_SEASON.id).get(),
    db.collection('season_archives').doc(EFL_SECOND_SEASON.sourceSeasonId).get(),
    db.collection('seasons').doc(EFL_SECOND_SEASON.sourceSeasonId).get(),
  ]);
  const draft=draftDoc.exists?draftDoc.data():null;
  const sourceArchived=archiveDoc.exists&&archiveDoc.data()?.status==='ARCHIVED'&&(!sourceDoc.exists||['archived','completed'].includes(String(sourceDoc.data()?.status).toLowerCase()));
  return {draft:draft?{revision:draft.revision,startDate:draft.startDate,updatedAt:draft.updatedAt,updatedBy:draft.updatedBy,fingerprint:draft.fingerprint}:null,readiness:preparationReadiness({sourceArchived,startDate:draft?.startDate,draftFingerprint:draft?.fingerprint})};
}

/** Writes only a versioned preparation document. It cannot close, start or reset a season. */
export async function saveSeasonPreparationDraft(actor:User,input:{startDate:string|null;expectedRevision:number}) {
  requireOwner(actor);validateStartDate(input.startDate);
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)throw Object.assign(new Error('INVALID_DRAFT_REVISION'),{statusCode:400});
  const db=getFirestoreDb(),ref=db.collection('season_preparation_drafts').doc(EFL_SECOND_SEASON.id);
  const fingerprint=preparedPlanFingerprint();
  await db.runTransaction(async tx=>{
    const doc=await tx.get(ref),previous=doc.exists?doc.data():null;
    if(previous?.fingerprint===fingerprint&&previous?.startDate===input.startDate)return;
    if(Number(previous?.revision||0)!==input.expectedRevision)throw Object.assign(new Error('DRAFT_REVISION_CONFLICT'),{statusCode:409});
    tx.set(ref,{seasonId:EFL_SECOND_SEASON.id,sourceSeasonId:EFL_SECOND_SEASON.sourceSeasonId,status:'PREPARATION',registrationOpen:false,plan:EFL_SECOND_SEASON,startDate:input.startDate,revision:input.expectedRevision+1,fingerprint,updatedBy:actor.id,updatedAt:new Date().toISOString()});
  });
  return readSeasonPreparationWorkflow(actor);
}
