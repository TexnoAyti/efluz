-- Patch only the changed row inside PostgreSQL. Never round-trip the full
-- season snapshot through a serverless function for each result submission.
create or replace function public.efl_runtime_patch_snapshot(
 p_space text, p_ids text[], p_row jsonb, p_merge boolean, p_ttl integer, p_version text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare mode text; document jsonb; snapshot jsonb; previous jsonb;
 idx integer; payload text; expiry bigint; item_id text; wire jsonb; plain jsonb;
begin
 if cardinality(p_ids) is distinct from 3 or exists(select 1 from unnest(p_ids) id where id !~ '^[a-f0-9]{64}$')
   or jsonb_typeof(p_row) is distinct from 'object' or coalesce(p_row->>'id','')='' then raise exception 'INVALID_QUERY'; end if;
 select s.mode into mode from efl_runtime.spaces s where name=p_space for update;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 select d.data into document from efl_runtime.documents d where space=p_space and collection_path='durable_read_snapshots' and document_id=p_ids[2];
 if document is null then
  select d.data into document from efl_runtime.documents d where space=p_space and collection_path='durable_read_snapshots' and document_id=p_ids[1];
 end if;
 snapshot:=case when document ? 'snapshotJson' then (document->>'snapshotJson')::jsonb else document->'snapshot' end;
 if jsonb_typeof(snapshot->'data') is distinct from 'array' then return false;end if;
 select (ordinality-1)::integer,value into idx,previous from jsonb_array_elements(snapshot->'data') with ordinality where value->>'id'=p_row->>'id' limit 1;
 if idx is null then return false;end if;
 if previous->>'updatedAt' is not null and p_row->>'updatedAt' is not null and previous->>'updatedAt'>p_row->>'updatedAt' then return true;end if;
 snapshot:=jsonb_set(snapshot,array['data',idx::text],case when p_merge then previous||p_row else p_row end);
 snapshot:=snapshot||jsonb_build_object('actualCount',jsonb_array_length(snapshot->'data'),'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceVersion',p_version);
 payload:=snapshot::text;
 expiry:=floor(extract(epoch from clock_timestamp())*1000)::bigint+greatest(1,p_ttl)::bigint*1000;
 foreach item_id in array p_ids[1:2] loop
  plain:=jsonb_build_object('snapshotJson',payload,'expiresAt',case when item_id=p_ids[1] then expiry else null end);
  wire:=jsonb_build_object('type','map','value',jsonb_build_object('snapshotJson',jsonb_build_object('type','string','value',payload),'expiresAt',case when item_id=p_ids[1] then jsonb_build_object('type','number','value',expiry::text) else jsonb_build_object('type','null') end));
  insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values(p_space,'durable_read_snapshots',item_id,wire,plain)
  on conflict(space,collection_path,document_id) do update set encoded=excluded.encoded,data=excluded.data;
 end loop;
 delete from efl_runtime.documents where space=p_space and collection_path='durable_read_snapshots' and document_id=p_ids[3];
 update efl_runtime.spaces set generation=generation+1 where name=p_space;
 return true;
end $$;
revoke all on function public.efl_runtime_patch_snapshot(text,text[],jsonb,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.efl_runtime_patch_snapshot(text,text[],jsonb,boolean,integer,text) to service_role;
