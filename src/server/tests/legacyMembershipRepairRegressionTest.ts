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
  const staleSql=await readFile('scripts/sql/repair-2026-10-10-stale-user-memberships.sql','utf8');
  for(const [season,user,club,owner,date] of [
    ['season-2026-27','user-5244022908','club-fulham','user-5505701796','2026-09-11T18:37:41.465Z'],
    ['season-2026-27','user-5598192866','club-bournemouth','user-1683208173','2026-09-16T10:01:56.616Z'],
    ['season-2026-27','user-5779196113','club-chelsea','user-5606917523','2026-09-29T11:07:33.832Z'],
    ['season-2026-27','user-7573478198','club-crystal-palace','user-8574301555','2026-10-05T11:59:23.940Z'],
    ['season-2026-27','user-cup-away','club-man-utd','user-2062473991','2026-09-05T15:59:57.152Z'],
    ['season-2027-28','user-test-2','club-arsenal',null,'2026-09-17T15:33:22.384Z'],
  ]) {
    await put(`user_memberships/${season}_${user}`,{seasonId:season,userId:user,clubId:club,status:'active',claimedAt:'2026-08-01T00:00:00Z'});
    for(const collection of ['club_occupancies','club_memberships']) await put(`${collection}/${season}_${club}`,{status:owner?'active':'released',userId:owner,updatedAt:date});
    if(owner) await put(`user_memberships/${season}_${owner}`,{status:'active',clubId:club});
  }
  // Missing users may be quarantined only while they remain demonstrably synthetic.
  await put('users/user-cup-away',{id:'user-cup-away'});
  const beforeStale=await snapshot(), beforeStaleGeneration=await generation();
  await assert.rejects(pg.exec(staleSql),/SYNTHETIC_USER_NOW_EXISTS/);
  assert.deepEqual(await snapshot(),beforeStale); assert.deepEqual(await generation(),beforeStaleGeneration);
  await pg.exec("delete from efl_runtime.documents where collection_path='users' and document_id='user-cup-away'");
  await pg.exec(staleSql);
  const staleRows:any[]=await snapshot();
  const staleArchives=staleRows.filter(r=>r.collection_path==='legacy_recovery_archive' && r.data.sourcePath.startsWith('user_memberships/'));
  assert.equal(staleArchives.length,6);
  for(const archive of staleArchives) assert.deepEqual(archive.encoded.value.original,source.get(archive.data.sourcePath));
  assert.equal(staleRows.filter(r=>r.collection_path==='user_memberships' && r.data.supersededAt).length,4);
  assert.equal(staleRows.some(r=>r.collection_path==='user_memberships' && ['user-cup-away','user-test-2'].includes(r.data.userId)),false);
  for(const row of staleRows.filter(r=>['club_memberships','club_occupancies'].includes(r.collection_path))) assert.deepEqual(row.encoded,beforeStale.find(r=>r.collection_path===row.collection_path && r.document_id===row.document_id)?.encoded);
  await assert.rejects(pg.exec(staleSql),/STALE_USER_EVIDENCE_CHANGED/);
  assert.deepEqual(await snapshot(),staleRows);
  console.log('PASS native PostgreSQL reverse audit repair: six exact archives, four superseded user links, two synthetic links quarantined, current ownership preserved, changed evidence and repeats abort');
} finally { await pg.close(); }
