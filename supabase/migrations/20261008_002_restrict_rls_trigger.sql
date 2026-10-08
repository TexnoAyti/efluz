-- Supabase's automatic RLS event trigger must not be exposed as an RPC.
-- Event triggers continue to run as their owner without these API grants.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
