-- Archive staging only. This does not change the live application's database provider.
begin;
create schema if not exists efl_migration;
revoke all on schema efl_migration from public, anon, authenticated;

create table if not exists efl_migration.runs (
  id uuid primary key,
  manifest jsonb not null,
  status text not null default 'LOADING' check (status in ('LOADING','VERIFIED')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create table if not exists efl_migration.documents (
  run_id uuid not null references efl_migration.runs(id),
  document_path text not null,
  payload text not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  primary key (run_id, document_path),
  check (payload::jsonb ->> 'type' = 'map')
);
alter table efl_migration.runs enable row level security;
alter table efl_migration.documents enable row level security;
revoke all on all tables in schema efl_migration from public, anon, authenticated, service_role;

create or replace function public.efl_migration_begin(p_run_id uuid, p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior jsonb;
begin
  if p_manifest ->> 'version' is distinct from '1'
    or p_manifest ->> 'consistentSnapshot' is distinct from 'false'
    or coalesce(p_manifest ->> 'checksum','') !~ '^[a-f0-9]{64}$'
    or (p_manifest ->> 'count')::bigint < 0
    or p_manifest ->> 'count' is null
    or coalesce(p_manifest #>> '{source,projectId}','') = ''
    or coalesce(p_manifest #>> '{source,databaseId}','') = '' then
    raise exception 'INVALID_MIGRATION_MANIFEST';
  end if;
  insert into efl_migration.runs(id,manifest) values(p_run_id,p_manifest) on conflict do nothing;
  select manifest into prior from efl_migration.runs where id=p_run_id for update;
  if prior is distinct from p_manifest then raise exception 'MIGRATION_RUN_CONFLICT'; end if;
  return jsonb_build_object('runId',p_run_id);
end $$;

create or replace function public.efl_migration_load(p_run_id uuid, p_documents jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare entry jsonb; prior efl_migration.documents%rowtype; run_status text; path text; value text; checksum text;
begin
  select status into run_status from efl_migration.runs where id=p_run_id for update;
  if run_status is null then raise exception 'UNKNOWN_MIGRATION_RUN'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>100 then raise exception 'INVALID_CHUNK'; end if;
  for entry in select * from jsonb_array_elements(p_documents) loop
    path := entry ->> 'path'; value := entry ->> 'payload'; checksum := entry ->> 'checksum';
    if path is null or path='' or path like '/%' or path like '%/' or path like '%//%'
      or cardinality(string_to_array(path,'/')) % 2 <> 0
      or checksum is distinct from encode(sha256(convert_to(value,'UTF8')),'hex')
      or value::jsonb ->> 'type' is distinct from 'map' then raise exception 'INVALID_DOCUMENT'; end if;
    select * into prior from efl_migration.documents where run_id=p_run_id and document_path=path;
    if found then
      if prior.checksum is distinct from checksum or prior.payload is distinct from value then raise exception 'DOCUMENT_CONFLICT'; end if;
    else
      if run_status='VERIFIED' then raise exception 'VERIFIED_RUN_IMMUTABLE'; end if;
      insert into efl_migration.documents values(p_run_id,path,value,checksum);
    end if;
  end loop;
  return jsonb_build_object('accepted',jsonb_array_length(p_documents));
end $$;

create or replace function public.efl_migration_verify(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expected jsonb; actual_count bigint; actual_hash text;
begin
  select manifest into expected from efl_migration.runs where id=p_run_id for update;
  if expected is null then raise exception 'UNKNOWN_MIGRATION_RUN'; end if;
  if exists(select 1 from efl_migration.documents where run_id=p_run_id
      and checksum <> encode(sha256(convert_to(payload,'UTF8')),'hex')) then raise exception 'STORED_DOCUMENT_CORRUPTED'; end if;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(document_path || ':' || checksum || E'\n','' order by document_path collate "C"),''),'UTF8')),'hex')
    into actual_count,actual_hash from efl_migration.documents where run_id=p_run_id;
  if actual_count <> (expected ->> 'count')::bigint or actual_hash <> expected ->> 'checksum' then raise exception 'MIGRATION_VERIFICATION_FAILED'; end if;
  update efl_migration.runs set status='VERIFIED',verified_at=coalesce(verified_at,now()) where id=p_run_id;
  return jsonb_build_object('count',actual_count,'checksum',actual_hash,'status','VERIFIED');
end $$;

revoke all on function public.efl_migration_begin(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.efl_migration_load(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.efl_migration_verify(uuid) from public,anon,authenticated;
grant execute on function public.efl_migration_begin(uuid,jsonb) to service_role;
grant execute on function public.efl_migration_load(uuid,jsonb) to service_role;
grant execute on function public.efl_migration_verify(uuid) to service_role;
commit;
