import {db,EndpointError} from 'sdk';
import {assertMigrationOwner} from './importBatch.js';
import {SQL_TABLES} from '../lib/importBatch.js';

// Staging-only inspection. Locked behind the same disabled-by-default owner gate.
export default async function(_input,ctx) {
  assertMigrationOwner(ctx);
  const tables={};
  for(const [logical,table] of Object.entries(SQL_TABLES)){
    const row=await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
    tables[logical]={count:Number(row?.count||0)};
  }
  const batches=await db.all(`SELECT key,status,cursor,updated_at AS updatedAt
    FROM efl_migration_state WHERE key LIKE 'import:%'
    ORDER BY key ASC LIMIT 500`);
  return {ok:true,tables,batches,source:'telegram-serverless'};
}
