import type {Fixture} from '../types';
import {BALLOT_POINTS,type AwardPlayer,type AwardElection,type AwardStanding} from '../types/seasonAwards';
export type AwardOwner={clubId:string;userId:string;claimedAt?:string};
export type AwardAccount={id:string;telegramId?:string;username?:string;firstName?:string;isSuspended?:boolean};
export function awardWeek(now:number){const shifted=new Date(now+5*3600000);const day=(shifted.getUTCDay()+6)%7;const from=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()-day)-5*3600000;return{from,to:from+7*86400000};}
export function rankAwardPlayers(players:AwardPlayer[]){return [...players].sort((a,b)=>b.points/aSafe(b.played)-a.points/aSafe(a.played)||(b.goals-b.conceded)/aSafe(b.played)-(a.goals-a.conceded)/aSafe(a.played)||b.titles-a.titles||b.goals/aSafe(b.played)-a.goals/aSafe(a.played)||b.played-a.played||a.id.localeCompare(b.id));}
const aSafe=(v:number)=>Math.max(1,v);
export function awardPlayers(fixtures:Fixture[],owners:AwardOwner[],accounts:AwardAccount[],titles:{winnerUserId?:string}[]=[],period?:{from:number;to:number}){
 const users=new Map(accounts.filter(u=>!u.isSuspended&&/^\d+$/.test(u.telegramId||'')).map(u=>[u.id,u]));
 const byClub=new Map(owners.map(o=>[o.clubId,o]));const rows=new Map<string,AwardPlayer>();let unattributed=0;
 for(const f of fixtures){
  if(f.status!=='CONFIRMED'||!f.homeClubId||!f.awayClubId||!Number.isInteger(f.homeScore)||!Number.isInteger(f.awayScore)||f.homeScore!<0||f.awayScore!<0)continue;
  const at=Date.parse(f.resultConfirmedAt||'');if(period&&(!Number.isFinite(at)||at<period.from||at>=period.to))continue;
  for(const side of ['home','away'] as const){
   const club=f[`${side}ClubId`]!,owner=byClub.get(club),recorded=f[`${side}OwnerId`]||f[`${side}Owner`]?.userId;
   // An owner transfer must not award the new owner goals scored before their tenure.
   const id=recorded||(owner&&Number.isFinite(at)&&Number.isFinite(Date.parse(owner.claimedAt||''))&&at>=Date.parse(owner.claimedAt!)?owner.userId:null),u=id?users.get(id):null;
   if(!u){unattributed++;continue;}
   let r=rows.get(u.id);if(!r){r={id:u.id,name:u.username?'@'+u.username.replace(/^@/, ''):u.firstName||'O‘yinchi',clubs:[],played:0,wins:0,draws:0,goals:0,conceded:0,points:0,titles:0};rows.set(u.id,r);}
   if(!r.clubs.includes(club))r.clubs.push(club);const gf=f[`${side}Score`]!,ga=f[side==='home'?'awayScore':'homeScore']!;r.played++;r.goals+=gf;r.conceded+=ga;if(gf>ga){r.wins++;r.points+=3;}else if(gf===ga){r.draws++;r.points++;}
  }
 }
 for(const t of titles){const r=rows.get(t.winnerUserId||'');if(r)r.titles++;}
 return{players:[...rows.values()],unattributed};
}
export function awardStandings(e:AwardElection):AwardStanding[]{
 const rows=new Map(e.nominees.map(player=>[player.id,{player,points:0,places:Array(10).fill(0) as number[]}]));
 for(const ballot of Object.values(e.ballots))for(const [place,id] of ballot.ranking.entries()){const row=rows.get(id);if(row&&place<10){row.points+=BALLOT_POINTS[place];row.places[place]++;}}
 return [...rows.values()].sort((a,b)=>b.points-a.points||comparePlaces(a.places,b.places)||a.player.id.localeCompare(b.player.id));
}
function comparePlaces(a:number[],b:number[]){for(let i=0;i<10;i++){if(a[i]!==b[i])return b[i]-a[i];}return 0;}
export function awardTiedWinners(rows:AwardStanding[]){const first=rows[0];return first?rows.filter(r=>r.points===first.points&&comparePlaces(r.places,first.places)===0).map(r=>r.player.id):[];}
