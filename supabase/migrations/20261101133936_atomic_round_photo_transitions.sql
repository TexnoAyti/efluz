begin;
create or replace function public.efl_runtime_round_photo(p_space text,p_round integer,p_action text,p_token text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d jsonb;e jsonb;patch jsonb:='{}';v jsonb;entry record;t text;mode text;n integer;total integer;pending boolean;
 millis bigint:=floor(extract(epoch from clock_timestamp())*1000);stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if p_round is null or p_round<1 or p_round>15 or p_action is null or p_action not in ('claim','ack','reject') or p_token is null or p_token !~ '^[a-zA-Z0-9-]{16,80}$' or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_QUERY';end if;
 select s.mode into mode from efl_runtime.spaces s where name=p_space for update;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 select data,encoded into d,e from efl_runtime.documents where space=p_space and collection_path='uzeflife_channel_posts' and document_id='round-'||p_round;
 if not found or d->>'version' is distinct from '2' then return null;end if;
 n:=coalesce((d->>'sentPages')::integer,0);total:=(d->>'totalPages')::integer;
 if p_action='claim' then
  if d->>'state'='sending' and d#>>'{inFlight,lease}'=p_token then return jsonb_build_object('inFlight',d->'inFlight');end if;
  if d->>'state' is distinct from 'pending' or d->>'fingerprint' is distinct from p_payload->>'fingerprint' or n is distinct from (p_payload->>'sentPages')::integer or n<0 or total is null or n>=total then return null;end if;
  patch:=jsonb_build_object('state','sending','leaseUntil',millis+90000,'inFlight',jsonb_build_object('start',n,'count',1,'lease',p_token),'at',stamp);
  if jsonb_typeof(d->'snapshot')='object' and not d?'snapshotJson' then patch:=patch||jsonb_build_object('snapshotJson',(d->'snapshot')::text,'snapshot',null);end if;
 elsif p_action='ack' then
  if d->>'lastAcknowledgedLease'=p_token then
   if jsonb_build_array(d#>'{telegramMessageIds,-1}') is distinct from p_payload->'ids' then raise exception 'INVALID_QUERY';end if;
   return jsonb_build_object('applied',true,'pending',d->>'state'='pending');end if;
  if d->>'state' is distinct from 'sending' or d#>>'{inFlight,lease}' is distinct from p_token then return jsonb_build_object('applied',false,'pending',false);end if;
  if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')<>1 or jsonb_typeof(p_payload#>'{ids,0}') is distinct from 'number' or p_payload#>>'{ids,0}' !~ '^[1-9][0-9]{0,15}$' or (p_payload#>>'{ids,0}')::numeric>9007199254740991 or n>=total or d#>>'{inFlight,count}'<>'1' or n is distinct from (d#>>'{inFlight,start}')::integer then raise exception 'INVALID_QUERY';end if;
  n:=n+1;pending:=n<total;
  patch:=jsonb_build_object('state',case when pending then 'pending' else 'sent' end,'sentPages',n,'telegramMessageIds',coalesce(d->'telegramMessageIds','[]')||(p_payload->'ids'),'leaseUntil',0,'inFlight',null,'error',null,'lastAcknowledgedLease',p_token,'at',stamp);
 else
  if d->>'state' is distinct from 'sending' or d#>>'{inFlight,lease}' is distinct from p_token then return jsonb_build_object('applied',false,'pending',false);end if;
  patch:=jsonb_build_object('state',case when p_payload->>'rejected'='true' then 'failed' else 'unverified' end,'leaseUntil',0,'error',left(p_payload->>'error',280),'at',stamp);
  if p_payload->>'rejected'='true' then patch:=patch||jsonb_build_object('inFlight',null);end if;
 end if;
 -- Only metadata changes: never recursively decode the immutable snapshot.
 for entry in select * from jsonb_each(patch) loop
  t:=jsonb_typeof(entry.value);
  if t='null' then v:=jsonb_build_object('type','null');
  elsif t='number' then v:=jsonb_build_object('type','number','value',entry.value::text);
  elsif t in ('string','boolean') then v:=jsonb_build_object('type',t,'value',entry.value);
  elsif entry.key='inFlight' then v:=jsonb_build_object('type','map','value',jsonb_build_object('start',jsonb_build_object('type','number','value',entry.value->>'start'),'count',jsonb_build_object('type','number','value','1'),'lease',jsonb_build_object('type','string','value',p_token)));
  elsif entry.key='telegramMessageIds' then select jsonb_build_object('type','array','value',coalesce(jsonb_agg(jsonb_build_object('type','number','value',value::text)),'[]')) into v from jsonb_array_elements(entry.value);
  else raise exception 'INVALID_QUERY';end if;
  e:=efl_runtime.put_field(e,array[entry.key],v);
 end loop;
 update efl_runtime.documents set encoded=e,data=d||patch where space=p_space and collection_path='uzeflife_channel_posts' and document_id='round-'||p_round;
 update efl_runtime.spaces set generation=generation+1 where name=p_space;
 if p_action='claim' then return jsonb_build_object('inFlight',patch->'inFlight');end if;
 return jsonb_build_object('applied',true,'pending',coalesce(pending,false));
end $$;
revoke all on function public.efl_runtime_round_photo(text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.efl_runtime_round_photo(text,integer,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
