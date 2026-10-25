import {createHash} from 'node:crypto';
import {teamError} from './teamAccess';
// Bound each response below the hosting response limit, including worst-case PNG
// logos and 64-team individual fixtures. Snapshot tokens prevent mixed versions.
const TEAM_PAGE=32,FIXTURE_PAGE=160,MAX_CACHE_BYTES=16*1024*1024;
const snapshots=new Map<string,{data:any;bytes:number;until:number}>();
let cachedBytes=0;
const canonical=(data:any)=>JSON.stringify(data,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
const digest=(data:any)=>createHash('sha256').update(canonical(Array.isArray(data?.fixtures)?[data.id,data.version,data.updatedAt,data.name,data.status,data.currentRound,data.totalRounds,data.fixtures]:data)).digest('hex').slice(0,32);
const key=(actor:string,path:string,snapshot:string)=>actor+':'+path+':'+snapshot;
export function clearTeamTransportSnapshots(){snapshots.clear();cachedBytes=0;}
function remember(actor:string,path:string,data:any,snapshot:string){
 const id=key(actor,path,snapshot),bytes=Buffer.byteLength(JSON.stringify(data));if(bytes>MAX_CACHE_BYTES)return;
 for(const [k,item] of snapshots)if(item.until<Date.now()){snapshots.delete(k);cachedBytes-=item.bytes;}
 if(snapshots.has(id))return;
 while(cachedBytes+bytes>MAX_CACHE_BYTES&&snapshots.size){const first=snapshots.keys().next().value!;cachedBytes-=snapshots.get(first)!.bytes;snapshots.delete(first);}
 snapshots.set(id,{data,bytes,until:Date.now()+60000});cachedBytes+=bytes;
}
export function cachedTeamTransport(actor:string,path:string,query:any){
 if(typeof query.teamSnapshot!=='string')return undefined;
 const item=snapshots.get(key(actor,path,query.teamSnapshot));return item&&item.until>Date.now()?item.data:undefined;
}
export function paginateTeamTransport(actor:string,path:string,query:any,data:any):any{
 if(!data||typeof data!=='object')return data;
 const snapshot=digest(data);
 if(query.teamSnapshot!==undefined&&query.teamSnapshot!==snapshot)throw teamError('Turnir yoki teamlar yangilangan. Qayta yuklang.',409,'TEAM_SNAPSHOT_CHANGED');
 const offset=(name:string)=>{const raw=query[name];if(raw===undefined)return 0;if(typeof raw!=='string'||!/^\d{1,6}$/.test(raw))throw teamError('Sahifa raqami noto‘g‘ri.');return Number(raw);};
 const out={...data};
 if(Array.isArray(data.teams)&&data.teams.length>TEAM_PAGE){
  const start=offset('teamOffset');if(start>=data.teams.length)throw teamError('Team sahifasi topilmadi.',400);
  out.teams=data.teams.slice(start,start+TEAM_PAGE);out.teamPage={snapshot,total:data.teams.length,next:start+TEAM_PAGE<data.teams.length?`${path}?teamOffset=${start+TEAM_PAGE}&teamSnapshot=${snapshot}`:null};remember(actor,path,data,snapshot);
 }
 if(Array.isArray(data.fixtures)&&data.fixtures.length>FIXTURE_PAGE){
  const start=offset('fixtureOffset');if(start>=data.fixtures.length)throw teamError('O‘yinlar sahifasi topilmadi.',400);
  const readPath=path.replace(/\/actions$/,'');out.fixtures=data.fixtures.slice(start,start+FIXTURE_PAGE);out.fixturePage={snapshot,total:data.fixtures.length,next:start+FIXTURE_PAGE<data.fixtures.length?`${readPath}?fixtureOffset=${start+FIXTURE_PAGE}&teamSnapshot=${snapshot}`:null};remember(actor,readPath,data,snapshot);
 }
 if(Array.isArray(data.leagues))out.leagues=data.leagues.map((league:any)=>{
  if(!Array.isArray(league.fixtures)||league.fixtures.length<=FIXTURE_PAGE)return league;
  const readPath=(path.includes('/published')?'/published':'')+'/leagues/'+league.id,token=digest(league);remember(actor,readPath,league,token);
  return {...league,fixtures:[],fixturePage:{snapshot:token,total:league.fixtures.length,next:`${readPath}?fixtureOffset=0&teamSnapshot=${token}`}};
 });
 return out;
}
