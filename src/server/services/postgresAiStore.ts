import { PostgresKeyValueStore, parseStoredValue as parse } from './postgresKeyValueStore';

/** Only the explicitly named AI atomic operations below are supported. */
export class PostgresAiStore extends PostgresKeyValueStore {
 constructor(signal?: AbortSignal) { super('telegram_ai_state', signal); }
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
