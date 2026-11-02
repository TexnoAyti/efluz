import {createHash,randomUUID} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import type {UState} from '../../types/uzeflife';
import type {TournamentImageModel} from '../../lib/tournamentImage';
import {uMatchFinished,uLeagueStandings} from '../../lib/uzeflifeLeague';
import {getFirestoreDb} from '../firebase/admin';
import {renderTournamentImagePng} from './tournamentImageRenderer';

export const U_SUMMARY_CHANNEL='@uzeflife_turner';
const collection='uzeflife_round_summaries';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type USummaryPart={text:string;model?:TournamentImageModel};
export function uSummaryFingerprint(s:UState,round:number){const names=new Map(s.participants.map(p=>[p.id,p.name]));return hash(s.matches.filter(m=>m.round<=round).map(m=>[m.id,names.get(m.home!)||m.home,names.get(m.away!)||m.away,m.homeScore,m.awayScore,m.penaltyHome,m.penaltyAway]));}
export function uSummaryParts(s:UState,round:number):USummaryPart[]{
 const matches=s.matches.filter(m=>m.round===round);if(s.format!=='LEAGUE'||!matches.length||matches.some(m=>!uMatchFinished(m)))throw Error('ROUND_NOT_COMPLETE');
 const name=(id:string|null)=>s.participants.find(p=>p.id===id)?.name||'Ishtirokchi';
 const table=uLeagueStandings({...s,matches:s.matches.filter(m=>m.round<=round)});
 const leaders=[...table].sort((a,b)=>b.goalsFor-a.goalsFor||a.position-b.position).slice(0,5);
 const parts:USummaryPart[]=[{text:`🏆 UZEFLIFE · ${round}-tur yakuni\n${matches.length} ta o‘yin yakunlandi · ${matches.filter(m=>m.homeScore===m.awayScore).length} ta durang\n\n⚽ ${round}-turgacha eng ko‘p gol urgan o‘yinchilar:\n${leaders.map((r,i)=>`${i+1}. ${r.name} — ${r.goalsFor} gol`).join('\n')}\n\nQuyida barcha natijalar va yangilangan jadval.\n${U_SUMMARY_CHANNEL}`}];
 let text=`📊 UZEFLIFE · ${round}-tur natijalari\n`;
 for(const m of matches){const line=`${name(m.home)} ${m.homeScore}:${m.awayScore} ${name(m.away)}\n`;if(text.length+line.length>3400){parts.push({text});text=`📊 ${round}-tur natijalari · davomi\n`;}text+=line;}parts.push({text});
 for(let i=0;i<table.length;i+=30){const rows=table.slice(i,i+30);parts.push({text:`🏆 UZEFLIFE · ${round}-turdan keyingi jadval\n${i+1}–${i+rows.length}-o‘rinlar · ${U_SUMMARY_CHANNEL}`,model:{kind:'standings',identityKind:'players',title:'UZEFLIFE',seasonId:'season-2026-27',language:'uz',createdAt:new Date().toISOString(),round:`${round}-turdan keyin · ${i+1}–${i+rows.length}-o‘rinlar`,rows:rows.map(r=>({id:r.id,name:r.name,position:r.position,stats:[r.played,r.won,r.drawn,r.lost,r.goalsFor,r.goalsAgainst,r.goalDifference,r.points]}))}});}
 return parts;
}
/** The immutable publication and the last score commit or roll back together. */
export function writeURoundSummaries(tx:Transaction,before:UState,after:UState,forceMissing=false){
 if(after.format!=='LEAGUE'||!['playing','completed'].includes(after.status))return;
 for(let round=1;round<=after.round;round++){
  const matches=after.matches.filter(m=>m.round===round);if(!matches.length||matches.some(m=>!uMatchFinished(m)))continue;
  const fingerprint=uSummaryFingerprint(after,round);
  if(round<=before.round&&uSummaryFingerprint(before,round)===fingerprint&&!(forceMissing&&!after.roundSummaryVersions?.[round]))continue;
  const parts=uSummaryParts(after,round),id=`round-${round}-${hash([fingerprint,after.revision]).slice(0,24)}`;
  if(before.roundSummaryVersions?.[round])parts[0].text=parts[0].text.replace('tur yakuni','tur yangilangan yakuni');
  (after.roundSummaryVersions||={})[round]=id;
  tx.set(getFirestoreDb().collection(collection).doc(id),{round,fingerprint,partsJson:JSON.stringify(parts),state:'pending',cursor:0,total:parts.length,messageIds:[],lease:null,leaseUntil:0,nextAt:0,error:null,createdAt:new Date().toISOString()});
 }
}
/** Catch up completed rounds from before this feature was deployed. */
export async function sweepURoundSummaries(){
 const {readUState}=await import('./uzeflifeService'),s=await readUState();
 const missing=(state:UState)=>state.format==='LEAGUE'&&['playing','completed'].includes(state.status)&&state.matches.some(m=>m.round<=state.round&&!state.roundSummaryVersions?.[m.round]&&state.matches.filter(x=>x.round===m.round).every(uMatchFinished));
 if(!missing(s))return;
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship');
 await db.runTransaction(async tx=>{const snap=await tx.get(ref),current=snap.data() as UState;if(!current||!missing(current))return;const before=structuredClone(current);current.revision++;writeURoundSummaries(tx,before,current,true);tx.set(ref,current);});
}
class KnownRejection extends Error {constructor(message:string,public retrySeconds=0){super(message);}}
export async function sendUSummaryPart(part:USummaryPart):Promise<number>{
 const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new KnownRejection('Bot tokeni sozlanmagan.');
 let response:Response;
 if(part.model){const buffer=await renderTournamentImagePng(part.model),form=new FormData();form.set('chat_id',U_SUMMARY_CHANNEL);form.set('photo',new Blob([new Uint8Array(buffer)],{type:'image/png'}),'uzeflife-jadval.png');form.set('caption',part.text);response=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(15000)});}
 else response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:U_SUMMARY_CHANNEL,text:part.text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(data?.ok===false&&[400,401,403,404,429].includes(Number(data.error_code)))throw new KnownRejection('Telegram yuborishni rad etdi.',data.error_code===429?Math.max(1,Number(data.parameters?.retry_after)||60):0);
 if(!response.ok||data.ok!==true||!Number.isSafeInteger(data.result?.message_id))throw Error('SUMMARY_DELIVERY_UNCERTAIN');return data.result.message_id;
}
/** Persist BEFORE external delivery. Unknown outcomes stop for admin review. */
export async function processURoundSummary(send=sendUSummaryPart):Promise<boolean>{
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview'&&send===sendUSummaryPart)return false;
 const db=getFirestoreDb(),rows=await db.collection(collection).where('state','==','pending').limit(10).get();
 const ready=rows.docs.find(d=>Number(d.data().nextAt||0)<=Date.now());if(!ready)return false;
 const token=randomUUID(),job:any=await db.runTransaction(async tx=>{const [snap,state]=await Promise.all([tx.get(ready.ref),tx.get(db.collection('uzeflife').doc('championship'))]);const j=snap.data(),s=state.data() as UState;
  if(!j||j.state!=='pending'||j.nextAt>Date.now())return null;
  if(!s||s.roundSummaryVersions?.[j.round]!==ready.id||uSummaryFingerprint(s,j.round)!==j.fingerprint){tx.update(ready.ref,{state:'superseded'});return null;}
  const claimed={...j,state:'sending',lease:token,leaseUntil:Date.now()+90000};tx.set(ready.ref,claimed);return claimed;
 });
 if(!job)return !(await db.collection(collection).where('state','==','pending').limit(1).get()).empty;
 let id:number;
 try{const parts=JSON.parse(job.partsJson) as USummaryPart[];if(!parts[job.cursor])throw Error('INVALID_SUMMARY_PART');id=await send(parts[job.cursor]);}
 catch(error){await db.runTransaction(async tx=>{const snap=await tx.get(ready.ref),j=snap.data();if(j?.lease!==token)return;const rejected=error instanceof KnownRejection;tx.update(ready.ref,{state:rejected?(error.retrySeconds?'pending':'failed'):'unverified',lease:rejected?null:token,leaseUntil:0,nextAt:rejected?Date.now()+error.retrySeconds*1000:0,error:rejected?error.message:'Yuborish yakuni noma’lum. Kanalni tekshirib tasdiqlang.'});});return false;}
 return db.runTransaction(async tx=>{const snap=await tx.get(ready.ref),j=snap.data();if(j?.lease!==token)return false;const cursor=j.cursor+1;tx.update(ready.ref,{cursor,state:cursor===j.total?'sent':'pending',messageIds:[...j.messageIds,id],lease:null,leaseUntil:0,error:null});return cursor<j.total;});
}
export async function uSummaryStatus(){const docs=(await getFirestoreDb().collection(collection).limit(100).get()).docs;return docs.map(d=>{const j=d.data();return {id:d.id,round:j.round,state:j.state==='sending'&&j.leaseUntil<Date.now()?'unverified':j.state,cursor:j.cursor,total:j.total,error:j.error,lease:j.lease,createdAt:j.createdAt};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export async function reconcileUSummary(id:string,cursor:number,lease:string,delivered:boolean){
 if(!/^round-\d{1,2}-[a-f0-9]{24}$/.test(id)||!Number.isInteger(cursor)||typeof lease!=='string'||typeof delivered!=='boolean')throw Object.assign(Error('Tekshiruv ma’lumoti noto‘g‘ri.'),{statusCode:400});
 const db=getFirestoreDb(),ref=db.collection(collection).doc(id);
 await db.runTransaction(async tx=>{const snap=await tx.get(ref),j=snap.data();if(!j||!['unverified','sending','failed'].includes(j.state)||j.leaseUntil>Date.now()||j.cursor!==cursor||(j.lease||'')!==lease||j.state==='failed'&&delivered)throw Object.assign(Error('Yuborish holati yangilangan.'),{statusCode:409});const next=cursor+(delivered?1:0);tx.update(ref,{cursor:next,state:next===j.total?'sent':'pending',lease:null,leaseUntil:0,error:null,reconciledAt:new Date().toISOString()});});
}
