// Pure, bounded and allowlisted target readback for a staging-only migration.
// Exports only explicitly whitelisted columns. No arbitrary SQL/table names,
// client-supplied user identity, offset scan or database writes.
import {IMPORT_TABLES,SQL_TABLES,PRIMARY_KEYS} from './importBatch.js';

const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
export function validateMigrationReadback(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(key=>!['table','cursor','limit'].includes(key)))
    throw Error('INVALID_READBACK_REQUEST');
  const {table}=input;
  if(typeof table!=='string'||!has(IMPORT_TABLES,table)||
     !has(SQL_TABLES,table)||!has(PRIMARY_KEYS,table))
    throw Error('INVALID_READBACK_TABLE');
  const limit=input.limit??20,cursor=input.cursor??null;
  if(!Number.isSafeInteger(limit)||limit<1||limit>20)
    throw Error('INVALID_READBACK_LIMIT');
  const numeric=table==='matchMessages';
  if(cursor!==null&&(numeric?
    !Number.isSafeInteger(cursor)||cursor<1:
    typeof cursor!=='string'||!/^[A-Za-z0-9_:-]{1,160}$/.test(cursor)))
    throw Error('INVALID_READBACK_CURSOR');
  return {table,limit,cursor};
}
export async function readMigrationPage(db,input={}){
  const {table,limit,cursor}=validateMigrationReadback(input);
  if(!db||typeof db.all!=='function')throw Error('READBACK_DATABASE_REQUIRED');
  const columns=IMPORT_TABLES[table],pk=PRIMARY_KEYS[table];
  const physicalTable=SQL_TABLES[table];
  const columnSql=columns.map(c=>'"'+c+'"').join(',');
  const query=`SELECT ${columnSql} FROM ${physicalTable}
    ${cursor===null?'':'WHERE "'+pk+'" > :cursor'}
    ORDER BY "${pk}" ASC LIMIT :limit`;
  const rows=await db.all(query,cursor===null?
    {':limit':limit+1}:{':cursor':cursor,':limit':limit+1});
  if(!Array.isArray(rows)||rows.length>limit+1)
    throw Error('READBACK_UNBOUNDED_RESULT');
  const numeric=table==='matchMessages';
  let previous=cursor;
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       columns.some(c=>!has(row,c))||
       Object.keys(row).some(c=>!columns.includes(c)))
      throw Error('READBACK_ROW_CONTRACT_INVALID');
    const value=row[pk];
    if(numeric? !Number.isSafeInteger(value)||value<1:
      typeof value!=='string'||!/^[A-Za-z0-9_:-]{1,160}$/.test(value))
      throw Error('READBACK_PRIMARY_KEY_INVALID');
    if(previous!==null&&
       (numeric? value<=previous: String(value)<=String(previous)))
      throw Error('READBACK_ORDER_INVALID');
    previous=value;
  }
  const hasMore=rows.length>limit;
  const page=rows.slice(0,limit);
  // Bound serialized output as well as row count. Oversized historic records
  // should be inspected offline, never returned through an unbounded RPC.
  const payloadBytes=new TextEncoder().encode(JSON.stringify(page)).length;
  if(payloadBytes>65536)throw Error('READBACK_PAGE_TOO_LARGE');
  return {ok:true,table,columns,rows:page,nextCursor:hasMore?page.at(-1)[pk]:null,
    hasMore,source:'telegram-serverless-staging',cutoverReady:false};
}
