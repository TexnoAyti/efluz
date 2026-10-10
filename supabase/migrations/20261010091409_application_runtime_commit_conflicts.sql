-- A generation mismatch is an application compare-and-swap conflict. The
-- legacy RPC raises 40001, which the HTTP database layer repeatedly retried
-- with the same stale generation during the hosted concurrency probe.
-- Keep the legacy RPC intact for the currently deployed application.
-- New clients receive a conflict value, re-read, and retry their callback.
create or replace function public.efl_runtime_commit_safe(
  p_space text, p_operations jsonb, p_generation text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  begin
    return public.efl_runtime_commit(p_space,p_operations,p_generation);
  exception when serialization_failure then
    return jsonb_build_object('conflict',true);
  end;
end;
$$;
revoke all on function public.efl_runtime_commit_safe(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.efl_runtime_commit_safe(text,jsonb,text) to service_role;
notify pgrst,'reload schema';
