import assert from 'node:assert/strict';
import {planNaturalAdminRequest} from '../services/telegramAiNaturalAdminPlanner';
const clubs=[
  {id:'club-monaco',name:'AS Monaco',leagueId:'league-ligue-1'},
  {id:'club-lorient',name:'FC Lorient',leagueId:'league-ligue-1'},
];
const fixture={id:'comp-ligue-1-2027-md1-club-monaco-club-lorient',
 competitionId:'comp-ligue-1-2027',seasonId:'season-2027-28',status:'CONFIRMED',
 homeClubId:'club-monaco',awayClubId:'club-lorient',homeScore:0,awayScore:3,
 home:'AS Monaco',away:'FC Lorient',competition:'Ligue 1',matchday:1};
const competition={id:'comp-ligue-1-2027',name:'Ligue 1',leagueId:'league-ligue-1',type:'LEAGUE',seasonId:'season-2027-28'};
let oldFixture:any=null;
const readSeason=(seasonId:string)=>async(query:any)=>{
 const isCurrent=seasonId==='season-2027-28';
 const rows=query.dataset==='clubs'?clubs:
 query.dataset==='competitions'?(isCurrent?[competition]:[{...competition,id:'comp-ligue-1-2026',seasonId:'season-2026-27'}]):
 query.dataset==='fixtures'?(isCurrent?[fixture]:oldFixture?[oldFixture]:[]):[];
 const filtered=query.dataset!=='fixtures'?rows:rows.filter((f:any)=>
   (!query.fixtureId||f.id===query.fixtureId)&&
   (!query.competition||f.competitionId===query.competition)&&
   (!query.club||[f.homeClubId,f.awayClubId].includes(query.club))&&
   (!query.opponent||[f.homeClubId,f.awayClubId].includes(query.opponent))&&
   (!query.matchday||f.matchday===query.matchday));
 return {data:filtered.slice(query.offset||0,(query.offset||0)+(query.limit||30)),
 total:filtered.length,complete:true,stale:false,nextOffset:null};
};
const deps={read:readSeason('season-2026-27'),readSeason,users:async()=>[]};
const selected=await planNaturalAdminRequest('AS Monaco 0-3 FC Lorient Bekor qil natijani',deps);
assert.equal(selected?.action,'result_clear');
assert.equal(selected?.targetId,fixture.id,'Must target actual Season 2 confirmed fixture');
await assert.rejects(planNaturalAdminRequest('AS Monaco 1-2 FC Lorient Bekor qil natijani',deps),/Tasdiqlangan hisob/);
oldFixture={...fixture,id:'comp-ligue-1-2026-md1-club-monaco-club-lorient',competitionId:'comp-ligue-1-2026',seasonId:'season-2026-27'};
await assert.rejects(planNaturalAdminRequest('AS Monaco 0-3 FC Lorient Bekor qil natijani',deps),/bir nechta tasdiqlangan/);
const explicit=await planNaturalAdminRequest('fixture id: '+fixture.id+' AS Monaco 0-3 FC Lorient bekor qil natijani',deps);
assert.equal(explicit?.targetId,fixture.id);
console.log('PASS Season 2 confirmed score cancel proposal, score consistency, and cross-season ambiguity guard');
