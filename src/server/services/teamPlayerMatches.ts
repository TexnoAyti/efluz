import {getFirestoreDb} from '../firebase/admin';
import {teamActor,readTeamActor,teamId,teamError,LEAGUE_COLLECTION} from './teamAccess';
import {applyEventResult,eventContactUrl} from '../../lib/eventMatchFlow';
import {teamFixtureScore,teamFixtureWinner} from '../../lib/teamLeagueEngine';
import {writeTeamLeagueNotices} from './teamCompetitionNotices';
import type {TeamLeague,TeamFixture,TeamBout} from '../../types/teamLeaguePreview';
function players(l:TeamLeague,f:TeamFixture,b:TeamBout){return [l.teams[f.homeTeamId]?.members.find(m=>m.id===b.homeMemberId),l.teams[f.awayTeamId]?.members.find(m=>m.id===b.awayMemberId)];}
export async function getTeamPlayerMatches(actorId:string,id:string){
 teamId(id);await teamActor(actorId);const l=(await getFirestoreDb().collection(LEAGUE_COLLECTION).doc(id).get()).data() as TeamLeague|undefined;
 if(!l||l.status==='DRAFT')throw teamError('Turnir topilmadi.',404);
 const matches=[],contacts=new Map<string,string|undefined>();
 for(const f of l.fixtures)for(const b of f.bouts){const [h,a]=players(l,f,b);if(!h?.verified||!a?.verified||!h.userId||!a.userId||![h.userId,a.userId].includes(actorId))continue;
  const opponent=h.userId===actorId?a:h;let contactUrl:string|undefined;
  if(!contacts.has(opponent.userId!)){try{const u=await teamActor(opponent.userId!);contacts.set(opponent.userId!,eventContactUrl(u.telegramId,u.username));}catch{contacts.set(opponent.userId!,undefined);}}contactUrl=contacts.get(opponent.userId!);
  matches.push({fixtureId:f.id,boutId:b.id,round:f.round,homeName:h.name,awayName:a.name,opponentName:opponent.name,contactUrl,homeScore:b.homeScore,awayScore:b.awayScore,pendingResult:b.pendingResult?{homeScore:b.pendingResult.homeScore,awayScore:b.pendingResult.awayScore,mine:b.pendingResult.submittedBy===actorId}:undefined,disputed:!!b.disputed,canPlay:l.status==='ACTIVE'&&f.round===l.currentRound&&b.homeScore===null});
 }
 return {version:l.version,matches};
}
export async function actTeamPlayerMatch(actorId:string,id:string,input:any){
 teamId(id);await teamActor(actorId);if(!['SUBMIT_RESULT','CONFIRM_RESULT','DISPUTE_RESULT'].includes(input?.action))throw teamError('Noma’lum amal.');
 const db=getFirestoreDb(),ref=db.collection(LEAGUE_COLLECTION).doc(id);
 await db.runTransaction(async tx=>{
  await readTeamActor(tx,actorId);const l=(await tx.get(ref)).data() as TeamLeague|undefined;
  if(!l||l.status!=='ACTIVE')throw teamError('Turnir faol emas.',409);
  if(l.version!==input.version)throw teamError('Turnir yangilandi. Qayta yuklang.',409);
  const f=l.fixtures.find(f=>f.id===input.fixtureId),b=f?.bouts.find(b=>b.id===input.boutId);
  if(!f||!b||f.round!==l.currentRound)throw teamError('Joriy turdagi juftlik topilmadi.',409);
  const [h,a]=players(l,f,b);
  if(!h?.verified||!a?.verified||!h.userId||!a.userId||![h.userId,a.userId].includes(actorId))throw teamError('Bu sizning o‘yiningiz emas.',403);
  const before=structuredClone(l),result={...b,homeUserId:h.userId,awayUserId:a.userId};
  try{applyEventResult(result,actorId,input.action,input);}catch(e:any){throw teamError(e.message,e.statusCode||400);}
  b.homeScore=result.homeScore;b.awayScore=result.awayScore;delete b.pendingResult;delete b.disputed;
  if(result.pendingResult)b.pendingResult=result.pendingResult;if(result.disputed)b.disputed=true;
  if(input.action==='CONFIRM_RESULT'){delete f.tieBreakWinnerId;delete f.tieBreakReason;}
  if(l.currentRound===l.totalRounds&&l.fixtures.every(f=>teamFixtureScore(f).complete&&(f.stage!=='PLAYOFF'||!!teamFixtureWinner(f))))l.status='COMPLETED';
  l.version++;l.updatedAt=new Date().toISOString();l.audit=[...l.audit,{at:l.updatedAt,actorId,action:input.action,detail:f.id}].slice(-200);
  writeTeamLeagueNotices(tx,before,l,input.action,f.id);tx.set(ref,l);
 });
 return getTeamPlayerMatches(actorId,id);
}
