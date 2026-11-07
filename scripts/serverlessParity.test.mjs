import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const verifier=new URL('./verifyServerlessSnapshot.mjs',import.meta.url).pathname;
const empty=Object.fromEntries(['users','seasons','leagues','clubs','clubOccupancies','fixtures','matchAccess','matchMessages','competitions','participants','resultSubmissions','disputes','notifications','auditLogs','rawDocuments','rawDocumentParts','uzeflifeState','uzeflifeEntrants','uzeflifeFixtures','teamsCatalog','teamMembers'].map(k=>[k,[]]));
test('identical full snapshots pass, changed or missing rows fail closed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-parity-'));
  try {
    const a=join(dir,'source.json'),b=join(dir,'target.json');
    await writeFile(a,JSON.stringify(empty));await writeFile(b,JSON.stringify(empty));
    let r=spawnSync(process.execPath,[verifier,a,b],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/PARITY_OK/);
    await writeFile(b,JSON.stringify({...empty,users:[{
      id:'u1',telegram_id:'123',username:null,first_name:'A',last_name:'',
      is_admin:false,is_banned:false,created_at:1,updated_at:1
    }]}));
    r=spawnSync(process.execPath,[verifier,a,b],{encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/PARITY_FAILED/);
    await writeFile(b,JSON.stringify({users:[]}));
    r=spawnSync(process.execPath,[verifier,a,b],{encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/MISSING_TABLE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
