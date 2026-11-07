import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const root=new URL('../tgcloud/endpoints/',import.meta.url);
const controlRoot=new URL('../tgcloud/lib/',import.meta.url);
const expectedGated=new Map([
 ['claimClub.js','MUTATION_CONTROL.enabled'],
 ['proposeResult.js','MUTATION_CONTROL.enabled'],
 ['confirmResult.js','MUTATION_CONTROL.enabled'],
 ['finalizeUzeflifeResult.js','MUTATION_CONTROL.enabled'],
 ['requestTeamJoin.js','MUTATION_CONTROL.enabled'],
 ['approveTeamJoin.js','MUTATION_CONTROL.enabled'],
 ['matchChat.js','MUTATION_CONTROL.enabled'],
 ['markNotificationRead.js','MUTATION_CONTROL.enabled'],
 ['advanceCupRound.js','MUTATION_CONTROL.enabled'],
 ['setLateScoreWindow.js','MUTATION_CONTROL.enabled'],
 ['queueNotificationDelivery.js','MUTATION_CONTROL.enabled'],
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

test('staging deployment defaults forbid mutations and import even if routes are called',async()=>{
 const mutation=await readFile(new URL('mutationControl.js',controlRoot),'utf8');
 const migration=await readFile(new URL('importControl.js',controlRoot),'utf8');
 assert.match(mutation,/enabled\s*:\s*false/);
 assert.match(migration,/enabled\s*:\s*false/);
 assert.match(migration,/ownerTelegramId\s*:\s*['"]['"]/);
 assert.doesNotMatch(mutation,/enabled\s*:\s*true/);
 assert.doesNotMatch(migration,/enabled\s*:\s*true/);
});
