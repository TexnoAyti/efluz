-- A narrow, fresh plain-JSON read. Returning text avoids repeated JSONB
-- envelope construction/copies of 1,815 typed match records in PostgREST.
-- The source projection is maintained atomically by the existing commit RPC.
begin;
create or replace function public.efl_runtime_uzeflife_read(p_space text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare result text;
begin
 if not exists(select 1 from efl_runtime.spaces where name=p_space) then
  raise exception 'UNKNOWN_RUNTIME_SPACE';
 end if;
 select data::text into result from efl_runtime.documents
  where space=p_space and collection_path='uzeflife' and document_id='championship';
 return result;
end $$;
revoke all on function public.efl_runtime_uzeflife_read(text) from public,anon,authenticated;
grant execute on function public.efl_runtime_uzeflife_read(text) to service_role;
commit;
