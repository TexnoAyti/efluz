-- Bounded primary-key reads. Unchanged rows do not detoast or serialize payloads.
create or replace function public.efl_runtime_snapshot_read(p_space text,p_ids jsonb,p_versions jsonb default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare id text; revision text; payload jsonb; documents jsonb:='[]';
begin
 if not exists(select 1 from efl_runtime.spaces where name=p_space) then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>3 then raise exception 'INVALID_QUERY';end if;
 for id in select jsonb_array_elements_text(p_ids) loop
  if id !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_QUERY';end if;
  select xmin::text into revision from efl_runtime.documents
   where space=p_space and collection_path='durable_read_snapshots' and document_id=id;
  if not found then documents:=documents||jsonb_build_array(jsonb_build_object('id',id,'version',null,'value',null));
  elsif p_versions->>id=revision then
   documents:=documents||jsonb_build_array(jsonb_build_object('id',id,'version',revision,'unchanged',true));
  else
   select data into payload from efl_runtime.documents
    where space=p_space and collection_path='durable_read_snapshots' and document_id=id and xmin::text=revision;
   -- Both lookups share this function's MVCC snapshot.
   documents:=documents||jsonb_build_array(jsonb_build_object('id',id,'version',revision,'value',payload));
  end if;
 end loop;
 return jsonb_build_object('documents',documents);
end $$;
revoke all on function public.efl_runtime_snapshot_read(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.efl_runtime_snapshot_read(text,jsonb,jsonb) to service_role;
