import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app';
import { processPendingMutations } from '../sync/mutationQueue';
import { processNotificationQueue } from '../services/telegramNotificationQueue';

async function main(){
 process.env.MIGRATION_WRITE_FREEZE='true';
 const server=http.createServer(createApp());
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as any).port;
 try{
  for(const [method,pathname] of [['POST','/api/telegram/webhook'],['POST','/api/auth/telegram'],['POST','/api/fixtures/test/result'],['GET','/api/internal/telegram-worker'],['GET','/api/me']]){
   const response=await fetch(`http://127.0.0.1:${port}${pathname}`,{method});
   assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');assert.equal((await response.json()).code,'MAINTENANCE');
  }
  const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(health.status,200);
  await assert.rejects(processPendingMutations(),/MIGRATION_WRITES_FROZEN/);
  assert.deepEqual(await processNotificationQueue(),{processed:0,succeeded:0,failed:0,locked:true});
  console.log('PASS cutover freeze: auth, webhook, mutations, cron and background writes blocked; health available');
 }finally{delete process.env.MIGRATION_WRITE_FREEZE;await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
