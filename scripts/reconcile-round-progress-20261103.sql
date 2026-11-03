-- Owner-confirmed progress: APL/La Liga 19, Serie A/Bundesliga 17.
-- Only competition metadata, one catalog invalidation and an audit record change.
-- Scores, submissions, ownership, deadlines and explicit locks are preserved.
with expected(id,previous,target) as (values
 ('comp-premier-league-2026',13,19),('comp-la-liga-2026',9,19),
 ('comp-serie-a-2026',5,17),('comp-bundesliga-2026',1,17)),
league_changes as (
 select c.document_id as id,e.target,true as league
 from efl_runtime.documents c join expected e on e.id=c.document_id
 where c.space='production' and c.collection_path='competitions'
 and c.data->>'seasonId'='season-2026-27' and c.data->>'type'='LEAGUE'
 and (c.data->>'currentMatchday')::int in(e.previous,e.target)),
cup_changes as (
 select c.document_id as id,case when c.data->>'type'='EUROPEAN_LEAGUE_PHASE' then coalesce((c.data->>'currentMatchday')::int,1)
 else greatest(coalesce((c.data->>'currentMatchday')::int,1),coalesce(max((f.data->>'matchday')::int),0)) end as target,false as league
 from efl_runtime.documents c left join efl_runtime.documents f on f.space=c.space
 and f.collection_path='fixtures' and f.data->>'competitionId'=c.document_id
 and f.data->>'seasonId'='season-2026-27'
 and f.data->>'status' in('SCHEDULED','PENDING_CONFIRMATION')
 and f.data->>'homeClubId' is not null and f.data->>'awayClubId' is not null
 and f.data->>'homeClubId'<>'TBD' and f.data->>'awayClubId'<>'TBD'
 where c.space='production' and c.collection_path='competitions'
 and c.data->>'seasonId'='season-2026-27' and c.data->>'type' in('KNOCKOUT','SUPER_CUP','EUROPEAN_KNOCKOUT','EUROPEAN_LEAGUE_PHASE')
 and c.data->>'status'='active' and coalesce(c.data->>'hidden','false')<>'true'
 and c.document_id not in('comp-coupe-de-france-2026','comp-trophee-champions-2026','comp-trophee-des-champions-2026')
 and c.document_id !~* 'efl[-_ ]?cup|carabao'
 group by c.document_id,c.data),
changes as (select * from league_changes union all select * from cup_changes),
ops as (
 select jsonb_build_object('kind','update','path','competitions/'||id,'encoded',jsonb_build_object('type','map','value',
 jsonb_build_object('resultEntryThroughMatchday',jsonb_build_object('type','number','value',target),
 'updatedAt',jsonb_build_object('type','string','value',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 ||case when league then jsonb_build_object('currentMatchday',jsonb_build_object('type','number','value',target)) else '{}'::jsonb end)) as op from changes
 union all select jsonb_build_object('kind','delete','path','durable_read_snapshots/'||encode(sha256(convert_to('efluz:v1:pg:production:fresh:season:season-2026-27:competitions','UTF8')),'hex'))
 union all select jsonb_build_object('kind','set','path','durable_read_snapshots/'||encode(sha256(convert_to('efluz:v1:pg:production:dirty:season:season-2026-27:competitions','UTF8')),'hex'),
 'encoded',jsonb_build_object('type','map','value',jsonb_build_object('snapshot',jsonb_build_object('type','map','value',jsonb_build_object('data',jsonb_build_object('type','boolean','value',true))),'expiresAt',jsonb_build_object('type','number','value',extract(epoch from now()+interval '1 day')*1000))))
 union all select jsonb_build_object('kind','create','path','audit_logs/round-progress-20261103',
 'encoded',jsonb_build_object('type','map','value',jsonb_build_object(
 'action',jsonb_build_object('type','string','value','OWNER_CONFIRMED_ROUND_PROGRESS'),
 'seasonId',jsonb_build_object('type','string','value','season-2026-27'),
 'reason',jsonb_build_object('type','string','value','Owner confirmed APL 19, La Liga 19, Serie A 17, Bundesliga 17. Enable unfinished reached-round result entry; preserve scores and explicit holds.'),
 'createdAt',jsonb_build_object('type','string','value',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))))
select case
 when exists(select 1 from efl_runtime.documents where space='production' and collection_path='audit_logs' and document_id='round-progress-20261103') then jsonb_build_object('status','ALREADY_APPLIED')
 when (select count(*) from league_changes)=4 then public.efl_runtime_commit('production',(select jsonb_agg(op) from ops),(select generation::text from efl_runtime.spaces where name='production'))
 else jsonb_build_object('error','ROUND_PROGRESS_PRECONDITION_CHANGED') end as result;
