import {createHash} from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {getFirestoreDb} from '../firebase/admin';

const id = (key:string) => createHash('sha256').update(key).digest('hex');
const parse = (value:any) => {try{return typeof value==='string'?JSON.parse(value):value;}catch{return value;}};
type Entry = {value:any;expiresAt:number|null};
const live = (entry:Entry|undefined) => entry && (entry.expiresAt===null || entry.expiresAt>Date.now()) ? entry : undefined;

/** Durable AI state. Only the explicitly named atomic operations below are
 * supported; arbitrary Lua is never evaluated or silently approximated. */
export class PostgresAiStore {
 constructor(private signal?:AbortSignal) {}
 protected check(){if(this.signal?.aborted)throw Error('TIMEOUT_ABORTED');}
 private ref(key:string){return getFirestoreDb().collection('telegram_ai_state').doc(id(key));}
 async get<T=any>(key:string):Promise<T|null>{
  this.check();const entry=live((await this.ref(key).get()).data() as Entry);this.check();return entry?parse(entry.value):null;
 }
 async mget<T=any>(...keys:string[]):Promise<T>{
  this.check();const rows=await getFirestoreDb().collection('telegram_ai_state').where(FieldPath.documentId(),'in',keys.map(id)).get();
  const values=new Map(rows.docs.map(row=>[row.id,live(row.data() as Entry)]));this.check();
  return keys.map(key=>{const entry=values.get(id(key));return entry?parse(entry.value):null;}) as T;
 }
 protected async atomic<T>(keys:string[],operation:(values:Map<string,Entry>,put:(key:string,value:any,seconds?:number)=>void)=>T):Promise<T>{
  this.check();const db=getFirestoreDb();
  return db.runTransaction(async tx=>{
   this.check();const rows=await tx.get(db.collection('telegram_ai_state').where(FieldPath.documentId(),'in',keys.map(id)));
   const byId=new Map<string,Entry>(rows.docs.map((row:any)=>[row.id,row.data()]));
   const values=new Map<string,Entry>();keys.forEach(key=>{const entry=live(byId.get(id(key)));if(entry)values.set(key,entry);});
   this.check();const writes=new Map<string,Entry>();
   const result=operation(values,(key,value,seconds)=>{writes.set(key,{value,expiresAt:seconds===undefined?null:Date.now()+seconds*1000});});
   this.check();writes.forEach((value,key)=>tx.set(this.ref(key),value));return result;
  });
 }
 async set(key:string,value:any,options?:{nx?:boolean;ex?:number}){
  return this.atomic([key],(values,put)=>{if(options?.nx&&values.has(key))return null;put(key,value,options?.ex);return 'OK';});
 }
 async del(key:string){this.check();await this.ref(key).delete();return 1;}
 async eval<T=any>(script:string,keys:string[],args:any[]):Promise<T>{
  return this.atomic(keys,(values,put)=>{
   const get=(key:string)=>parse(values.get(key)?.value);
   if(script.includes('EFL_AI_DELIVERY_V1')){
    if(['sending','sent','unknown_timeout'].includes(get(keys[0])))return 0;
    put(keys[0],'sending',86400);return 1;
   }
   if(script.includes('EFL_AI_PLAN_CLAIM_V1')){
    const p=get(keys[0]);
    if(!p||p.state!=='pending'||p.expiresAt<=Number(args[0])||p.owner!==Number(args[1])||p.chat!==Number(args[2])||p.thread!==Number(args[3]))return 0;
    put(keys[0],{...p,state:args[4]},Math.max(1,Math.ceil((p.expiresAt-Date.now())/1000)));return 1;
   }
   if(script.includes('EFL_AI_PLAN_REPLACE_V1')){
    const p=get(keys[0]),latest=get(keys[2]),next=parse(args[5]);
    if(!p||!latest||p.state!=='pending'||p.expiresAt<=Number(args[0])||p.owner!==Number(args[1])||p.chat!==Number(args[2])||p.thread!==Number(args[3])||latest.token!==args[4])return 0;
    if(next.owner!==p.owner||next.chat!==p.chat||next.thread!==p.thread||next.state!=='pending'||next.expiresAt<=Number(args[0])||values.has(keys[1]))return 0;
    put(keys[1],next,300);put(keys[0],{...p,state:'cancelled'},Math.max(1,Math.ceil((p.expiresAt-Date.now())/1000)));return 1;
   }
   if(script.includes('EFL_AI_RATE_LIMIT_V1')){
    const counts=keys.slice(0,3).map(key=>Number(get(key))||0);
    const notify=()=>{if(values.has(keys[3]))return false;put(keys[3],1,Number(args[6]));return true;};
    for(const [index,name] of [[2,'DAILY'],[1,'TOPIC'],[0,'USER']] as const){
     if(index===2&&Number(args[7])===0)continue;
     if(counts[index]>=Number(args[index]))return [0,name+(notify()?'_NOTIFY':name==='USER'?'_SILENT':''),counts[index]];
    }
    counts.forEach((count,index)=>{
     if(index===2&&Number(args[7])===0)return;
     const existing=values.get(keys[index]);
     const ttl=existing?.expiresAt===null?undefined:existing?Math.max(.001,(existing.expiresAt!-Date.now())/1000):Number(args[index+3]);
     put(keys[index],count+1,ttl);
    });return [1,'OK',counts[0]+1];
   }
   if(script.includes('EFL_AI_EMOJI_SAVE_V1')){
    const palette={...(get(keys[0])||{})};let count=0;
    for(let i=0;i<args.length;i+=2)if(args[i] in palette||Object.keys(palette).length<32){palette[args[i]]=args[i+1];count++;}
    put(keys[0],palette);return count;
   }
   if(script.includes('EFL_AI_EMOJI_READ_V1'))return Object.entries(get(keys[0])||{}).flat();
   throw Error('UNSUPPORTED_POSTGRES_AI_OPERATION');
  }) as Promise<T>;
 }
}
