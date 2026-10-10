import { randomBytes } from 'node:crypto';
import { getRuntimeStateStore } from '../readModel/runtimeStateStore';
export const IMAGE_EXPORT_TTL_SECONDS = 300;
export interface StoredImageExport { pngBase64: string; filename: string; expiresAt: number }
export interface ImageExportStorage { set(key:string,value:StoredImageExport,ttl:number):Promise<void>; get(key:string):Promise<StoredImageExport|null> }
const localExports = new Map<string, StoredImageExport>();
const keyFor=(token:string)=>`efluz:image-export:${token}`;
const defaultStorage:ImageExportStorage={
  async set(key,value,ttl){const client=getRuntimeStateStore();if(client){await client.set(key,value,{ex:ttl});return;}if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw new Error('IMAGE_EXPORT_STORAGE_UNAVAILABLE');localExports.set(key,value);},
  async get(key){const client=getRuntimeStateStore();if(client)return await client.get<StoredImageExport>(key);if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw new Error('IMAGE_EXPORT_STORAGE_UNAVAILABLE');const entry=localExports.get(key);if(entry&&entry.expiresAt<=Date.now()){localExports.delete(key);return null;}return entry||null;},
};
export function validateImageExport(pngBase64:unknown, filename:unknown) {
  if(typeof filename!=='string'||filename.length>180||!/^efluz-[a-zA-Z0-9_-]+\.png$/.test(filename))throw new Error('INVALID_IMAGE_FILENAME');
  if(typeof pngBase64!=='string'||pngBase64.length>700000||(pngBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(pngBase64)))throw new Error('INVALID_PNG_DATA');
  const png=Buffer.from(pngBase64,'base64');
  if(png.toString('base64')!==pngBase64)throw new Error('INVALID_PNG_DATA');
  if(png.length<45||png.length>500000||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.subarray(12,16).toString()!=='IHDR')throw new Error('INVALID_PNG_DATA');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  if(width!==1080||height<100||height>6000||png.subarray(png.length-8,png.length-4).toString()!=='IEND')throw new Error('INVALID_PNG_DIMENSIONS');
  return {pngBase64,filename};
}
export function createTournamentImageDownloadService(storage:ImageExportStorage=defaultStorage, now=()=>Date.now()){
  return {
    async create(pngBase64:unknown,filename:unknown){
      const validated=validateImageExport(pngBase64,filename);const token=randomBytes(24).toString('hex');
      const expiresAt=now()+IMAGE_EXPORT_TTL_SECONDS*1000;
      await storage.set(keyFor(token),{...validated,expiresAt},IMAGE_EXPORT_TTL_SECONDS);
      return {downloadPath:`/api/image-exports/${token}.png`,expiresAt};
    },
    async get(token:string){
      if(!/^[a-f0-9]{48}$/.test(token))return null;
      const record=await storage.get(keyFor(token));if(!record||record.expiresAt<=now())return null;
      validateImageExport(record.pngBase64,record.filename);
      return {png:Buffer.from(record.pngBase64,'base64'),filename:record.filename};
    },
  };
}
