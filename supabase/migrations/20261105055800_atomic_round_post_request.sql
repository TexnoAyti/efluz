-- Queue a channel publication against the championship revision, rather than
-- retrying unrelated namespace-generation conflicts during notification drains.
begin;
create or replace function public.efl_runtime_round_post_request(p_space text,p_round integer,p_revision integer,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare mode text;s jsonb;d jsonb;e jsonb;v jsonb;job_record jsonb;entry record;t text;
begin
 if p_round is null or p_round<1 or p_round>15 or p_revision is null or jsonb_typeof(p_payload) is distinct from 'object'
 or jsonb_typeof(p_payload->'snapshotJson') is distinct from 'string' or octet_length(p_payload::text)>1048576
 or coalesce(p_payload->>'fingerprint','') !~ '^[a-f0-9]{64}$'
 or coalesce(p_payload->>'matchCount','') !~ '^[1-9][0-9]{0,3}$'
 or coalesce(p_payload->>'totalPages','') !~ '^[1-9][0-9]{0,3}$'
 or (p_payload->>'totalPages')::integer<>ceil((p_payload->>'matchCount')::numeric/8)
 or coalesce(length(p_payload->>'requestedBy'),0) not between 1 and 160 then raise exception 'INVALID_QUERY';end if;
 select s.mode into mode from efl_runtime.spaces s where name=p_space for update;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 select data into d from efl_runtime.documents where space=p_space and collection_path='uzeflife_channel_posts' and document_id='round-'||p_round;
 if d is not null then
  if d?'fingerprint' and d->>'fingerprint' is distinct from p_payload->>'fingerprint' then return jsonb_build_object('errorCode','FINGERPRINT_CHANGED');end if;
  if d->>'state' is distinct from 'failed' then return d-'snapshot'-'snapshotJson';end if;
 end if;
 select data into s from efl_runtime.documents where space=p_space and collection_path='uzeflife' and document_id='championship';
 if s is null or (s->>'revision')::integer is distinct from p_revision or s->>'format' is distinct from 'LEAGUE'
 or s->>'status' not in ('playing','paused','completed') or (s->>'round')::integer<p_round then return jsonb_build_object('errorCode','REVISION_CHANGED');end if;
 job_record:=jsonb_build_object('snapshotJson',p_payload->>'snapshotJson','totalPages',(p_payload->>'totalPages')::integer,'matchCount',(p_payload->>'matchCount')::integer,
 'fingerprint',p_payload->>'fingerprint','requestedBy',p_payload->>'requestedBy','version',2,'round',p_round,'channel','@uzeflife_turner','state','pending',
 'sentPages',coalesce((d->>'sentPages')::integer,0),'telegramMessageIds',coalesce(d->'telegramMessageIds','[]'),'leaseUntil',0,'inFlight',null,'error',null,
 'at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 -- All immutable render input is a single string. Build its typed envelope
 -- once without recursively traversing the championship or any other jobs.
 e:='{}';for entry in select * from jsonb_each(job_record) loop
  t:=jsonb_typeof(entry.value);
  if t='null' then v:=jsonb_build_object('type','null');
  elsif t='number' then v:=jsonb_build_object('type','number','value',entry.value::text);
  elsif t='string' then v:=jsonb_build_object('type','string','value',entry.value);
  elsif entry.key='telegramMessageIds' then select jsonb_build_object('type','array','value',coalesce(jsonb_agg(jsonb_build_object('type','number','value',value::text)),'[]')) into v from jsonb_array_elements(entry.value);
  else raise exception 'INVALID_QUERY';end if;
  e:=e||jsonb_build_object(entry.key,v);
 end loop;
 insert into efl_runtime.documents(space,collection_path,document_id,data,encoded) values(p_space,'uzeflife_channel_posts','round-'||p_round,job_record,jsonb_build_object('type','map','value',e))
 on conflict(space,collection_path,document_id) do update set data=excluded.data,encoded=excluded.encoded;
 update efl_runtime.spaces set generation=generation+1 where name=p_space;
 return job_record-'snapshotJson';
end $$;
revoke all on function public.efl_runtime_round_post_request(text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.efl_runtime_round_post_request(text,integer,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
