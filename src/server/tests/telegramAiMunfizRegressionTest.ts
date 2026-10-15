import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {generateMunfizPrivateAnswer} from '../services/munfizPrivateChat';
import {handleTelegramAiMessage,clearTestAiState} from '../services/telegramAiService';
import {DEFAULT_AI_CONFIG,setTestConfigOverride} from '../services/telegramAiConfigService';
import {setTestGroundingOverride} from '../services/telegramAiGroundingService';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.MUNFIZ_PRIVATE_CHAT_ENABLED='true';process.env.MUNFIZ_CHAT_API_URL='https://munfiz.example/v1/chat/completions';
process.env.MUNFIZ_CHAT_API_TOKEN='test-private-api-secret';process.env.TELEGRAM_BOT_TOKEN='777:test-bot-secret';
const payload={updateId:901000,messageId:901000,chatId:5209126900,threadId:0,fromUser:{id:5209126900},text:'Rejamni o‘ylashga yordam ber'};
const signal=new AbortController().signal,requests:any[]=[],sent:any[]=[];
const originalFetch=global.fetch;
let reject=false;
global.fetch=async(input:any,init:any)=>{
  const body=JSON.parse(init.body);
  if(String(input).startsWith('https://munfiz.example')){
    requests.push({body,headers:init.headers,redirect:init.redirect});
    if(reject)return new Response(JSON.stringify({error:'private backend secret'}),{status:401});
    return new Response(JSON.stringify({choices:[{message:{content:'Aniq javob <b>matn</b>',reasoning_content:'PRIVATE_REASONING',tool_trace:[{result:'PRIVATE_TOOL_RESULT'}]}}]}));
  }
  assert.ok(String(input).includes('api.telegram.org'));sent.push(body);
  return new Response(JSON.stringify({ok:true,result:{message_id:7000+sent.length}}));
};
try{
  const answer=await generateMunfizPrivateAnswer(payload,'La Liga 6-tur',signal);
  assert.equal(answer,'Aniq javob <b>matn</b>');assert.equal(requests.length,1);
  assert.equal(requests[0].headers.Authorization,'Bearer test-private-api-secret');assert.equal(requests[0].redirect,'error');
  assert.match(requests[0].body.conversation_id,/efluz-preview-777-5209126900-5209126900/);
  assert.equal(requests[0].body.stream,false);assert.equal(requests[0].body.messages.length,1);
  assert.ok(!JSON.stringify(requests[0].body).includes('test-bot-secret'));
  await generateMunfizPrivateAnswer({...payload,updateId:901001,text:'Davom etamiz'},'La Liga',signal);
  assert.equal(requests[1].body.conversation_id,requests[0].body.conversation_id);
  await assert.rejects(generateMunfizPrivateAnswer(payload,'',signal),/ALREADY_REQUESTED/);assert.equal(requests.length,2);
  for(const denied of [{...payload,chatId:-1001,threadId:3503},{...payload,forwarded:true},{...payload,senderChat:true},{...payload,chatId:123,fromUser:{id:123}},{...payload,fromUser:{id:5209126900,is_bot:true}}])await assert.rejects(generateMunfizPrivateAnswer(denied,'',signal),/SCOPE_DENIED/);
  reject=true;await assert.rejects(generateMunfizPrivateAnswer({...payload,updateId:901002},'',signal),error=>{assert.equal(String(error),'Error: MUNFIZ_HTTP_401');return true;});
  await assert.rejects(generateMunfizPrivateAnswer({...payload,updateId:901002},'',signal),/ALREADY_REQUESTED/);assert.equal(requests.length,3);reject=false;
  process.env.MUNFIZ_CHAT_API_URL='http://munfiz.example/v1/chat/completions';
  await assert.rejects(generateMunfizPrivateAnswer({...payload,updateId:901003},'',signal),/INVALID_URL/);process.env.MUNFIZ_CHAT_API_URL='https://munfiz.example/v1/chat/completions';
  const aborted=new AbortController();aborted.abort();await assert.rejects(generateMunfizPrivateAnswer({...payload,updateId:901004},'',aborted.signal));assert.equal(requests.length,3);
  clearTestAiState();setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503});
  setTestGroundingOverride({competitions:[],clubs:[],standings:{},fixtures:{}});
  const direct={...payload,updateId:901100,messageId:901100,text:'salom'};
  const result=await handleTelegramAiMessage(direct);assert.equal(result.replySent,true);assert.equal(requests.length,4);
  assert.equal(sent.at(-1).text,'Aniq javob <b>matn</b>');assert.ok(!sent.at(-1).parse_mode);
  assert.ok(!JSON.stringify(sent).includes('PRIVATE_REASONING'));assert.ok(!JSON.stringify(sent).includes('PRIVATE_TOOL_RESULT'));
  await handleTelegramAiMessage(direct);assert.equal(requests.length,4,'webhook retry does not rerun agent');
  process.env.MUNFIZ_PRIVATE_CHAT_ENABLED='false';await handleTelegramAiMessage({...direct,updateId:901101,messageId:901101});assert.equal(requests.length,4,'disabled adapter preserves existing replies');
  console.log('PASS Munfiz documented stateful API contract, owner-only private scope, stable conversation, bearer isolation, no secrets/traces in reply, HTTPS/no redirects, abort and request replay guards, full Telegram orchestration and disabled compatibility; external HTTP mocked');
}finally{global.fetch=originalFetch;setTestConfigOverride(null);setTestGroundingOverride(null);clearTestAiState();}
