import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const root=new URL('../tgcloud/endpoints/',import.meta.url);
const expectedGated=new Map([
 ['claimClub.js','MUTATION_CONTROL.enabled'],
 ['proposeResult.js','MUTATION_CONTROL.enabled'],
 ['confirmResult.js','MUTATION_CONTROL.enabled'],
 ['matchChat.js','MUTATION_CONTROL.enabled'],
 ['markNotificationRead.js','MUTATION_CONTROL.enabled'],
 ['importBatch.js','IMPORT_CONTROL.enabled']
]);
test('all staging mutation endpoints remain fail-closed before production parity',async()=>{
 const entries=await readdir(root);
 for(const [file,gate] of expectedGated){
  assert.ok(entries.includes(file),file+' missing');
  const source=await readFile(new URL(file,root),'utf8');
  assert.ok(source.includes(gate),file+' must enforce explicit mutation gate');
  assert.ok(source.includes('SHADOW_WRITE_DISABLED')||
            (file==='importBatch.js'&&source.includes('IMPORT_DISABLED')),
    file+' must return a clear disabled status');
 }
 for(const file of entries.filter(name=>name.endsWith('.js'))){
  const source=await readFile(new URL(file,root),'utf8');
  if(/\bdb\.run\s*\(/.test(source)||/\b(?:applyImportBatch|claimClub|proposeFixtureResult|confirmFixtureResult|runMatchChat)\s*\(/.test(source))
    assert.ok(expectedGated.has(file),'UNREVIEWED_STAGING_MUTATION:'+file);
 }
});
