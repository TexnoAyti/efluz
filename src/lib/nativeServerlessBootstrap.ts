// Telegram Serverless identity bootstrap. The platform provides signed
// caller identity to the backend. Never accept identity from URL or initDataUnsafe.
import type {User,Club,Season} from '../types';
import {callEflTransport} from './serverlessTransport';

export type NativeEflSession = {
 user:User|null;
 season:Season|null;
 ownedClubs:Club[];
 currentClub:Club|null;
 currentClubStatus:'unavailable'|'resolved';
};
export function decodeNativeEflBootstrap(value:unknown,selectedSeasonId?:string):NativeEflSession {
 if(selectedSeasonId && !/^season-20\d{2}-\d{2}$/.test(selectedSeasonId))
   throw Error('SERVERLESS_INVALID_SEASON');
 if(!value||typeof value!=='object'||(value as any).ok!==true)
   throw new Error('SERVERLESS_BOOTSTRAP_UNVERIFIED');
 const result=value as Record<string,unknown>;
 if(result.user==null)
   return {user:null,season:null,ownedClubs:[],currentClub:null,currentClubStatus:'unavailable'};
 const u=result.user as Record<string,unknown>;
 // These identifiers must come from the authenticated Serverless backend.
 if(!u||typeof u!=='object'||typeof u.id!=='string'||!u.id||
    !['string','number'].includes(typeof u.telegramId)||!String(u.telegramId))
   throw new Error('SERVERLESS_USER_CONTRACT_MISMATCH');
 const user:User={
   id:u.id,
   telegramId:String(u.telegramId),
   username:typeof u.username==='string'?u.username:'',
   firstName:typeof u.firstName==='string'?u.firstName:'',
   lastName:typeof u.lastName==='string'?u.lastName:'',
   photoUrl:typeof u.photoUrl==='string'?u.photoUrl:'',
   isAdmin:u.isAdmin===true,
   isSuspended:u.isSuspended===true,
   createdAt:typeof u.createdAt==='string'?u.createdAt:'',
   updatedAt:typeof u.updatedAt==='string'?u.updatedAt:'',
 };
 const active=result.activeSeason;
 let season:Season|null=null;
 if(active && typeof active==='object'){
   const entry=active as Record<string,unknown>;
   if(typeof entry.id==='string' && /^season-20\d{2}-\d{2}$/.test(entry.id)){
     season={id:entry.id,name:typeof entry.name==='string'?entry.name:entry.id,
       status:entry.status==='registration'?'registration':'active',
       startDate:typeof entry.startDate==='string'?entry.startDate:'',
       createdAt:typeof entry.createdAt==='string'?entry.createdAt:''};
   }
 }
 // Ownership is accepted only from the authenticated backend query, which
 // scopes records by the Serverless-signed Telegram ID. Never infer missing
 // clubs from a displayed name, client URL or Telegram initDataUnsafe.
 const verifiedRows=Array.isArray(result.ownerships)?result.ownerships:[];
 const ownerSeasonId=selectedSeasonId||season?.id||null;
 const toDate=(value:unknown)=>{
   if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return '';
   const date=new Date(value<1e11?value*1000:value);
   return Number.isNaN(date.getTime())?'':date.toISOString();
 };
 const ownedClubs:Club[]=[];
 const seen=new Set<string>();
 for(const value of verifiedRows){
   if(!value||typeof value!=='object')throw Error('SERVERLESS_OWNERSHIP_CONTRACT_MISMATCH');
   const row=value as Record<string,unknown>;
   if(typeof row.clubId!=='string'||!row.clubId||
      typeof row.leagueId!=='string'||!row.leagueId||
      typeof row.clubName!=='string'||!row.clubName||
      typeof row.seasonId!=='string'||!row.seasonId||
      typeof row.clubCountry!=='string'||typeof row.clubShortName!=='string')
     throw Error('SERVERLESS_OWNERSHIP_CONTRACT_MISMATCH');
   // No resolved season means ownership remains unavailable: never merge
   // clubs from different seasons into one displayed current club.
   if(!ownerSeasonId||row.seasonId!==ownerSeasonId)continue;
   const uniqueKey=row.seasonId+':'+row.clubId;
   if(seen.has(uniqueKey))throw Error('SERVERLESS_DUPLICATE_OWNERSHIP');
   seen.add(uniqueKey);
   ownedClubs.push({
     id:row.clubId,name:row.clubName,leagueId:row.leagueId,
     shortName:row.clubShortName,country:row.clubCountry,
     leagueName:typeof row.leagueName==='string'?row.leagueName:undefined,
     logoUrl:typeof row.clubLogoUrl==='string'?row.clubLogoUrl:'',
     stadium:typeof row.clubStadium==='string'?row.clubStadium:undefined,
     active:true,isTaken:true,isCurrentUserClub:true,
     claimedByUserId:user.id,
     createdAt:toDate(row.clubCreatedAt),
   });
 }
 return {user,season,ownedClubs,currentClub:ownedClubs[0]||null,
   currentClubStatus:ownedClubs.length?'resolved':'unavailable'};
}
export async function loadNativeEflBootstrap(selectedSeasonId?:string):Promise<NativeEflSession>{
 const result=await callEflTransport<unknown>({
   operation:'bootstrap',preferred:'telegram-serverless',
   vercel:()=>Promise.reject(new Error('SERVERLESS_VERCEL_FALLBACK_FORBIDDEN')),
 });
 return decodeNativeEflBootstrap(result,selectedSeasonId);
}
