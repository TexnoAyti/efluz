import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { getFirestoreDb } from '../firebase/admin';
import { authMiddleware } from '../middleware/authMiddleware';
import { createSessionToken } from '../auth/sessionToken';
import { customTournamentsRouter } from '../routes/customTournaments.routes';
import { customTournamentTicketsRouter } from '../routes/customTournamentTickets.routes';
import { SEED_CLUBS } from '../db/seed';

export async function verifyTournamentCreationHttp(failNextCommit: () => void) {
  const db = getFirestoreDb();
  process.env.SESSION_SECRET = 'isolated-tournament-http-secret-32bytes';
  const actors = Array.from({length:6}, (_,i) => ({id:`user-${880001+i}`,telegramId:String(880001+i),firstName:'Tournament',lastName:'',username:`player${i}`,photoUrl:'',isAdmin:false,isSuspended:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
  for (const actor of actors) await db.collection('users').doc(actor.id).set(actor);
  const app = express(); app.use(express.json()); app.use(authMiddleware);
  app.use('/api/custom-tournaments/tickets', customTournamentTicketsRouter);
  app.use('/api/custom-tournaments', customTournamentsRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/custom-tournaments`;
  const call = async (path:string, actor:number, body?:unknown) => {
    const response = await fetch(base + path, {method:body === undefined ? 'GET' : 'POST', headers:{'content-type':'application/json',authorization:`Bearer ${createSessionToken(actors[actor])}`},body:body === undefined ? undefined : JSON.stringify(body)});
    return {status:response.status, data:await response.json() as any};
  };
  const payload = {name:'Host club atomic HTTP',idempotencyKey:'host-club-create',organizerClubId:SEED_CLUBS[0].id,format:'PLAYOFF',leagueScope:'TOP5_ALL',maxParticipants:4,visibility:'PRIVATE',spectatorAccess:'PUBLIC_LINK',rules:{roundsCount:1,playoffLegMode:'SINGLE_LEG',matchDurationHours:24}};
  try {
    assert.equal((await call('/tickets/balance',0)).data.account.balance,1);
    assert.equal((await call('/create',0,{...payload,organizerClubId:'missing'})).status,400);
    assert.equal((await call('/create',0,{...payload,maxParticipants:0})).status,400);
    assert.equal((await call('/tickets/balance',0)).data.account.balance,1);
    failNextCommit();
    assert.ok((await call('/create',0,payload)).status >= 500);
    for (const collection of ['custom_tournaments','custom_tournament_participants']) assert.equal((await db.collection(collection).where(collection==='custom_tournaments'?'organizerUserId':'userId','==',actors[0].id).get()).size,0);
    assert.equal((await call('/tickets/balance',0)).data.account.balance,1,'Failed create rolls back ticket and host club');
    const created = await Promise.all([call('/create',0,payload),call('/create',0,payload)]);
    assert.ok(created.every(r => r.status === 200),JSON.stringify(created));
    const t = created[0].data.tournament;
    assert.equal(t.id,created[1].data.tournament.id);
    assert.equal(t.currentParticipantsCount,1);
    assert.equal((await call('/tickets/balance',0)).data.account.balance,0);
    let details = (await call('/'+t.id,0)).data;
    assert.equal(details.participants.length,1); assert.equal(details.participants[0].status,'REGISTERED');
    assert.equal(details.participants[0].username,actors[0].username);
    assert.equal((await call('/create',0,{...payload,organizerClubId:SEED_CLUBS[1].id})).status,409);
    assert.equal((await call('/'+t.id,1)).status,403);
    assert.equal((await call('/'+t.id+'?token='+t.spectatorToken,1)).data.canJoin,false);
    assert.equal((await call('/'+t.id+'/join',1,{clubId:SEED_CLUBS[1].id,inviteToken:t.spectatorToken})).status,403);
    const joins = await Promise.all([1,2].map(i=>call('/'+t.id+'/join',i,{clubId:SEED_CLUBS[1].id,inviteToken:t.inviteToken})));
    assert.deepEqual(joins.map(r=>r.status).sort(),[200,409]);
    const joined = joins.find(r=>r.status===200)!.data.participant.userId;
    const joinedIndex = actors.findIndex(a=>a.id===joined);
    assert.equal((await call('/'+t.id+'/join',joinedIndex,{clubId:SEED_CLUBS[2].id,inviteToken:t.inviteToken})).status,409);
    for (const i of [3,4]) assert.equal((await call('/'+t.id+'/join',i,{clubId:SEED_CLUBS[i].id,inviteToken:t.inviteToken})).status,200);
    assert.equal((await call('/'+t.id+'/join',5,{clubId:SEED_CLUBS[5].id,inviteToken:t.inviteToken})).data.code,'TOURNAMENT_FULL');
    assert.equal((await call('/'+t.id+'/start',1,{})).status,403);
    assert.equal((await call('/'+t.id+'/start',0,{})).status,200);
    details = (await call('/'+t.id,0)).data;
    assert.equal(details.tournament.status,'IN_PROGRESS'); assert.equal(details.fixtures.length,3);
    for (let round=1;round<=2;round++) {
      details = (await call('/'+t.id,0)).data;
      for (const f of details.fixtures.filter((f:any)=>f.roundOrMatchday===round)) {
        assert.equal((await call('/'+t.id+'/matches/'+f.id+'/result',0,{homeScore:1,awayScore:0})).status,200);
      }
    }
    assert.equal((await call('/'+t.id,0)).data.tournament.status,'COMPLETED');
    assert.equal((await call('/tickets/balance',1)).data.account.balance,1,'Joining remains free');
    console.log('PASS signed tournament HTTP + native SQL: host club, failed create rollback, parallel retry, ticket exactly once, private/spectator boundaries, club/user exclusion, capacity, authorized start and completed playoff.');
  } finally { server.close(); }
}
