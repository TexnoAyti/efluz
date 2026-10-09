import fs from 'node:fs';
import { resolveRedisConfig } from '../readModel/redisConfig';
async function main(){
 if(process.env.VERCEL_ENV!=='preview')throw new Error('PREVIEW_BUILD_REQUIRED');
 const config=resolveRedisConfig(process.env);if(!config)throw new Error('REDIS_CONFIG_REQUIRED');
 const response=await fetch(config.url+'/pipeline',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify([['PING'],['ZCARD','efluz:v1:outbox:pending'],['GET','efluz:v1:telegram:ai_config'],['HLEN','efluz:v1:notification-visibility'],['LLEN','efluz:v1:telegram:queue']]),signal:AbortSignal.timeout(15000)});
 const results=await response.json() as any[];
 const available=response.ok&&Array.isArray(results)&&results.length===5&&results.every(r=>!r.error);
 const summary={available,status:available?'READY':JSON.stringify(results).toLowerCase().match(/quota|limit|exceeded/)?'QUOTA_BLOCKED':'UNAVAILABLE',pendingMutations:available?Number(results[1].result):null,aiConfigPresent:available?results[2].result!==null:null,visibilityEntries:available?Number(results[3].result):null,pendingNotifications:available?Number(results[4].result):null};
 console.log('MIGRATION_REDIS_PREFLIGHT '+JSON.stringify(summary));
 fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/index.html','Preflight complete. No application data is served here.');
}
main().catch(()=>{console.error('MIGRATION_REDIS_PREFLIGHT_UNAVAILABLE');process.exit(1);});
