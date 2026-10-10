-- Evidence-backed, recoverable production repair. Never infer a new owner.
-- Run once: namespace lock, evidence checks, archive + changes in one RPC/transaction.
do $$
declare
  generation text;
  operations jsonb := '[]';
  r record;
  source_encoded jsonb;
  occupancy jsonb;
  membership jsonb;
  repaired_at text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  reason text;
begin
  select s.generation::text into generation from efl_runtime.spaces s
    where name='production' and mode='active' for update;
  if generation is null then raise exception 'PRODUCTION_NOT_ACTIVE'; end if;

  for r in select * from (values
    ('season-2026-27_club-monaco','user-6653642796','2026-09-26T10:22:11.363Z',null::text),
    ('season-2026-27_club-toulouse','user-8597594534','2026-10-03T14:59:48.820Z','club-alaves'),
    ('season-2027-28_club-arsenal','user-100002','2026-09-17T15:33:22.384Z',null::text)
  ) v(id,owner,released_at,replacement_club) loop
    select encoded,data into source_encoded,membership from efl_runtime.documents
      where space='production' and collection_path='club_memberships' and document_id=r.id;
    select data into occupancy from efl_runtime.documents
      where space='production' and collection_path='club_occupancies' and document_id=r.id;
    if membership is null or occupancy is null or membership->>'status' is distinct from 'active'
      or membership->>'userId' is distinct from r.owner or occupancy->>'status' is distinct from 'released'
      or occupancy->>'updatedAt' is distinct from r.released_at
      or (membership->>'updatedAt') >= r.released_at then
      raise exception 'MEMBERSHIP_EVIDENCE_CHANGED: %',r.id;
    end if;
    if not exists(select 1 from efl_runtime.documents u where u.space='production'
      and u.collection_path='user_memberships'
      and u.document_id=(membership->>'seasonId')||'_'||r.owner
      and ((r.replacement_club is null and u.data->>'status'='released'
            and u.data->>'clubId'=membership->>'clubId' and u.data->>'releasedAt'=r.released_at)
        or (r.replacement_club is not null and u.data->>'status'='active'
            and u.data->>'clubId'=r.replacement_club and u.data->>'claimedAt'=r.released_at))) then
      raise exception 'USER_MEMBERSHIP_EVIDENCE_CHANGED: %',r.id;
    end if;
    if r.replacement_club is not null and not exists(
      select 1 from efl_runtime.documents c join efl_runtime.documents o
        on o.space=c.space and o.document_id=c.document_id and o.collection_path='club_occupancies'
      where c.space='production' and c.collection_path='club_memberships'
        and c.document_id=(membership->>'seasonId')||'_'||r.replacement_club
        and c.data->>'userId'=r.owner and o.data->>'userId'=r.owner
        and c.data->>'status'='active' and o.data->>'status'='active') then
      raise exception 'REPLACEMENT_OWNERSHIP_CHANGED';
    end if;
    reason := case when r.replacement_club is null then 'Recorded release in occupancy and user membership'
      else 'Recorded transfer to Alaves; old occupancy released' end;
    operations := operations || jsonb_build_array(
      jsonb_build_object('kind','create','path','legacy_recovery_archive/2026-10-10_club_memberships_'||r.id,
        'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
          'sourcePath',jsonb_build_object('type','string','value','club_memberships/'||r.id),
          'original',source_encoded,
          'reason',jsonb_build_object('type','string','value',reason),
          'repairedAt',jsonb_build_object('type','string','value',repaired_at)))),
      jsonb_build_object('kind','update','path','club_memberships/'||r.id,
        'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
          'status',jsonb_build_object('type','string','value','released'),
          'releasedAt',jsonb_build_object('type','string','value',r.released_at),
          'updatedAt',jsonb_build_object('type','string','value',r.released_at),
          'repairedAt',jsonb_build_object('type','string','value',repaired_at)))));
  end loop;

  if exists(select 1 from efl_runtime.documents where space='production'
    and collection_path='fixtures' and document_id='fix-test-arsenal-chelsea') then
    raise exception 'TEST_FIXTURE_NOW_EXISTS';
  end if;
  for r in select * from (values
    ('sub-fix-test-arsenal-chelsea-user-10101','user-10101',3,1,'2026-09-07T12:56:47.132Z'),
    ('sub-fix-test-arsenal-chelsea-user-10102','user-10102',1,2,'2026-09-07T12:56:49.516Z')
  ) v(id,owner,home_score,away_score,created_at) loop
    select encoded,data into source_encoded,membership from efl_runtime.documents
      where space='production' and collection_path='result_submissions' and document_id=r.id;
    if membership is null or membership->>'fixtureId' is distinct from 'fix-test-arsenal-chelsea'
      or membership->>'submittedByUserId' is distinct from r.owner
      or membership->>'createdAt' is distinct from r.created_at
      or (membership->>'homeScore')::int is distinct from r.home_score
      or (membership->>'awayScore')::int is distinct from r.away_score then
      raise exception 'TEST_SUBMISSION_EVIDENCE_CHANGED: %',r.id;
    end if;
    operations := operations || jsonb_build_array(
      jsonb_build_object('kind','create','path','legacy_recovery_archive/2026-10-10_result_submissions_'||r.id,
        'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
          'sourcePath',jsonb_build_object('type','string','value','result_submissions/'||r.id),
          'original',source_encoded,
          'reason',jsonb_build_object('type','string','value','Orphan synthetic result from adversarialTestSuite; fixture absent'),
          'repairedAt',jsonb_build_object('type','string','value',repaired_at)))),
      jsonb_build_object('kind','delete','path','result_submissions/'||r.id));
  end loop;
  perform public.efl_runtime_commit('production',operations,generation);
end $$;
