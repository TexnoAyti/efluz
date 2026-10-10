import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { encodeValue } from '../migration/firestoreArchive';

const sql = await readFile('scripts/sql/repair-2026-10-10-legacy-memberships.sql', 'utf8');
const pg = new PGlite();
try {
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await pg.exec(await readFile('supabase/migrations/20261009044907_postgres_document_runtime.sql', 'utf8'));
  await pg.exec("update efl_runtime.spaces set mode='active' where name='production'");
  const source = new Map<string, any>();
  const put = async (path: string, data: any) => {
    source.set(path, encodeValue(data));
    await pg.query('select public.efl_runtime_commit($1,$2::jsonb)', ['production', JSON.stringify([
      { kind: 'set', path, encoded: encodeValue(data) },
    ])]);
  };
  for (const [season, club, user, date, replacement] of [
    ['season-2026-27','club-monaco','user-6653642796','2026-09-26T10:22:11.363Z',null],
    ['season-2026-27','club-toulouse','user-8597594534','2026-10-03T14:59:48.820Z','club-alaves'],
    ['season-2027-28','club-arsenal','user-100002','2026-09-17T15:33:22.384Z',null],
  ]) {
    const id = `${season}_${club}`;
    await put('club_memberships/'+id, { seasonId:season, clubId:club, userId:user, status:'active', updatedAt:'2026-09-01T00:00:00Z', extra:{preserve:true} });
    await put('club_occupancies/'+id, { status:'released',updatedAt:date });
    await put(`user_memberships/${season}_${user}`, {status:replacement?'active':'released',clubId:replacement||club,releasedAt:date,claimedAt:date});
    if(replacement) for(const collection of ['club_memberships','club_occupancies'])
      await put(`${collection}/${season}_${replacement}`, {status:'active',userId:user});
  }
  await put('club_memberships/season-2026-27_club-arsenal', {status:'active',userId:'current-owner'});
  for(const [user,homeScore,awayScore,createdAt] of [
    ['user-10101',3,1,'2026-09-07T12:56:47.132Z'],['user-10102',1,2,'2026-09-07T12:56:49.516Z'],
  ]) await put(`result_submissions/sub-fix-test-arsenal-chelsea-${user}`, {fixtureId:'fix-test-arsenal-chelsea',submittedByUserId:user,homeScore,awayScore,createdAt});
  const snapshot=async():Promise<any[]>=> (await pg.query('select * from efl_runtime.documents order by collection_path,document_id')).rows;
  const before=await snapshot();
  const generation=async()=> (await pg.query("select generation from efl_runtime.spaces where name='production'")).rows;
  // A fixture appearing after planning must abort, leaving all five sources intact.
  await put('fixtures/fix-test-arsenal-chelsea', {id:'fix-test-arsenal-chelsea'});
  const changed=await snapshot(), changedGeneration=await generation();
  await assert.rejects(pg.exec(sql), /TEST_FIXTURE_NOW_EXISTS/);
  assert.deepEqual(await snapshot(),changed); assert.deepEqual(await generation(),changedGeneration);
  await pg.exec("delete from efl_runtime.documents where collection_path='fixtures'");
  await pg.exec(sql);
  const rows:any[] = await snapshot();
  const archives=rows.filter(r=>r.collection_path==='legacy_recovery_archive');
  assert.equal(archives.length,5);
  for(const archive of archives) assert.deepEqual(archive.encoded.value.original,source.get(archive.data.sourcePath));
  assert.equal(rows.filter(r=>r.collection_path==='result_submissions').length,0);
  assert.equal(rows.filter(r=>r.collection_path==='club_memberships' && r.data.status==='released').length,3);
  assert.deepEqual(rows.find(r=>r.collection_path==='club_memberships' && r.document_id==='season-2026-27_club-arsenal')?.encoded,
    before.find((r:any)=>r.collection_path==='club_memberships' && r.document_id==='season-2026-27_club-arsenal')?.encoded);
  for(const row of rows.filter(r=>r.collection_path==='club_memberships' && r.data.status==='released')) assert.deepEqual(row.data.extra,{preserve:true});
  const afterGeneration=await generation();
  await assert.rejects(pg.exec(sql), /MEMBERSHIP_EVIDENCE_CHANGED/);
  assert.deepEqual(await snapshot(),rows); assert.deepEqual(await generation(),afterGeneration);
  console.log('PASS native PostgreSQL legacy repair: five exact archives, three releases, two quarantined results, current Arsenal preserved, changed evidence and repeat execution abort atomically');
} finally { await pg.close(); }
