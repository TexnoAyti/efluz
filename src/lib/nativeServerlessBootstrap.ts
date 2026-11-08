// Telegram Serverless identity bootstrap. The platform provides signed
// caller identity to the backend. Never accept identity from URL or initDataUnsafe.
import type {User,Club,Season} from '../types';
import {callEflTransport} from './serverlessTransport';

export type NativeEflSession = {
 user:User|null;
 season:Season|null;
 ownedClubs:Club[];
 currentClub:Club|null;
 currentClubStatus:'unavailable';
};
export function decodeNativeEflBootstrap(value:unknown):NativeEflSession {
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
 // Ownerships are not yet normalized to the React Club contract.
 // Do not infer a club or role from unverified incomplete staging rows.
 return {user,season,ownedClubs:[],currentClub:null,currentClubStatus:'unavailable'};
}
export async function loadNativeEflBootstrap():Promise<NativeEflSession>{
 const result=await callEflTransport<unknown>({
   operation:'bootstrap',preferred:'telegram-serverless',
   vercel:()=>Promise.reject(new Error('SERVERLESS_VERCEL_FALLBACK_FORBIDDEN')),
 });
 return decodeNativeEflBootstrap(result);
}
