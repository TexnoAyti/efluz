import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {readMatchChatAvatar,MatchChatError} from '../services/matchChatService';
import type {User} from '../../types';

await initDatabase();
const db=getFirestoreDb(),seasonId='season-avatar-regression',matchId='fixture-avatar-regression';
const person=(id:string,photoUrl=''):User=>({
 id,telegramId:id.replace(/\D/g,'')||'1',username:id,firstName:id,photoUrl,
 isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''
});
const viewer=person('user-81001');
const opponent=person('user-81002','https://t.me/i/userpic/320/known-test.jpg');
const outsider=person('user-81003');
for(const p of [viewer,opponent,outsider]) await db.collection('users').doc(p.id).set(p);
for(const [id,name] of [['avatar-home','Avatar Home'],['avatar-away','Avatar Away']])
 await db.collection('clubs').doc(id).set({id,name,leagueId:'test',createdAt:''});
await db.collection('club_occupancies').doc(seasonId+'_avatar-home')
 .set({seasonId,clubId:'avatar-home',userId:viewer.id,status:'active'});
await db.collection('club_occupancies').doc(seasonId+'_avatar-away')
 .set({seasonId,clubId:'avatar-away',userId:opponent.id,status:'active'});
await db.collection('fixtures').doc(matchId).set({
 id:matchId,seasonId,competitionId:'comp-test-avatar',competitionName:'Avatar Test',
 matchday:1,homeClubId:'avatar-home',awayClubId:'avatar-away',
 status:'SCHEDULED',roundName:'1-tur',createdAt:'',updatedAt:''
});
const previousToken=process.env.TELEGRAM_BOT_TOKEN;
const previousFetch=globalThis.fetch;
process.env.TELEGRAM_BOT_TOKEN='';
const requested:string[]=[];
globalThis.fetch=(async(input:any)=>{
 const url=String(input);
 requested.push(url);
 assert.equal(url,'https://t.me/i/userpic/320/known-test.jpg');
 return new Response(Uint8Array.from([255,216,255,217]),{
  status:200,headers:{'Content-Type':'image/jpeg'}
 });
}) as typeof fetch;
try{
 const output=await readMatchChatAvatar('fixture',matchId,viewer,'opponent');
 assert.equal(output?.contentType,'image/jpeg');
 assert.equal(output?.bytes.length,4);
 assert.deepEqual(requested,['https://t.me/i/userpic/320/known-test.jpg']);
 await assert.rejects(readMatchChatAvatar('fixture',matchId,outsider,'opponent'),
  (error:any)=>error instanceof MatchChatError&&error.code==='NOT_MATCH_PARTICIPANT');
}finally{
 globalThis.fetch=previousFetch;
 if(previousToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;
 else process.env.TELEGRAM_BOT_TOKEN=previousToken;
}
console.log('CHAT_AVATAR_PASS: signed participant-only Telegram photo proxy, no external hotlink in WebView');
