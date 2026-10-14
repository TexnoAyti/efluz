import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {handleTopicResultUpdate,setTestTopicResultDependencies} from '../services/telegramTopicResults';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.TELEGRAM_BOT_TOKEN='777:followup-test';
const comp='comp-la-liga-2026',seasonId='season-2026-27';
const clubs:any[]=[{id:'club-real-madrid',name:'Real Madrid',ownerUserId:'user-1001'},{id:'club-barcelona',name:'Barcelona',ownerUserId:'user-1002'}];
const game=(round:number)=>({id:'fixture-'+round,competitionId:comp,seasonId,matchday:round,homeClubId:clubs[0].id,awayClubId:clubs[1].id,home:'Real Madrid',away:'Barcelona',competition:'La Liga',status:'SCHEDULED',updatedAt:'v1'});
let games:any[]=[game(6),game(25)],executions=0;
setTestTopicResultDependencies({authorize:async id=>id===5209126900,reader:{read:async(q:any)=>({complete:true,stale:false,nextOffset:null,data:q.dataset==='competitions'?[{id:comp,name:'La Liga',type:'LEAGUE',leagueId:'league-la-liga',seasonId,currentMatchday:5}]:games.filter(f=>!q.matchday||f.matchday===q.matchday)})} as any,ownership:async()=>({data:clubs,stale:false,available:true}),execute:async()=>{executions++;throw Error('No execution before approval');}});
let sequence=400000;const sent:any[]=[];
const originalFetch=global.fetch,originalNow=Date.now;
global.fetch=async(_input:any,init:any)=>{const body=JSON.parse(init.body);body.botId=9000+sent.length;sent.push(body);return new Response(JSON.stringify({ok:true,result:{message_id:body.botId}}));};
const update=(chat:number,text:string,user=1001,reply?:number,thread=3)=>({update_id:++sequence,message:{message_id:sequence,message_thread_id:thread,chat:{id:chat,type:'supergroup',username:'efleagueuz'},from:{id:user},text,...(reply?{reply_to_message:{message_id:reply}}:{})}});
try{
  const first=update(-2001,'Real Madrid 2-1 Barca');
  assert.equal((await handleTopicResultUpdate(first)).result,'clarification');const prompt=sent.at(-1);
  assert.match(prompt.text,/1\..*6-tur.*2\..*25-tur/s);
  assert.equal((await handleTopicResultUpdate(update(-2001,'2',1002,prompt.botId))).handled,false,'another member cannot use this context');
  assert.equal((await handleTopicResultUpdate(update(-2001,'2',1001,prompt.botId,4))).handled,false,'another topic cannot use it');
  assert.equal((await handleTopicResultUpdate(update(-2001,'2',1001,123))).handled,false,'reply to unrelated message cannot use it');
  const choice=update(-2001,'2',1001,prompt.botId);
  assert.equal((await handleTopicResultUpdate(choice)).result,'proposal_sent');
  assert.match(sent.at(-1).text,/Real Madrid 2:1 Barcelona.*25-tur/s);
  assert.equal((await handleTopicResultUpdate(choice)).handled,false,'consumed context cannot repeat');
  games=[game(6)];
  for(const [chat,answer] of [[-2002,'ha'],[-2003,'6-tur'],[-2004,'1']] as const){
    assert.equal((await handleTopicResultUpdate(update(chat,'Real Madrid 4-3 Barca 5-tur'))).result,'clarification');
    const p=sent.at(-1);assert.equal((await handleTopicResultUpdate(update(chat,answer,1001,p.botId))).result,'proposal_sent');
    assert.match(sent.at(-1).text,/Real Madrid 4:3 Barcelona.*6-tur/s);
  }
  assert.equal((await handleTopicResultUpdate(update(-2005,'Real Madrid 2-1 natija kirit'))).result,'clarification');
  assert.equal((await handleTopicResultUpdate(update(-2005,'Barca',1001,sent.at(-1).botId))).result,'proposal_sent');
  assert.match(sent.at(-1).text,/Real Madrid 2:1 Barcelona/);
  const expired=update(-2006,'Real Madrid 2-1 Barca 5-tur');await handleTopicResultUpdate(expired);const expiredPrompt=sent.at(-1);
  const now=Date.now();Date.now=()=>now+901000;
  assert.equal((await handleTopicResultUpdate(update(-2006,'ha',1001,expiredPrompt.botId))).handled,false);Date.now=originalNow;
  const edited=update(-2007,'Real Madrid 2-1 Barca 5-tur');await handleTopicResultUpdate(edited);const editPrompt=sent.at(-1);
  await handleTopicResultUpdate({update_id:++sequence,edited_message:{...edited.message,text:'bekor'}});
  assert.equal((await handleTopicResultUpdate(update(-2007,'ha',1001,editPrompt.botId))).result,'context_expired');
  games=[game(6),game(25)];await handleTopicResultUpdate(update(-2008,'Real Madrid 3-2 Barca'));const racePrompt=sent.at(-1);
  const race=await Promise.all([handleTopicResultUpdate(update(-2008,'1',1001,racePrompt.botId)),handleTopicResultUpdate(update(-2008,'2',1001,racePrompt.botId))]);
  assert.equal(race.filter(r=>r.result==='proposal_sent').length,1,'atomic continuation consumption');
  await handleTopicResultUpdate(update(-2009,'Real Madrid 3-2 Barca'));const cancelPrompt=sent.at(-1);
  assert.equal((await handleTopicResultUpdate(update(-2009,'bekor',1001,cancelPrompt.botId))).result,'context_cancelled');
  assert.equal((await handleTopicResultUpdate(update(-2009,'1',1001,cancelPrompt.botId))).handled,false);
  games=[game(6)];
  const original=update(-2010,'Real Madrid 3-2 Barca 5-tur');await handleTopicResultUpdate(original);
  await handleTopicResultUpdate(update(-2010,'ha',1001,sent.at(-1).botId));const preview=sent.at(-1);
  await handleTopicResultUpdate({update_id:++sequence,edited_message:{...original.message,text:'bekor'}});
  assert.equal((await handleTopicResultUpdate({update_id:++sequence,callback_query:{id:'stale-origin',from:{id:5209126900},data:preview.reply_markup.inline_keyboard[0][0].callback_data,message:{message_id:preview.botId,message_thread_id:3,chat:{id:-2010},from:{id:777}}}})).result,'already_processed');
  assert.equal(executions,0);
  console.log('PASS durable same-user/topic followups: numbered choice, round, single-choice yes, missing club, expiry, edited source invalidation, cancellation, concurrent consumption and no execution before admin approval; Telegram mocked');
}finally{global.fetch=originalFetch;Date.now=originalNow;setTestTopicResultDependencies();}
