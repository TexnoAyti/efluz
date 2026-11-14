import {getFirestoreDb} from '../firebase/admin';
import {authorizePenaltyFixture} from './matchChatService';
import type {User} from '../../types';

type Side='home'|'away';
type Race={
  fixtureId:string; seasonId:string; participants:[string,string];
  goals:Record<Side,number>; shots:Record<Side,number>;
  recentShotIds:string[]; lastShotAt:Record<Side,number>;
  legacyImported?:Partial<Record<Side,boolean>>;
  updatedAt:string; expiresAt:number;
};
export class PenaltyRaceError extends Error {
 constructor(message:string,public statusCode=400){super(message);}
}
const validId=(id:string)=>/^[A-Za-z0-9:_-]{1,180}$/.test(id);
const BASE='penalty_exhibition_v1_';
// Keep historical exhibition scores through the season instead of expiring after a day.
const lifetime=90*24*60*60*1000;
const blank=(fixtureId:string,seasonId:string,participants:string[]):Race=>({
 fixtureId,seasonId,participants:[participants[0],participants[1]],
 goals:{home:0,away:0},shots:{home:0,away:0},recentShotIds:[],legacyImported:{home:false,away:false},
 lastShotAt:{home:0,away:0},updatedAt:new Date().toISOString(),expiresAt:Date.now()+lifetime,
});
const show=(race:Race,user:User)=>({
 fixtureId:race.fixtureId,goals:race.goals,shots:race.shots,
 side:race.participants[0]===user.id?'home':'away',
 legacyImported:Boolean(race.legacyImported?.[race.participants[0]===user.id?'home':'away']),
 updatedAt:race.updatedAt,official:false,
});
const refFor=(fixtureId:string)=>getFirestoreDb().collection('penalty_exhibition_races').doc(BASE+fixtureId);

/** Single small durable read per 5-second active client poll. No animation writes. */
export async function getPenaltyRace(fixtureId:string,user:User){
 if(!validId(fixtureId))throw new PenaltyRaceError('INVALID_FIXTURE',400);
 const ref=refFor(fixtureId),snapshot=await ref.get();
 const data=snapshot.data() as Race|undefined;
 if(data&&data.expiresAt>Date.now()){
  if(!data.participants.includes(user.id))throw new PenaltyRaceError('NOT_PARTICIPANT',403);
  return show(data,user);
 }
 const auth=await authorizePenaltyFixture(fixtureId,user);
 const fresh=await getFirestoreDb().runTransaction(async tx=>{
  const snap=await tx.get(ref),current=snap.data() as Race|undefined;
  if(current&&current.expiresAt>Date.now()){
   if(!current.participants.includes(user.id))throw new PenaltyRaceError('NOT_PARTICIPANT',403);
   return current;
  }
  const next=blank(fixtureId,auth.seasonId,auth.participants);
  tx.set(ref,next);return next;
 });
 return show(fresh,user);
}

/** Client-reported *exhibition* result. Not a verified game simulation or official result.
 * Atomic retry dedupe, bounded shots and cooldown; only verified current owners can write. */
export async function submitPenaltyShot(fixtureId:string,user:User,shotId:string,goal:boolean){
 if(!validId(fixtureId)||!/^[a-zA-Z0-9_-]{8,80}$/.test(shotId)||typeof goal!=='boolean')
  throw new PenaltyRaceError('INVALID_SHOT',400);
 const auth=await authorizePenaltyFixture(fixtureId,user);
 if(auth.closed)throw new PenaltyRaceError('MATCH_CLOSED',409);
 const ref=refFor(fixtureId),now=Date.now(),side=auth.side;
 const result=await getFirestoreDb().runTransaction(async tx=>{
  const snap=await tx.get(ref);
  const old=snap.data() as Race|undefined;
  const current=old&&old.expiresAt>now&&old.participants[0]===auth.participants[0]&&old.participants[1]===auth.participants[1]
   ?old:blank(fixtureId,auth.seasonId,auth.participants);
  if(current.recentShotIds.includes(shotId))return current;
  if(current.shots[side]>=100)throw new PenaltyRaceError('EXHIBITION_LIMIT_REACHED',429);
  if(now-current.lastShotAt[side]<850)throw new PenaltyRaceError('SHOT_TOO_FAST',429);
  const next:Race={...current,
   goals:{...current.goals,[side]:current.goals[side]+(goal?1:0)},
   shots:{...current.shots,[side]:current.shots[side]+1},
   lastShotAt:{...current.lastShotAt,[side]:now},
   recentShotIds:[...current.recentShotIds,shotId].slice(-200),
   updatedAt:new Date(now).toISOString(),
   expiresAt:now+lifetime,
  };
  tx.set(ref,next);return next;
 });
 return show(result,user);
}

/** Migrate a phone's old device-local exhibition goals exactly once per team.
 * Calls are authenticated as the actual fixture owner; values remain
 * explicitly unverified exhibition counters and never update match results. */
export async function importLocalPenaltyGoals(fixtureId:string,user:User,localGoals:number){
 if(!validId(fixtureId)||!Number.isSafeInteger(localGoals)||localGoals<0||localGoals>500)
  throw new PenaltyRaceError('INVALID_LEGACY_GOALS',400);
 const auth=await authorizePenaltyFixture(fixtureId,user);
 const ref=refFor(fixtureId),now=Date.now(),side=auth.side;
 const result=await getFirestoreDb().runTransaction(async tx=>{
  const snap=await tx.get(ref),stored=snap.data() as Race|undefined;
  const current=stored&&stored.expiresAt>now&&stored.participants[0]===auth.participants[0]&&stored.participants[1]===auth.participants[1]
   ?stored:blank(fixtureId,auth.seasonId,auth.participants);
  if(current.legacyImported?.[side])return current;
  const next:Race={...current,
    legacyImported:{...current.legacyImported,[side]:true},
    goals:{...current.goals,[side]:current.goals[side]+localGoals},
    updatedAt:new Date(now).toISOString(),
    expiresAt:now+lifetime,
  };
  tx.set(ref,next);
  return next;
 });
 return show(result,user);
}
