-- Read the plain championship and its CAS generation in one MVCC snapshot.
-- No lock, typed archive construction, or per-match JSONB concatenation.
begin;
create or replace function public.efl_runtime_uzeflife_snapshot(p_space text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare result text;
begin
 select json_build_object('generation',s.generation::text,'data',d.data)::text into result
 from efl_runtime.spaces s left join efl_runtime.documents d
 on d.space=s.name and d.collection_path='uzeflife' and d.document_id='championship'
 where s.name=p_space;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 return result;
end $$;
revoke all on function public.efl_runtime_uzeflife_snapshot(text) from public,anon,authenticated;
grant execute on function public.efl_runtime_uzeflife_snapshot(text) to service_role;
commit;
