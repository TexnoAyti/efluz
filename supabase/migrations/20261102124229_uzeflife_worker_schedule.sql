-- Enable the scheduler without exposing its bearer token in source or job text.
-- Deployment activates the job only after the scoped worker is READY.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
revoke all on table net.http_request_queue,net._http_response from public,anon,authenticated;
select cron.schedule('efluz-uzeflife-10min','*/10 * * * *', $job$
 select net.http_post(
  url:='https://efluz.vercel.app/api/internal/uzeflife-worker',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='efluz_uzeflife_worker')),
  body:='{}'::jsonb,timeout_milliseconds:=20000
 ) where exists(select 1 from vault.secrets where name='efluz_uzeflife_worker');
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='efluz-uzeflife-10min';
commit;
