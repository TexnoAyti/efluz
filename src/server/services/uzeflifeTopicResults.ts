import {uMatchFinished,isULeague,UZEFLIFE_LEAGUE_ROUNDS} from '../../lib/uzeflifeLeague';
import {writeUNotices,scheduleUNotices} from './uzeflifeNotifications';
import {randomUUID,createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {readUState,uPermissions,requireUPermission,applyUAction,validateUAction,checkUSubscriptions,uError} from './uzeflifeService';
import {normalizeAiEntity} from './telegramAiEntities';
import {assertSingleNaturalAdminRequest} from './telegramAiAdminLanguage';
import {isAiHypotheticalQuestion} from './telegramAiMessageUnderstanding';
import {uRoundLabel,uMatchNumber} from '../../lib/uzeflifePresentation';
import type {User} from '../../types';
import type {UState,UMatch} from '../../types/uzeflife';
import type {AdminPlan} from './telegramAiAdminCatalog';
export {UZEFLIFE_RESULT_TOPIC} from '../../lib/uzeflifeResultTopic';
import {UZEFLIFE_RESULT_TOPIC} from '../../lib/uzeflifeResultTopic';

const clarify=(message:string):never=>{throw Error('CLARIFY:'+message);};
const roundPattern=()=>/(^|\s)(?:(\d{1,3})\s*(?:-?\s*(?:chi|inchi)\s*)?-?\s*tur(?:dagi|da|ga|dan|ni)?|tur\s*(\d{1,3}))(?=$|\s|[.,!?:;])/gi;
async function account(telegramId:number):Promise<User|null>{
 const matches=await getFirestoreDb().collection('users').where('telegramId','==',String(telegramId)).limit(2).get();
 if(matches.docs.length!==1)return null;
 // The unique query is a fresh database read. Execution rechecks these
 // identities inside the result transaction before changing any score.
 const doc=matches.docs[0],data=doc.data();
 const user:User={id:doc.id,telegramId:String(data.telegramId||''),username:data.username||'',firstName:data.firstName||'',lastName:data.lastName||'',photoUrl:data.photoUrl||'',adminPermissions:data.adminPermissions,isAdmin:data.isAdmin===true,isSuspended:data.isSuspended===true,createdAt:data.createdAt||'',updatedAt:data.updatedAt||''};
 return !user.isSuspended&&user.telegramId===String(telegramId)?user:null;
}
export async function authorizeUzeflifeTopicResult(telegramId:number){const [user,state]=await Promise.all([account(telegramId),readUState()]);return !!user&&uPermissions(state,user).includes('results');}
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
 const [state,user]=await Promise.all([readUState(),account(sender)]);
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
 const roundMentions=[...remaining.matchAll(roundPattern())].map(m=>Number(m[2]||m[3]));
 const rounds=[...new Set(roundMentions)];
 if(rounds.length>1)clarify('Bitta xabarda faqat bitta turni ko‘rsating. Masalan: 2-tur 2-1.');
 const requestedRound=rounds[0],targetRound=requestedRound??state.round;
 if(!Number.isInteger(targetRound)||targetRound<1||targetRound>(isULeague(state)?UZEFLIFE_LEAGUE_ROUNDS:8))clarify(`Tur noto‘g‘ri. 1–${isULeague(state)?UZEFLIFE_LEAGUE_ROUNDS:8} oralig‘idagi turni yozing.`);
 if(!isULeague(state)&&targetRound!==state.round)clarify('Pley-offda faqat joriy bosqich natijasi qabul qilinadi.');
 const normalized=normalizeAiEntity(remaining.replace(roundPattern(),' '));
 const mentions=[...remaining.matchAll(/@([A-Za-z0-9_]{5,32})\b/g)].map(m=>normalizeAiEntity(m[1]));
 if(mentions.length>2||mentions.some(name=>!state.participants.some(p=>normalizeAiEntity(p.name)===name)))clarify('O‘yinchi username’i topilmadi yoki ikkitadan ko‘p ko‘rsatilgan. Turnir ro‘yxatidagi bitta yoki ikkita username yozing.');
 const setka=/\b([1-8])\s*-?\s*setka\b/i.exec(text),game=/\b(\d{1,3})\s*-?\s*o[‘’ʻʼ']?yin\b/i.exec(text);
 const named=(id:string|null)=>{const name=normalizeAiEntity(state.participants.find(p=>p.id===id)?.name||'');const position=name?(` ${normalized} `).indexOf(` ${name} `):-1;return {name,position};};
 let games=state.matches.filter(m=>m.round===targetRound&&m.home&&m.away);
 if(!admin)games=games.filter(m=>[m.home,m.away].includes(user.id));
 if(resolution)games=games.filter(m=>m.id===resolution.fixtureId);
 if(setka)games=games.filter(m=>isULeague(state)?[m.home,m.away].some(id=>state.roster?.some(r=>r.userId===id&&r.group===Number(setka[1]))):m.bracket===Number(setka[1]));
 if(game)games=games.filter(m=>uMatchNumber(m)===Number(game[1]));
 const bare=/^\s*(?:(?:hisob|natija)\s*:?\s*)?\d{1,2}\s*[:–—−-]\s*\d{1,2}(?:\s*(?:penalti\w*|penalty|penalties|пенальти)\s*\d{1,2}\s*[:–—−-]\s*\d{1,2})?[.! ]*$/i.test(text.replace(roundPattern(),' ').trim());
 const explicitGame=!!setka&&!!game;
 if(!bare&&!explicitGame)games=games.filter(m=>{const h=named(m.home),a=named(m.away);return h.name!==a.name&&(admin?(h.position>=0||a.position>=0):h.position>=0&&a.position>=0);});
 if(admin&&bare)games=games.filter(m=>[m.home,m.away].includes(user.id));
 if(games.length!==1)clarify(`UZEFLIFE’da bitta joriy o‘yin aniqlanmadi (${targetRound}-tur). O‘zingizning joriy o‘yiningiz uchun “2-1”, boshqa tur uchun “2-tur 2-1” deb yozing. Admin turni va o‘yinchi username’ini yozsin: “2-tur @username 2-1”. Ikki o‘yinchi nomi yoki “1-setka 1-o‘yin 2:1” ham qabul qilinadi.`);
 const m=games[0];if(uMatchFinished(m))clarify('Bu UZEFLIFE o‘yini allaqachon tasdiqlangan. Tuzatish uchun admin paneldan foydalaning.');
 const home=named(m.home),away=named(m.away);
 const homeFirst=home.position>=0&&away.position>=0&&home.name!==away.name?home.position<away.position:!bare&&admin&&home.position>=0?true:!bare&&admin&&away.position>=0?false:bare?m.home===user.id:explicitGame?true:null;
 if(homeFirst===null)clarify('Hisob tartibi noaniq. O‘zingizning hisobingizni birinchi qilib “2:1” deb yuboring.');
 if(!admin){const missing=await checkUSubscriptions(state,user);if(missing.length)clarify('Avval UZEFLIFE majburiy kanallariga obuna bo‘ling.');}
 const body={homeScore:homeFirst?a:b,awayScore:homeFirst?b:a,homePenaltyScore:homeFirst?pa:pb,awayPenaltyScore:homeFirst?pb:pa,status:'CONFIRMED',expectedFixture:{kind:'uzeflife',fingerprint:uzeflifeMatchFingerprint(state,m),submitter:user.id,telegramId:String(sender),...(requestedRound!==undefined?{requestedRound}: {})}};
 const player=(id:string)=>state.participants.find(p=>p.id===id)?.name||id;
 return {kind:'uzeflife' as const,confirmationQuestion:`Bu ${m.round}-tur o‘yinimi?${requestedRound===undefined?' Joriy tur bo‘yicha topildi.':' Siz ko‘rsatgan tur bo‘yicha topildi.'}`,expectedFixture:body.expectedFixture,fixture:{id:m.id,home:player(m.home!),away:player(m.away!),competition:'UZEFLIFE',roundName:`${isULeague(state)?'Umumiy liga':m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · ${uRoundLabel(m.round,state.format)} · ${uMatchNumber(m)}-o‘yin`,matchday:m.round},plan:{action:'result_edit',targetId:m.id,body} as AdminPlan};
}

export async function executeUzeflifeTopicResult(plan:AdminPlan,actorTelegramId:number,submitterTelegramId:number,source:{chat:number;thread:number;message:number}){
 const expected=plan.body.expectedFixture as {kind?:string;fingerprint?:string;submitter?:string;telegramId?:string;requestedRound?:number}|undefined;
 if(plan.action!=='result_edit'||source.thread!==UZEFLIFE_RESULT_TOPIC||expected?.kind!=='uzeflife'||!expected.fingerprint||!/^[a-f0-9]{64}$/.test(expected.fingerprint))throw uError('UZEFLIFE mavzusi yoki taklifi noto‘g‘ri.',403);
 const [actor,submitter,current]=await Promise.all([account(actorTelegramId),account(submitterTelegramId),readUState()]);
 if(!actor||!submitter)throw uError('Akkauntni tekshirib bo‘lmadi.',403);
 if(submitter.id!==expected.submitter||String(submitter.telegramId)!==expected.telegramId)throw uError('Natija yuboruvchisi o‘zgargan.',403);
 requireUPermission(current,actor,'results');
 if(!uPermissions(current,submitter).includes('results')&&(await checkUSubscriptions(current,submitter)).length)throw uError('Natija yuboruvchining majburiy obunasi tasdiqlanmadi.',403);
 const channels=JSON.stringify([current.subscriptionsEnabled,current.channels]);
 const {data}=validateUAction('result',{matchId:plan.targetId,home:plan.body.homeScore,away:plan.body.awayScore,penaltyHome:plan.body.homePenaltyScore,penaltyAway:plan.body.awayPenaltyScore});
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),auditId=randomUUID();
 const stored=await db.runTransaction(async tx=>{
  const [snapshot,actorDoc,senderDoc]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(actor.id)),tx.get(db.collection('users').doc(submitter.id))]);
  const state=snapshot.data() as UState|undefined,admin=actorDoc.data() as User|undefined,sender=senderDoc.data() as User|undefined;
  if(!state||!admin||!sender||admin.isSuspended||sender.isSuspended||String(admin.telegramId)!==String(actorTelegramId)||String(sender.telegramId)!==String(submitterTelegramId))throw uError('Akkaunt vakolati o‘zgargan.',403);
  requireUPermission(state,{...admin,id:actor.id},'results');
  const match=state.matches.find(m=>m.id===plan.targetId);
  if(!match||uMatchFinished(match)||uzeflifeMatchFingerprint(state,match)!==expected.fingerprint)throw uError('O‘yin taklifdan keyin o‘zgargan. Natijani qayta yuboring.',409);
  if(!uPermissions(state,{...sender,id:submitter.id}).includes('results')&&(![match.home,match.away].includes(submitter.id)||state.participants.find(p=>p.id===submitter.id)?.status!=='approved'))throw uError('Ishtirokchi vakolati bekor qilingan.',403);
  if(JSON.stringify([state.subscriptionsEnabled,state.channels])!==channels)throw uError('Majburiy obuna sozlamalari o‘zgargan. Natijani qayta yuboring.',409);
  const before=structuredClone(state);
  applyUAction(state,{...admin,id:actor.id},'result',data,{authorizedLeagueRound:expected.requestedRound});
  writeUNotices(tx,before,state,auditId);
  tx.set(ref,state);tx.set(db.collection('uzeflife_audit').doc(auditId),{actor:actor.id,action:'result',details:{...data,source:'telegram-topic',chat:source.chat,thread:source.thread,message:source.message,submitter:submitter.id},revision:state.revision,at:new Date().toISOString()});
  return {id:match.id,homeClubId:match.home,awayClubId:match.away,winnerClubId:match.winner,homeScore:match.homeScore,awayScore:match.awayScore,homePenaltyScore:match.penaltyHome,awayPenaltyScore:match.penaltyAway,status:uMatchFinished(match)?'CONFIRMED':'AWAITING_RESULT'};
 });
 scheduleUNotices();
 return {status:200,data:{success:true,fixture:stored}};
}
