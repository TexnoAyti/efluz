import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {getTopicResultStateClient} from '../services/telegramAiDeadline';
import {groupResultEvidenceFromMessage,recordGroupResultEvidence,
 updateGroupResultEvidenceOutcome,getGroupResultEvidenceAudit} from '../services/telegramGroupResultEvidence';
import {isEligibleTopicBacklogCompetition,groupBacklogScoreKey,previewGroupResultBacklog} from '../services/telegramGroupResultBacklog';

process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
await initDatabase();
const id=randomBytes(7).toString('hex'), db=getFirestoreDb();
const message={
 message_thread_id:2,chat:{id:-1001122334455,username:'efleagueuz',type:'supergroup'},
 from:{id:123456789,is_bot:false},message_id:710000+Number.parseInt(id.slice(0,4),16),
 date:1794930000,text:'Club A 2:1 Club B',
};
const updateId=710000+Number.parseInt(id.slice(4,8),16);
const evidence=groupResultEvidenceFromMessage(message,updateId);
assert.ok(evidence);
assert.equal(evidence.threadId,2);
assert.equal(evidence.senderId,123456789);
assert.equal(evidence.text,'Club A 2:1 Club B');
assert.equal(groupResultEvidenceFromMessage({...message,chat:{...message.chat,username:'other'}},updateId),null);
assert.equal(groupResultEvidenceFromMessage({...message,sender_chat:{id:-1001}},updateId),null);
assert.equal(groupResultEvidenceFromMessage({...message,from:{id:2,is_bot:true}},updateId),null);
assert.equal(groupResultEvidenceFromMessage({...message,message_thread_id:999999},updateId),null);
assert.equal(groupResultEvidenceFromMessage({...message,text:'Assalomu alaykum'},updateId),null);
assert.equal(isEligibleTopicBacklogCompetition('season-2027-28','comp-uzbekistan-superliga-2027'),true);
assert.equal(isEligibleTopicBacklogCompetition('season-2026-27','comp-champions-league-2026'),true);
assert.equal(isEligibleTopicBacklogCompetition('season-2026-27','comp-serie-a-2026'),false);
assert.equal(groupBacklogScoreKey({plan:{body:{homeScore:2,awayScore:1}}}),'2:1');

const fixtureId='topic-backlog-test-'+id,competitionId='comp-premier-league-2027';
const fixture={
 id:fixtureId,competitionId,seasonId:'season-2027-28',
 homeClubId:'club-arsenal',awayClubId:'club-chelsea',status:'SCHEDULED',
 matchday:1,homeScore:null,awayScore:null,updatedAt:'2026-11-17T01:00:00.000Z',
};
await db.collection('fixtures').doc(fixtureId).set(fixture);
await db.collection('competitions').doc(competitionId).set({
 id:competitionId,seasonId:'season-2027-28',type:'LEAGUE',status:'active',
 leagueId:'league-premier-league',currentMatchday:1,formatConfig:{totalClubs:20},
});
const client=getTopicResultStateClient();
assert.ok(client);
const prefix='efluz:v1:telegram:topic-result:';
const token=randomBytes(12).toString('hex');
const sourceKey=prefix+'source:'+evidence.chatId+':'+evidence.threadId+':'+evidence.messageId;
const proposalKey=prefix+'proposal:'+token;
const proposal={
 token,state:'pending',chat:evidence.chatId,thread:evidence.threadId,
 sourceMessage:evidence.messageId,deliveredMessage:evidence.messageId+1,
 updateId,expiresAt:Date.now()+3600000,
 plan:{action:'result_edit',targetId:fixtureId,body:{
 homeScore:2,awayScore:1,status:'CONFIRMED',
 expectedFixture:{
  seasonId:fixture.seasonId,competitionId,homeClubId:fixture.homeClubId,
  awayClubId:fixture.awayClubId,status:fixture.status,updatedAt:fixture.updatedAt,
 },
 }},
};
try{
 await client!.set(sourceKey,{token,updateId},{ex:3600});
 await client!.set(proposalKey,proposal,{ex:3600});
 await recordGroupResultEvidence(message,updateId);
 await updateGroupResultEvidenceOutcome(evidence,'proposal_sent');
 const audits=await getGroupResultEvidenceAudit(200);
 const stored=audits.entries.find(row=>row.id===evidence.id);
 assert.ok(stored);
 assert.equal(stored.threadId,2);
 assert.equal(stored.ingestionResult,'proposal_sent');
 assert.equal(stored.fixtureId,fixtureId);
 assert.equal(stored.proposedHome,2);
 assert.equal(stored.proposedAway,1);
 const preview=await previewGroupResultBacklog(100);
 assert.ok(preview.items.some(row=>row.fixtureId===fixtureId&&row.homeScore===2&&row.awayScore===1),'Verified pending source must appear');
 await db.collection('fixtures').doc(fixtureId).set({...fixture,status:'CONFIRMED',homeScore:2,awayScore:1});
 const confirmed=await previewGroupResultBacklog(100);
 assert.ok(!confirmed.items.some(row=>row.fixtureId===fixtureId),'Already confirmed score must not be eligible');
 console.log('PASS Telegram result evidence persistence, source link, season guard and safe backlog preview');
}finally{
 await client!.del(sourceKey,proposalKey);
 await db.collection('telegram_result_evidence').doc(evidence.id).delete();
 await db.collection('fixtures').doc(fixtureId).delete();
}
