import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,readUState} from '../services/uzeflifeService';
import {createULeagueMatches,uLeagueStandings} from '../../lib/uzeflifeLeague';
import {UZEFLIFE_RESULT_TOPIC} from '../../lib/uzeflifeResultTopic';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.TELEGRAM_BOT_TOKEN='777:isolated-topic-webhook';process.env.TELEGRAM_WEBHOOK_SECRET='isolated-topic-webhook-secret';
const {telegramRouter}=await import('../routes/telegram.routes');
const db=getFirestoreDb(),state=initialUState();state.format='LEAGUE';state.status='playing';state.round=1;
state.participants=Array.from({length:16},(_,i)=>({id:'topic-webhook-player-'+i,name:'@topic_player_'+i,status:'approved'}));
state.matches=createULeagueMatches(state.participants.map(p=>p.id));
const match=state.matches[0],sender=state.participants.find(p=>p.id===match.away)!;
const admin={id:'topic-webhook-admin',telegramId:'5209126900',username:'owner',firstName:'Owner',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''};
await db.collection('users').doc(admin.id).set(admin);
await db.collection('users').doc(sender.id).set({id:sender.id,telegramId:'10150',username:'participant',firstName:'Player',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''});
await db.collection('uzeflife').doc('championship').set(state);
const originalFetch=globalThis.fetch,collection=db.collection,sent:any[]=[];
globalThis.fetch=async(input:any,init?:any)=>{
 if(!String(input).startsWith('https://api.telegram.org/'))return originalFetch(input,init);
 const body=JSON.parse(init?.body||'{}');if(body.callback_query_id)return Response.json({ok:true});
 sent.push(body);return Response.json({ok:true,result:{message_id:9500+sent.length}});
};
let archiveReads=0;
db.collection=((name:string)=>{if(name==='ai_community_sources'){archiveReads++;throw Error('OPTIONAL_ARCHIVE_MUST_NOT_BLOCK_RESULTS');}return collection.call(db,name);}) as any;
const app=express();app.use(express.json());app.use('/api/telegram',telegramRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as any).port}/api/telegram/webhook`;
const post=async(body:any,secret='isolated-topic-webhook-secret')=>{const r=await originalFetch(url,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
try{
 const incoming={update_id:930001,message:{message_id:940001,message_thread_id:UZEFLIFE_RESULT_TOPIC,chat:{id:-100123,type:'supergroup',username:'efleagueuz'},from:{id:10150,is_bot:false},text:'2-1'}};
 assert.equal((await post(incoming,'wrong')).status,401);
 const response=await post(incoming);assert.equal(response.status,200);assert.equal(response.body.handled,'topic_result');assert.equal(response.body.result,'proposal_sent');
 assert.equal(archiveReads,0,'Optional archive must not run before a handled UZEFLIFE result');
 const preview=sent.at(-1);assert.ok(preview.text.includes('1:2'));assert.equal(preview.message_thread_id,UZEFLIFE_RESULT_TOPIC);
 assert.equal((await readUState()).matches[0].homeScore,null,'A score message does not bypass admin approval');
 const before=sent.length;assert.equal((await post(incoming)).body.ignored,'duplicate_update');assert.equal(sent.length,before);
 const callback={update_id:930002,callback_query:{id:'topic-webhook-approve',from:{id:5209126900},data:preview.reply_markup.inline_keyboard[0][0].callback_data,message:{message_id:9500+sent.length,message_thread_id:UZEFLIFE_RESULT_TOPIC,chat:{id:-100123,type:'supergroup'},from:{id:777}}}};
 const approved=await post(callback);assert.equal(approved.status,200);assert.equal(approved.body.result,'executing');
 const stored=await readUState();assert.equal(stored.matches[0].homeScore,1);assert.equal(stored.matches[0].awayScore,2);
 assert.equal(uLeagueStandings(stored).find(p=>p.id===sender.id)?.points,3);assert.equal(archiveReads,0);
 console.log('PASS signed UZEFLIFE webhook: plain 2-1, sender-first orientation, optional archive isolation, proposal/admin approval, standings and replay protection; Telegram mocked.');
}finally{db.collection=collection;globalThis.fetch=originalFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));}
