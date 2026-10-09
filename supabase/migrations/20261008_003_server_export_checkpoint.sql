-- Durable, private checkpoints for a read-only Firestore export.
begin;
create table efl_migration.source_exports (
 id uuid primary key, source jsonb not null, state jsonb not null,
 revision bigint not null default 0, status text not null default 'EXPORTING',
 started_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 check (status in ('EXPORTING','VERIFIED'))
);
create table efl_migration.export_documents (
 run_id uuid not null references efl_migration.source_exports(id),
 document_path text not null, payload text not null, checksum text not null,
 primary key(run_id,document_path)
);
alter table efl_migration.source_exports enable row level security;
alter table efl_migration.export_documents enable row level security;
revoke all on all tables in schema efl_migration from public,anon,authenticated,service_role;

create function public.efl_export_start(p_run_id uuid,p_source jsonb,p_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 if coalesce(p_source->>'projectId','')='' or coalesce(p_source->>'databaseId','')='' then raise exception 'INVALID_SOURCE'; end if;
 insert into efl_migration.source_exports(id,source,state) values(p_run_id,p_source,p_state) on conflict do nothing;
 select source into prior from efl_migration.source_exports where id=p_run_id;
 if prior is distinct from p_source then raise exception 'SOURCE_CONFLICT'; end if;
 return jsonb_build_object('runId',p_run_id);
end $$;

create function public.efl_export_claim(p_run_id uuid,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job efl_migration.source_exports%rowtype;
begin
 select * into job from efl_migration.source_exports where id=p_run_id for update;
 if not found then raise exception 'UNKNOWN_EXPORT'; end if;
 if job.status='VERIFIED' then return jsonb_build_object('status','VERIFIED'); end if;
 if job.lease_until>clock_timestamp() then raise exception 'EXPORT_BUSY'; end if;
 update efl_migration.source_exports set lease_id=p_lease_id,lease_until=clock_timestamp()+interval '90 seconds' where id=p_run_id;
 return jsonb_build_object('status',job.status,'source',job.source,'revision',job.revision,'state',job.state);
end $$;

create function public.efl_export_step(p_run_id uuid,p_lease_id uuid,p_revision bigint,p_state jsonb,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job efl_migration.source_exports%rowtype; entry jsonb; path text; value text; hash text; prior efl_migration.export_documents%rowtype;
begin
 select * into job from efl_migration.source_exports where id=p_run_id for update;
 if job.status is distinct from 'EXPORTING' or job.lease_id is distinct from p_lease_id or job.revision is distinct from p_revision or job.lease_until<clock_timestamp() then raise exception 'EXPORT_LEASE_LOST'; end if;
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>25 then raise exception 'INVALID_EXPORT_CHUNK'; end if;
 for entry in select * from jsonb_array_elements(p_documents) loop
  path:=entry->>'path'; value:=entry->>'payload'; hash:=entry->>'checksum';
  if path is null or path='' or path like '/%' or path like '%/' or path like '%//%' or cardinality(string_to_array(path,'/'))%2<>0
    or value is null or hash is distinct from encode(sha256(convert_to(value,'UTF8')),'hex') or value::jsonb->>'type' is distinct from 'map' then raise exception 'INVALID_EXPORT_DOCUMENT'; end if;
  select * into prior from efl_migration.export_documents where run_id=p_run_id and document_path=path;
  if found then
   if prior.payload is distinct from value then raise exception 'EXPORT_DOCUMENT_CHANGED'; end if;
  else insert into efl_migration.export_documents values(p_run_id,path,value,hash); end if;
 end loop;
 update efl_migration.source_exports set state=p_state,revision=revision+1,lease_id=null,lease_until=null where id=p_run_id;
 return jsonb_build_object('revision',job.revision+1,'count',(select count(*) from efl_migration.export_documents where run_id=p_run_id));
end $$;

create function public.efl_export_finish(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job efl_migration.source_exports%rowtype; cnt bigint; hash text; manifest jsonb; result jsonb;
begin
 select * into job from efl_migration.source_exports where id=p_run_id for update;
 if not found then raise exception 'UNKNOWN_EXPORT'; end if;
 if job.lease_until>clock_timestamp() then raise exception 'EXPORT_BUSY'; end if;
 if jsonb_array_length(job.state->'pendingCollections')<>0 or jsonb_array_length(job.state->'pendingDocuments')<>0 then raise exception 'EXPORT_INCOMPLETE'; end if;
 if job.status='VERIFIED' then return public.efl_migration_verify(p_run_id); end if;
 select count(*),encode(sha256(convert_to(coalesce(string_agg(document_path||':'||checksum||E'\n','' order by document_path collate "C"),''),'UTF8')),'hex')
 into cnt,hash from efl_migration.export_documents where run_id=p_run_id;
 manifest:=jsonb_build_object('version',1,'source',job.source,'startedAt',job.started_at,'finishedAt',clock_timestamp(),'collections',job.state->'collections','count',cnt,'checksum',hash,'consistentSnapshot',false);
 perform public.efl_migration_begin(p_run_id,manifest);
 insert into efl_migration.documents select run_id,document_path,payload,checksum from efl_migration.export_documents where run_id=p_run_id;
 result:=public.efl_migration_verify(p_run_id);
 update efl_migration.source_exports set status='VERIFIED' where id=p_run_id;
 return result;
end $$;

revoke all on function public.efl_export_start(uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.efl_export_claim(uuid,uuid) from public,anon,authenticated;
revoke all on function public.efl_export_step(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.efl_export_finish(uuid) from public,anon,authenticated;
grant execute on function public.efl_export_start(uuid,jsonb,jsonb) to service_role;
grant execute on function public.efl_export_claim(uuid,uuid) to service_role;
grant execute on function public.efl_export_step(uuid,uuid,bigint,jsonb,jsonb) to service_role;
grant execute on function public.efl_export_finish(uuid) to service_role;
commit;
