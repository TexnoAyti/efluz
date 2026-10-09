create or replace function public.efl_runtime_save_fixture_delta(p_space text,p_row jsonb,p_encoded jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare mode text; previous jsonb;
begin
 if coalesce(p_row->>'id','')='' or coalesce(p_row->>'seasonId','')='' or coalesce(p_row->>'competitionId','')='' or p_encoded->>'type' is distinct from 'map' then raise exception 'INVALID_QUERY';end if;
 select s.mode into mode from efl_runtime.spaces s where name=p_space for update;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 select data into previous from efl_runtime.documents where space=p_space and collection_path='durable_fixture_overrides' and document_id=p_row->>'id';
 if previous->>'updatedAt' is not null and p_row->>'updatedAt' is not null and previous->>'updatedAt'>p_row->>'updatedAt' then return true;end if;
 insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values(p_space,'durable_fixture_overrides',p_row->>'id',p_encoded,p_row)
 on conflict(space,collection_path,document_id) do update set encoded=excluded.encoded,data=excluded.data;
 update efl_runtime.spaces set generation=generation+1 where name=p_space;
 return true;
end $$;
revoke all on function public.efl_runtime_save_fixture_delta(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.efl_runtime_save_fixture_delta(text,jsonb,jsonb) to service_role;
