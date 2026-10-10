begin;
-- Keep the existing RPC body and grants; change only the application CAS code.
-- 40001 is a true serialization error and must not represent a stale token.
do $fix$
declare body text;
begin
  body := pg_get_functiondef('public.efl_runtime_commit(text,jsonb,text)'::regprocedure);
  if position('raise exception ''TRANSACTION_CONFLICT'' using errcode=''40001''' in body)=0 then
    raise exception 'UNEXPECTED_RUNTIME_COMMIT_DEFINITION';
  end if;
  execute replace(body,
    'raise exception ''TRANSACTION_CONFLICT'' using errcode=''40001''',
    'raise exception ''TRANSACTION_CONFLICT'' using errcode=''PT409''');
end $fix$;
create or replace function public.efl_runtime_commit_safe(
 p_space text,p_operations jsonb,p_generation text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 begin return public.efl_runtime_commit(p_space,p_operations,p_generation);
 exception when serialization_failure or sqlstate 'PT409' then
  return jsonb_build_object('conflict',true);
 end;
end; $$;
revoke all on function public.efl_runtime_commit_safe(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.efl_runtime_commit_safe(text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
