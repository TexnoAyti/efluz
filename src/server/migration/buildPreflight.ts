import fs from 'node:fs';
import { createExportSource } from './serverExport';
import { resolveRedisConfig } from '../readModel/redisConfig';

/** Run only inside a temporary Vercel preview build; never expose a handler. */
let phase='START';
const timeout=setTimeout(()=>{console.error('MIGRATION_PREFLIGHT_TIMEOUT '+phase);process.exit(1);},60000);
async function main() {
 if(process.env.VERCEL_ENV!=='preview') throw new Error('PREVIEW_BUILD_REQUIRED');
 process.env.FIREBASE_PROJECT_ID='gen-lang-client-0195097895';
 process.env.FIRESTORE_DATABASE_ID='ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';
 phase='SOURCE_INIT';console.log('MIGRATION_PREFLIGHT_PHASE '+phase);
 const {db,source}=await createExportSource();
 if(source.projectId!=='gen-lang-client-0195097895'||source.databaseId!=='ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d') throw new Error('SOURCE_MISMATCH');
 phase='SOURCE_ROOTS';console.log('MIGRATION_PREFLIGHT_PHASE '+phase);
 const roots=await db.listCollections();
 phase='SOURCE_COUNTS';console.log('MIGRATION_PREFLIGHT_PHASE '+phase);
 const counts:any={};
 for(const name of ['users','clubs','fixtures']) counts[name]=(await db.collection(name).count().get()).data().count;
 phase='REDIS_READ';console.log('MIGRATION_PREFLIGHT_PHASE '+phase);
 const redis=resolveRedisConfig(process.env);
 let redisStatus='MISSING';
 if(redis){
  const response=await fetch(redis.url+'/pipeline',{method:'POST',headers:{Authorization:'Bearer '+redis.token,'Content-Type':'application/json'},body:JSON.stringify([['PING'],['ZCARD','efluz:v1:outbox:pending'],['GET','efluz:v1:telegram:ai_config'],['HLEN','efluz:v1:notification-visibility'],['LLEN','efluz:v1:telegram:queue']]),signal:AbortSignal.timeout(15000)});
  const results=await response.json() as any[];
  if(!response.ok||!Array.isArray(results)||results.some(r=>r.error)) redisStatus=JSON.stringify(results).toLowerCase().includes('quota')||JSON.stringify(results).toLowerCase().includes('limit')?'QUOTA_BLOCKED':'UNAVAILABLE';
  else redisStatus='READY';
 }
 const summary={source,rootCollections:roots.length,counts,redisStatus,readyForFreeze:redisStatus==='READY'};
 console.log('MIGRATION_PREFLIGHT '+JSON.stringify(summary));
 clearTimeout(timeout);fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/index.html','Migration preflight complete. No application data is served here.');
}
main().catch((error:any)=>{const code=['SOURCE_CONFIG_REQUIRED','SOURCE_PROJECT_MISMATCH','SOURCE_MISMATCH','REAL_SOURCE_REQUIRED'].includes(error?.message)?error.message:typeof error?.code==='number'?'SOURCE_SDK_'+error.code:'PREFLIGHT_UNAVAILABLE';console.error('MIGRATION_PREFLIGHT_FAILED '+phase+' '+code+'. No source writes performed.');process.exit(1);});
