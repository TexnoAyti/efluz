import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {encodeValue} from '../migration/firestoreArchive';
export async function verifyCompactNotificationMigration(pg: PGlite, path: string) {
  // Strip the migration transaction wrapper so the audit itself rolls back.
  const sql=(await readFile(path,'utf8')).replace(/^begin;\n/,'').replace(/commit;\s*$/,'');
  await pg.exec('begin');
  try {
    const payloads:any[]=[{sent:{id:'sent',status:'sent'},unknown:{status:'uncertain'}},[{jobId:'pending',attempts:2}],{inflight:{jobId:'working',claimedAt:123}}];
    const ids=['broadcasts','queue','processing'].map(key=>createHash('sha256').update('efluz:v1:telegram:'+key).digest('hex'));
    for(let i=0;i<ids.length;i++) {
      const entry={value:payloads[i],expiresAt:i===0?null:1799999999999};
      await pg.query(`insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values('preview','telegram_ai_state',$1,$2::jsonb,$3::jsonb)`,[ids[i],JSON.stringify(encodeValue(entry)),JSON.stringify(entry)]);
    }
    const generation=async()=>String((await pg.query<{generation:string}>(`select generation::text from efl_runtime.spaces where name='preview'`)).rows[0].generation);
    const before=await generation();
    await pg.exec(sql);
    assert.equal(await generation(),String(BigInt(before)+1n));
    for(let i=0;i<ids.length;i++) {
      const row=(await pg.query<{encoded:any;data:any;consistent:boolean}>(`select encoded,data,data=efl_runtime.decode(encoded) as consistent from efl_runtime.documents where space='preview' and collection_path='telegram_ai_state' and document_id=$1`,[ids[i]])).rows[0];
      assert.equal(row.consistent,true);
      assert.equal(row.encoded.value.value.type,'string');
      assert.deepEqual(JSON.parse(row.data.value),payloads[i]);
      assert.equal(row.data.expiresAt,i===0?null:1799999999999);
    }
    await pg.exec(sql);
    assert.equal(await generation(),String(BigInt(before)+1n),'Repeated compaction is a no-op');
    console.log('Compact notification migration audit passed: receipts/jobs/TTLs preserved, generation invalidation, idempotence.');
  } finally {await pg.exec('rollback');}
}
