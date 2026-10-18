import { randomBytes } from 'node:crypto';
import { getAiRedisClient } from './telegramAiDeadline';
import type { TelegramAiMessagePayload } from './telegramAiService';
import { getConversationIntent } from './telegramAiConversationCommands';
import { isAiHypotheticalQuestion } from './telegramAiMessageUnderstanding';

export type AiWorkflow = {id:string;version:number;updatedAt:number;steps:string[];index:number;token:string|null;state:'planning'|'waiting'|'blocked'|'done'|'cancelled';expiresAt:number};
const local=new Map<string,AiWorkflow>();
const key=(p:TelegramAiMessagePayload)=>`efluz:v1:telegram:workflow:${process.env.SUPABASE_DATA_NAMESPACE||process.env.NODE_ENV||'production'}:${process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]||'none'}:${p.chatId}:${p.threadId}:${p.fromUser.id}`;
/** Split only explicit task separators outside quoted payloads; never split the ordinary word “va”. */
export function splitAiWorkflow(text:string):string[]|null {
  if (text.length>6400 || isAiHypotheticalQuestion(text) || /^\//.test(text.trim()))return null;
  if (/\\["“”]/.test(text) || (text.match(/"/g)||[]).length%2 || (text.match(/“/g)||[]).length!==(text.match(/”/g)||[]).length || (text.match(/```/g)||[]).length%2)return null;
  const masked=text.replace(/"[^"]*"|“[^”]*”|```[\s\S]*?```/g,m=>' '.repeat(m.length));
  const cuts=[...masked.matchAll(/;|\n|\s+(?:keyin|so[‘’'`]?ng|undan\s+keyin)\s+/gi)];
  if (!cuts.length)return null;
  let cursor=0;const steps:string[]=[];
  for(const cut of cuts){steps.push(text.slice(cursor,cut.index).trim());cursor=cut.index!+cut[0].length;}
  steps.push(text.slice(cursor).trim());
  const clean=steps.map(s=>s.replace(/^\s*(?:\d[.)]|[-•])\s*/,'').trim());
  if(clean.length<2||clean.length>4||clean.some(s=>!s||s.length>1600||getConversationIntent(s)!=='admin'||isAiHypotheticalQuestion(s)))return null;
  return clean;
}
export function isAiWorkflowControl(text:string):boolean{return /^(?:davom et|davom ettir|keyingisi|keyingi topshiriq|topshiriqlar holati|navbat holati)$/i.test(text.trim());}
export const AI_WORKFLOW_CAS = `
-- EFL_AI_WORKFLOW_CAS_V1
local raw=redis.call('GET',KEYS[1])
local old=raw and cjson.decode(raw) or nil
if ARGV[1]=='new' then
 if old and old.expiresAt>tonumber(ARGV[4]) and old.state~='done' and old.state~='cancelled' then return 0 end
else
 if not old or old.id~=ARGV[2] or old.version~=tonumber(ARGV[1]) then return 0 end
end
redis.call('SET',KEYS[1],ARGV[3],'EX',1800)
return 1
`;
export async function getAiWorkflow(p:TelegramAiMessagePayload,signal?:AbortSignal):Promise<AiWorkflow|null>{
 const client=getAiRedisClient(signal);const raw=client?await client.get<AiWorkflow|string>(key(p)):process.env.NODE_ENV==='test'?local.get(key(p)):null;
 const value=typeof raw==='string'?JSON.parse(raw):raw;
 return value&&value.expiresAt>Date.now()?value:null;
}
export async function saveAiWorkflow(p:TelegramAiMessagePayload,previous:AiWorkflow|null,next:AiWorkflow,signal?:AbortSignal):Promise<boolean>{
 const client=getAiRedisClient(signal);
 if(client)return Number(await client.eval(AI_WORKFLOW_CAS,[key(p)],[previous?String(previous.version):'new',previous?.id||'',JSON.stringify(next),Date.now()]))===1;
 if(process.env.NODE_ENV!=='test')return false;
 const old=local.get(key(p));
 if(previous ? !old||old.id!==previous.id||old.version!==previous.version : old&&old.expiresAt>Date.now()&&!['done','cancelled'].includes(old.state))return false;
 local.set(key(p),structuredClone(next));return true;
}
export function newAiWorkflow(steps:string[]):AiWorkflow{return{id:randomBytes(12).toString('hex'),version:0,updatedAt:Date.now(),steps,index:0,token:null,state:'planning',expiresAt:Date.now()+1800000};}
export function workflowHeading(w:AiWorkflow):string{return `Topshiriqlar · ${Math.min(w.index+1,w.steps.length)}/${w.steps.length}\n${w.steps.map((s,i)=>`${i<w.index?'✓':i===w.index?'→':'○'} ${i+1}. ${s.length>150?s.slice(0,150)+'…':s}`).join('\n')}`;}
