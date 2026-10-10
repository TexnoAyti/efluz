with docs as (select * from efl_runtime.documents where space='production'),
memberships as (select * from docs where collection_path='club_memberships' and data->>'status'='active'),
occupancies as (select * from docs where collection_path='club_occupancies' and data->>'status'='active'),
users as (select * from docs where collection_path='user_memberships' and data->>'status'='active')
select jsonb_build_object(
  'active_membership_occupancy_mismatch',(select count(*) from memberships m left join occupancies o on o.document_id=m.document_id where o.data->>'userId' is distinct from m.data->>'userId'),
  'active_occupancy_membership_mismatch',(select count(*) from occupancies o left join memberships m on m.document_id=o.document_id where m.data->>'userId' is distinct from o.data->>'userId'),
  'active_owner_missing',(select count(*) from memberships m where not exists(select 1 from docs u where u.collection_path='users' and u.document_id=m.data->>'userId')),
  'active_user_missing_occupancy',(select count(*) from users u where not exists(select 1 from occupancies o where o.document_id=(u.data->>'seasonId')||'_'||(u.data->>'clubId') and o.data->>'userId'=u.data->>'userId')),
  'secondary_user_missing_occupancy',(select count(*) from users u where u.data->>'secondaryClubId' is not null and not exists(select 1 from occupancies o where o.document_id=(u.data->>'seasonId')||'_'||(u.data->>'secondaryClubId') and o.data->>'userId'=u.data->>'userId')),
  'active_occupancy_missing_user_link',(select count(*) from occupancies o where not exists(select 1 from users u where u.document_id=(o.data->>'seasonId')||'_'||(o.data->>'userId') and (u.data->>'clubId'=o.data->>'clubId' or u.data->>'secondaryClubId'=o.data->>'clubId'))),
  'orphan_results',(select count(*) from docs s where s.collection_path='result_submissions' and not exists(select 1 from docs f where f.collection_path='fixtures' and f.document_id=s.data->>'fixtureId')),
  'encoding_mismatches',(select count(*) from docs where data is distinct from efl_runtime.decode(encoded)),
  'recoverable_originals',(select count(*) from docs where collection_path='legacy_recovery_archive')
) as audit;
