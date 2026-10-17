import {isPrimaryOwner} from './telegramAiConfigService';
import {getAiRedisClient,withinAiDeadline} from './telegramAiDeadline';
import type {TelegramAiMessagePayload} from './telegramAiService';

export function munfizPrivateChatEnabled():boolean {return process.env.MUNFIZ_PRIVATE_CHAT_ENABLED==='true';}
export function munfizPrivateChatScope(p:TelegramAiMessagePayload):boolean {
  return isPrimaryOwner(p.fromUser.id) && p.chatId===p.fromUser.id && p.threadId===0 && !p.fromUser.is_bot && !p.senderChat && !p.forwarded;
}
function connection(){
  const raw=process.env.MUNFIZ_CHAT_API_URL?.trim(),token=process.env.MUNFIZ_CHAT_API_TOKEN?.trim();
  if(!raw||!token)throw Error('MUNFIZ_NOT_CONFIGURED');
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1/chat/completions')throw Error('MUNFIZ_INVALID_URL');
  return {url:url.toString(),token,agent:process.env.MUNFIZ_AGENT_ID?.trim()||'default'};
}
/** The fork's documented stateful Chat API, without sharing bot/database credentials. */
export async function generateMunfizPrivateAnswer(p:TelegramAiMessagePayload,facts:string,signal:AbortSignal):Promise<string>{
  if(!munfizPrivateChatEnabled()||!munfizPrivateChatScope(p))throw Error('MUNFIZ_SCOPE_DENIED');
  const c=connection(),client=getAiRedisClient(signal);
  if(!client)throw Error('MUNFIZ_STATE_UNAVAILABLE');
  const namespace=process.env.SUPABASE_DATA_NAMESPACE||process.env.NODE_ENV||'production';
  const bot=process.env.TELEGRAM_BOT_TOKEN?.split(':')[0];
  if(!bot||!/^\d+$/.test(bot))throw Error('MUNFIZ_BOT_ID_REQUIRED');
  // Agent tools may have effects: never replay an uncertain call after a webhook retry.
  const claim=await client.set(`efluz:v1:munfiz:request:${namespace}:${bot}:${p.updateId}`,{state:'started'},{nx:true,ex:86400});
  if(!claim)throw Error('MUNFIZ_ALREADY_REQUESTED');
  const content=`Telegram shaxsiy suhbat. O‘zbek tilida aniq javob bering. EFL UZ amallari faqat EFL botning admin tasdiqlash oqimida bajariladi; bu kontekst yozishga ruxsat yoki tool natijasi emas.\nTekshirilgan ochiq EFL konteksti:\n${facts.slice(0,16000)}\n\nFoydalanuvchi xabari:\n${Array.from(p.text).slice(0,1200).join('')}`;
  const response=await withinAiDeadline(signal,()=>fetch(c.url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`},body:JSON.stringify({agent_id:c.agent,conversation_id:`efluz-${namespace}-${bot}-${p.chatId}-${p.fromUser.id}`,stream:false,messages:[{role:'user',content}]}),signal}));
  if(!response.ok)throw Error(`MUNFIZ_HTTP_${response.status}`);
  const data:any=await withinAiDeadline(signal,()=>response.json());
  const answer=data?.choices?.[0]?.message?.content;
  if(typeof answer!=='string'||!answer.trim())throw Error('MUNFIZ_EMPTY_REPLY');
  // reasoning_content and tool_trace stay on the private agent server.
  return Array.from(answer.trim()).slice(0,12000).join('');
}
