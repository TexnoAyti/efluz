-- Follow-up reverse ownership audit. Preserve all current club owners.
do $$
declare
  generation text;
  operations jsonb := '[]';
  r record;
  original jsonb;
  membership jsonb;
  occupancy jsonb;
  club_membership jsonb;
  repaired_at text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select s.generation::text into generation from efl_runtime.spaces s
    where name='production' and mode='active' for update;
  if generation is null then raise exception 'PRODUCTION_NOT_ACTIVE'; end if;
  for r in select * from (values
    ('season-2026-27','user-5244022908','club-fulham','user-5505701796','2026-09-11T18:37:41.465Z',false),
    ('season-2026-27','user-5598192866','club-bournemouth','user-1683208173','2026-09-16T10:01:56.616Z',false),
    ('season-2026-27','user-5779196113','club-chelsea','user-5606917523','2026-09-29T11:07:33.832Z',false),
    ('season-2026-27','user-7573478198','club-crystal-palace','user-8574301555','2026-10-05T11:59:23.940Z',false),
    ('season-2026-27','user-cup-away','club-man-utd','user-2062473991','2026-09-05T15:59:57.152Z',true),
    ('season-2027-28','user-test-2','club-arsenal',null,'2026-09-17T15:33:22.384Z',true)
  ) v(season,owner,club,current_owner,evidence_at,synthetic) loop
    select encoded,data into original,membership from efl_runtime.documents
      where space='production' and collection_path='user_memberships' and document_id=r.season||'_'||r.owner;
    select data into occupancy from efl_runtime.documents
      where space='production' and collection_path='club_occupancies' and document_id=r.season||'_'||r.club;
    select data into club_membership from efl_runtime.documents
      where space='production' and collection_path='club_memberships' and document_id=r.season||'_'||r.club;
    if membership is null or membership->>'status' is distinct from 'active'
      or membership->>'userId' is distinct from r.owner or membership->>'clubId' is distinct from r.club
      or membership->>'seasonId' is distinct from r.season or membership->>'secondaryClubId' is not null
      or membership->>'claimedAt' is null or membership->>'claimedAt' >= r.evidence_at
      or occupancy is null or club_membership is null
      or occupancy->>'userId' is distinct from r.current_owner
      or occupancy->>'updatedAt' is distinct from r.evidence_at
      or occupancy->>'status' is distinct from (case when r.current_owner is null then 'released' else 'active' end)
      or club_membership->>'status' is distinct from occupancy->>'status'
      or (r.current_owner is not null and club_membership->>'userId' is distinct from r.current_owner)
      or exists(select 1 from efl_runtime.documents o where o.space='production'
        and o.collection_path='club_occupancies' and o.data->>'seasonId'=r.season
        and o.data->>'status'='active' and o.data->>'userId'=r.owner) then
      raise exception 'STALE_USER_EVIDENCE_CHANGED: %',r.owner;
    end if;
    if r.synthetic and exists(select 1 from efl_runtime.documents u where u.space='production'
      and u.collection_path='users' and u.document_id=r.owner) then
      raise exception 'SYNTHETIC_USER_NOW_EXISTS';
    end if;
    if r.current_owner is not null and not exists(select 1 from efl_runtime.documents u
      where u.space='production' and u.collection_path='user_memberships'
        and u.document_id=r.season||'_'||r.current_owner and u.data->>'status'='active'
        and (u.data->>'clubId'=r.club or u.data->>'secondaryClubId'=r.club)) then
      raise exception 'CURRENT_OWNER_LINK_CHANGED';
    end if;
    operations := operations || jsonb_build_array(jsonb_build_object(
      'kind','create','path','legacy_recovery_archive/2026-10-10_user_memberships_'||r.season||'_'||r.owner,
      'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
        'sourcePath',jsonb_build_object('type','string','value','user_memberships/'||r.season||'_'||r.owner),
        'original',original,
        'reason',jsonb_build_object('type','string','value',case when r.synthetic then 'Orphan synthetic membership; no user, newer canonical ownership' else 'Stale user membership superseded by newer matching canonical ownership' end),
        'repairedAt',jsonb_build_object('type','string','value',repaired_at)))));
    if r.synthetic then
      operations := operations || jsonb_build_array(jsonb_build_object('kind','delete','path','user_memberships/'||r.season||'_'||r.owner));
    else
      operations := operations || jsonb_build_array(jsonb_build_object(
        'kind','update','path','user_memberships/'||r.season||'_'||r.owner,
        'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
          'status',jsonb_build_object('type','string','value','released'),
          'supersededAt',jsonb_build_object('type','string','value',r.evidence_at),
          'supersededByUserId',jsonb_build_object('type','string','value',r.current_owner),
          'updatedAt',jsonb_build_object('type','string','value',repaired_at),
          'repairedAt',jsonb_build_object('type','string','value',repaired_at)))));
    end if;
  end loop;
  perform public.efl_runtime_commit('production',operations,generation);
end $$;
