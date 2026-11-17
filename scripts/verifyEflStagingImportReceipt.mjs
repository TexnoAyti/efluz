#!/usr/bin/env node
// Validate a single staging import response against its private source packet.
// Never print the CLI output or imported records.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export function parseImportReceipt(output) {
  if(typeof output!=='string'||output.length>3_000_000)
    throw Error('STAGING_IMPORT_OUTPUT_INVALID');
  const raw=output.trim();
  const options=[raw,...raw.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.startsWith('{')).reverse()];
  for(const candidate of options) {
    try {
      const obj=JSON.parse(candidate);
      const receipt=obj?.result??obj;
      if(receipt&&typeof receipt==='object'&&!Array.isArray(receipt)&&
         receipt.ok===true&&receipt.status==='COMPLETE'&&
         typeof receipt.table==='string'&&typeof receipt.batchId==='string')
        return receipt;
    } catch {}
  }
  throw Error('STAGING_IMPORT_RECEIPT_MISSING');
}
export function verifyImportReceipt(packet,receipt) {
  if(!packet||typeof packet!=='object'||Array.isArray(packet)||
     typeof packet.table!=='string'||typeof packet.batchId!=='string'||
     !Array.isArray(packet.rows)||packet.rows.length===0)
    throw Error('STAGING_IMPORT_PACKET_INVALID');
  if(!receipt||receipt.ok!==true||receipt.status!=='COMPLETE'||
     receipt.table!==packet.table||receipt.batchId!==packet.batchId||
     receipt.total!==packet.rows.length||
     receipt.verified!==packet.rows.length||
     !Number.isSafeInteger(receipt.previouslyPresent)||
     receipt.previouslyPresent<0||
     receipt.previouslyPresent>packet.rows.length)
    throw Error('STAGING_IMPORT_RECEIPT_MISMATCH');
  return {ok:true,table:packet.table,verified:receipt.verified};
}
async function main(){
  if(process.argv.length!==4)throw Error('STAGING_IMPORT_ARGUMENTS_INVALID');
  const [packetPath,outputPath]=process.argv.slice(2);
  const [packet,output]=await Promise.all([
    readFile(resolve(packetPath),'utf8').then(JSON.parse),
    readFile(resolve(outputPath),'utf8')
  ]);
  const result=verifyImportReceipt(packet,parseImportReceipt(output));
  // Counts only: no record values and no raw CLI output.
  console.log('STAGING_IMPORT_RECEIPT_OK:'+result.table+':'+result.verified);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(error=>{
    const code=String(error?.message||'');
    console.error(/^STAGING_IMPORT_/.test(code)?code:'STAGING_IMPORT_VERIFICATION_FAILED');
    process.exitCode=1;
  });
}
