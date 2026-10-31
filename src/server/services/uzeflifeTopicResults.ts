import {uMatchFinished,isULeague} from '../../lib/uzeflifeLeague';
import {writeUNotices,scheduleUNotices} from './uzeflifeNotifications';
import {randomUUID,createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {getAuthoritativeUserForAuthorization} from '../firebase/firestoreStore';
import {readUState,uPermissions,requireUPermission,applyUAction,validateUAction,checkUSubscriptions,uError} from './uzeflifeService';
import {normalizeAiEntity} from './telegramAiEntities';
import {assertSingleNaturalAdminRequest} from './telegramAiAdminLanguage';
import {isAiHypotheticalQuestion} from './telegramAiMessageUnderstanding';
import {uRoundLabel,uMatchNumber} from '../../lib/uzeflifePresentation';
import type {User} from '../../types';
import type {UState,UMatch} from '../../types/uzeflife';
import type {AdminPlan} from './telegramAiAdminCatalog';

export const UZEFLIFE_RESULT_TOPIC=7297;
const clarify=(message:string):never=>{throw Error('CLARIFY:'+message);};
async function account(telegramId:number):Promise<User|null>{
 const matches=await getFirestoreDb().collection('users').where('telegramId','==',String(telegramId)).limit(2).get();
 if(matches.docs.length!==1)return null;
 const user=await getAuthoritativeUserForAuthorization(matches.docs[0].id);
 return user&&!user.isSuspended&&String(user.telegramId)===String(telegramId)?user:null;
}
export async function authorizeUzeflifeTopicResult(telegramId:number){const user=await account(telegramId);return !!user&&uPermissions(await readUState(),user).includes('results');}
export function uzeflifeMatchFingerprint(s:UState,m:UMatch){
 return createHash('sha256').update(JSON.stringify([s.status,s.round,m.id,m.bracket,m.round,m.home,m.away,m.winner,m.homeScore,m.awayScore,m.penaltyHome,m.penaltyAway,m.scheduledAt,m.deadlineAt||null,m.dispute?[m.dispute.at,m.dispute.status]:null,m.proposal?[m.proposal.by,m.proposal.home,m.proposal.away,m.proposal.penaltyHome,m.proposal.penaltyAway]:null,[m.home,m.away].map(id=>s.participants.find(p=>p.id===id)?.status||null)])).digest('hex');
}
export async function planUzeflifeTopicResult(text:string,sender:number,resolution?:{fixtureId:string}){
 if(isAiHypotheticalQuestion(text))return null;
 const scores=[...text.matchAll(/\b(\d{1,2})\s*[:–—−-]\s*(\d{1,2})\b/g)];
 if(!scores.length)return null;
 assertSingleNaturalAdminRequest(text);
 if(scores.length>2||scores.some(score=>/[−-]\s*$|\d[.,]\s*$/.test(text.slice(0,score.index))||/^[.,]\d/.test(text.slice(score.index!+score[0].length))))clarify('Hisob noto‘g‘ri. Masalan: 2:1 yoki 2:2 penalti 5:4.');
 if(scores.length===2&&!/(?:penalti\w*|penalty|penalties|пенальти)/i.test(text.slice(scores[0].index!+scores[0][0].length,scores[1].index)))clarify('Ikkinchi hisob penaltilar bo‘lsa, “2:2 penalti 5:4” deb yozing.');
 const state=await readUState(),user=await account(sender);
 if(!user)clarify('Avval EFLUZ akkauntingizga kiring. Telegram hisobingiz tasdiqlanmadi.');
 const admin=uPermissions(state,user).includes('results');
 if(state.status!=='playing')clarify('UZEFLIFE hozir o‘ynalayotgan holatda emas. Natija saqlanmadi.');
 const own=state.participants.find(p=>p.id===user.id&&p.status==='approved');
 if(!admin&&!own)clarify('UZEFLIFE natijasini faqat tasdiqlangan ishtirokchi yoki natijalar admini yuborishi mumkin.');
 const a=Number(scores[0][1]),b=Number(scores[0][2]);
 const pa=scores[1]?Number(scores[1][1]):null,pb=scores[1]?Number(scores[1][2]):null;
 if(!isULeague(state)&&a===b&&(pa===null||pb===null||pa===pb))clarify('Durangda penaltilarni ham yozing: 2:2 penalti 5:4.');
 if(isULeague(state)&&scores.length===2)clarify('Liga o‘yinida penaltilar bo‘lmaydi.');
 if(a!==b&&scores.length===2)clarify('Asosiy hisob durang emas. Penalti hisobini olib tashlab qayta yuboring.');
 let remaining=text;for(const score of [...scores].reverse())remaining=remaining.slice(0,score.index)+remaining.slice(score.index!+score[0].length);
 if(/\d+\s*[:–—−-]\s*[−-]?\d+/.test(remaining))clarify('Hisoblar noto‘g‘ri yozilgan. Masalan: 2:1 yoki 2:2 penalti 5:4.');
 const normalized=normalizeAiEntity(remaining);
 const setka=/\b([1-8])\s*-?\s*setka\b/i.exec(text),game=/\b(\d{1,3})\s*-?\s*o[‘’ʻʼ']?yin\b/i.exec(text);
 const named=(id:string|null)=>{const name=normalizeAiEntity(state.participants.find(p=>p.id===id)?.name||'');const position=name?(` ${normalized} `).indexOf(` ${name} `):-1;return {name,position};};
 let games=state.matches.filter(m=>m.round===state.round&&m.home&&m.away);
 if(!admin)games=games.filter(m=>[m.home,m.away].includes(user.id));
 if(resolution)games=games.filter(m=>m.id===resolution.fixtureId);
 if(setka)games=games.filter(m=>isULeague(state)?[m.home,m.away].some(id=>state.roster?.some(r=>r.userId===id&&r.group===Number(setka[1]))):m.bracket===Number(setka[1]));
 if(game)games=games.filter(m=>uMatchNumber(m)===Number(game[1]));
 const bare=/^\s*(?:(?:hisob|natija)\s*:?\s*)?\d{1,2}\s*[:–—−-]\s*\d{1,2}(?:\s*(?:penalti\w*|penalty|penalties|пенальти)\s*\d{1,2}\s*[:–—−-]\s*\d{1,2})?[.! ]*$/i.test(text);
 const explicitGame=!!setka&&!!game;
 if(!bare&&!explicitGame)games=games.filter(m=>{const h=named(m.home),a=named(m.away);return h.position>=0&&a.position>=0&&h.name!==a.name;});
 if(admin&&bare)games=games.filter(m=>[m.home,m.away].includes(user.id));
 if(games.length!==1)clarify('UZEFLIFE’da bitta joriy o‘yin aniqlanmadi. O‘zingizning o‘yiningiz uchun “2:1”, yoki ikki o‘yinchi nomini hisob bilan yozing. Admin “1-setka 1-o‘yin 2:1” deb ham yuborishi mumkin.');
 const m=games[0];if(uMatchFinished(m))clarify('Bu UZEFLIFE o‘yini allaqachon tasdiqlangan. Tuzatish uchun admin paneldan foydalaning.');
 const home=named(m.home),away=named(m.away);
 const homeFirst=home.position>=0&&away.position>=0&&home.name!==away.name?home.position<away.position:bare?m.home===user.id:explicitGame?true:null;
 if(homeFirst===null)clarify('Hisob tartibi noaniq. O‘zingizning hisobingizni birinchi qilib “2:1” deb yuboring.');
 if(!admin){const missing=await checkUSubscriptions(state,user);if(missing.length)clarify('Avval UZEFLIFE majburiy kanallariga obuna bo‘ling.');}
 const body={homeScore:homeFirst?a:b,awayScore:homeFirst?b:a,homePenaltyScore:homeFirst?pa:pb,awayPenaltyScore:homeFirst?pb:pa,status:'CONFIRMED',expectedFixture:{kind:'uzeflife',fingerprint:uzeflifeMatchFingerprint(state,m),submitter:user.id,telegramId:String(sender)}};
 const player=(id:string)=>state.participants.find(p=>p.id===id)?.name||id;
 return {kind:'uzeflife' as const,expectedFixture:body.expectedFixture,fixture:{id:m.id,home:player(m.home!),away:player(m.away!),competition:'UZEFLIFE',roundName:`${isULeague(state)?'Umumiy liga':m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · ${uRoundLabel(m.round,state.format)} · ${uMatchNumber(m)}-o‘yin`,matchday:m.round},plan:{action:'result_edit',targetId:m.id,body} as AdminPlan};
}

export async function executeUzeflifeTopicResult(plan:AdminPlan,actorTelegramId:number,submitterTelegramId:number,source:{chat:number;thread:number;message:number}){
 const expected=plan.body.expectedFixture as {kind?:string;fingerprint?:string;submitter?:string;telegramId?:string}|undefined;
 if(plan.action!=='result_edit'||source.thread!==UZEFLIFE_RESULT_TOPIC||expected?.kind!=='uzeflife'||!expected.fingerprint||!/^[a-f0-9]{64}$/.test(expected.fingerprint))throw uError('UZEFLIFE mavzusi yoki taklifi noto‘g‘ri.',403);
 const actor=await account(actorTelegramId),submitter=await account(submitterTelegramId);
 if(!actor||!submitter)throw uError('Akkauntni tekshirib bo‘lmadi.',403);
 if(submitter.id!==expected.submitter||String(submitter.telegramId)!==expected.telegramId)throw uError('Natija yuboruvchisi o‘zgargan.',403);
 const current=await readUState();requireUPermission(current,actor,'results');
 if(!uPermissions(current,submitter).includes('results')&&(await checkUSubscriptions(current,submitter)).length)throw uError('Natija yuboruvchining majburiy obunasi tasdiqlanmadi.',403);
 const channels=JSON.stringify([current.subscriptionsEnabled,current.channels]);
 const {data}=validateUAction('result',{matchId:plan.targetId,home:plan.body.homeScore,away:plan.body.awayScore,penaltyHome:plan.body.homePenaltyScore,penaltyAway:plan.body.awayPenaltyScore});
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),auditId=randomUUID();
 const stored=await db.runTransaction(async tx=>{
  const snapshot=await tx.get(ref),actorDoc=await tx.get(db.collection('users').doc(actor.id)),senderDoc=await tx.get(db.collection('users').doc(submitter.id));
  const state=snapshot.data() as UState|undefined,admin=actorDoc.data() as User|undefined,sender=senderDoc.data() as User|undefined;
  if(!state||!admin||!sender||admin.isSuspended||sender.isSuspended||String(admin.telegramId)!==String(actorTelegramId)||String(sender.telegramId)!==String(submitterTelegramId))throw uError('Akkaunt vakolati o‘zgargan.',403);
  requireUPermission(state,{...admin,id:actor.id},'results');
  const match=state.matches.find(m=>m.id===plan.targetId);
  if(!match||uMatchFinished(match)||uzeflifeMatchFingerprint(state,match)!==expected.fingerprint)throw uError('O‘yin taklifdan keyin o‘zgargan. Natijani qayta yuboring.',409);
  if(!uPermissions(state,{...sender,id:submitter.id}).includes('results')&&(![match.home,match.away].includes(submitter.id)||state.participants.find(p=>p.id===submitter.id)?.status!=='approved'))throw uError('Ishtirokchi vakolati bekor qilingan.',403);
  if(JSON.stringify([state.subscriptionsEnabled,state.channels])!==channels)throw uError('Majburiy obuna sozlamalari o‘zgargan. Natijani qayta yuboring.',409);
  const before=structuredClone(state);
  applyUAction(state,{...admin,id:actor.id},'result',data);
  writeUNotices(tx,before,state,auditId);
  tx.set(ref,state);tx.set(db.collection('uzeflife_audit').doc(auditId),{actor:actor.id,action:'result',details:{...data,source:'telegram-topic',chat:source.chat,thread:source.thread,message:source.message,submitter:submitter.id},revision:state.revision,at:new Date().toISOString()});
  return {id:match.id,homeClubId:match.home,awayClubId:match.away,winnerClubId:match.winner,homeScore:match.homeScore,awayScore:match.awayScore,homePenaltyScore:match.penaltyHome,awayPenaltyScore:match.penaltyAway,status:uMatchFinished(match)?'CONFIRMED':'AWAITING_RESULT'};
 });
 scheduleUNotices();
 return {status:200,data:{success:true,fixture:stored}};
}
