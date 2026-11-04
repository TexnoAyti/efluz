begin;
-- Execute queue transitions where the authoritative state lives. Unlike the
-- generic document CAS, unrelated writes cannot exhaust notification retries.
-- Keep the existing representation so old receipts, TTLs and rollback work.
create or replace function public.efl_runtime_notification(p_space text,p_action text,p_ids text[],p_args jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare mode text; values_ jsonb:='[]'; writes jsonb:='{}'; ops jsonb:='[]';
 entry jsonb; v jsonb; result jsonb; queue jsonb; records jsonb; job jsonb;
 k integer; idx integer; item record; stored jsonb; encoded_value jsonb;
 now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000); ttl numeric;
 readonly_ boolean:=p_action in ('hget','pending');
begin
 if cardinality(p_ids) not between 1 and 3 or exists(select 1 from unnest(p_ids) id where id !~ '^[0-9a-f]{64}$')
   or jsonb_typeof(p_args)<>'array' then raise exception 'INVALID_NOTIFICATION_OPERATION';end if;
 if readonly_ then select s.mode into mode from efl_runtime.spaces s where name=p_space;
 else select s.mode into mode from efl_runtime.spaces s where name=p_space for update;end if;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if not readonly_ and mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 for k in 1..cardinality(p_ids) loop
  select data into entry from efl_runtime.documents where space=p_space and collection_path='telegram_ai_state' and document_id=p_ids[k];
  v:=null;
  if entry is not null and (entry->>'expiresAt' is null or (entry->>'expiresAt')::numeric>now_ms) then
   v:=entry->'value';
   if jsonb_typeof(v)='string' then begin v:=(v#>>'{}')::jsonb;exception when invalid_text_representation then null;end;end if;
  end if;
  values_:=values_||jsonb_build_array(v);
 end loop;
 if p_action='hget' then return values_->0->(p_args->>0);
 elsif p_action='pending' then
  select jsonb_build_object('pending',jsonb_array_length(coalesce(nullif(values_->0,'null'),'[]')),
   'nextAt',coalesce(min(coalesce((j->>'availableAt')::numeric,0)),0)) into result
   from jsonb_array_elements(coalesce(nullif(values_->0,'null'),'[]')) j;return result;
 elsif p_action='nx' then
  if values_->0<>'null'::jsonb then return null;end if;
  ttl:=(p_args->>1)::numeric;if ttl is not null and ttl<=0 then raise exception 'INVALID_STATE_TTL';end if;
  writes:=jsonb_build_object('0',jsonb_build_object('value',p_args->0,'expiresAt',case when ttl is null then null else now_ms+ttl*1000 end));result:='"OK"';
 elsif p_action='hset' then
  v:=coalesce(nullif(values_->0,'null'),'{}')||(p_args->0);
  writes:=jsonb_build_object('0',jsonb_build_object('value',v));select count(*) into idx from jsonb_object_keys(p_args->0);result:=to_jsonb(idx);
 elsif p_action='hdel' then
  v:=coalesce(nullif(values_->0,'null'),'{}');result:=to_jsonb(case when v?(p_args->>0) then 1 else 0 end);
  writes:=jsonb_build_object('0',jsonb_build_object('value',v-(p_args->>0)));
 elsif p_action='rpush' then
  v:=coalesce(nullif(values_->0,'null'),'[]')||jsonb_build_array(p_args->0);result:=to_jsonb(jsonb_array_length(v));
  writes:=jsonb_build_object('0',jsonb_build_object('value',v));
 elsif p_action='enqueue' then
  records:=coalesce(nullif(values_->0,'null'),'{}');
  if records?(p_args->>0) then return records->(p_args->>0);end if;
  result:=p_args->1;writes:=jsonb_build_object('0',jsonb_build_object('value',records||jsonb_build_object(p_args->>0,result)),
   '1',jsonb_build_object('value',coalesce(nullif(values_->1,'null'),'[]')||(p_args->2)));
 elsif p_action='smart_enqueue' then
  records:=coalesce(nullif(values_->1,'null'),'{}');
  if records?(p_args->>1) then return '0';end if;
  if values_->0<>'null'::jsonb then return '-1';end if;
  ttl:=(p_args->>0)::numeric;if ttl is null or ttl<=0 then raise exception 'INVALID_STATE_TTL';end if;
  writes:=jsonb_build_object('0',jsonb_build_object('value',1,'expiresAt',now_ms+ttl*1000),
   '1',jsonb_build_object('value',records||jsonb_build_object(p_args->>1,p_args->2)),
   '2',jsonb_build_object('value',coalesce(nullif(values_->2,'null'),'[]')||jsonb_build_array(p_args->3)));result:='1';
 elsif p_action='claim' then
  if values_->2 is distinct from p_args->0 then return null;end if;
  queue:=coalesce(nullif(values_->0,'null'),'[]');idx:=null;
  select ordinality::integer-1 into idx from jsonb_array_elements(queue) with ordinality j(value,ordinality)
   where coalesce((value->>'availableAt')::numeric,0)<=(p_args->>1)::numeric order by ordinality limit 1;
  if idx is null then return null;end if;
  job:=(queue->idx)||jsonb_build_object('claimedAt',p_args->1);result:=job;
  writes:=jsonb_build_object('0',jsonb_build_object('value',queue-idx),
   '1',jsonb_build_object('value',coalesce(nullif(values_->1,'null'),'{}')||jsonb_build_object(job->>'jobId',job)));
 elsif p_action='release' then
  if values_->0 is distinct from p_args->0 then return '0';end if;
  writes:=jsonb_build_object('0',jsonb_build_object('value',null,'expiresAt',now_ms));result:='1';
 else raise exception 'UNSUPPORTED_POSTGRES_NOTIFICATION_OPERATION';end if;
 for item in select * from jsonb_each(writes) loop
  v:=item.value->'value';
  if jsonb_typeof(v) in ('object','array') then v:=to_jsonb(v::text);end if;
  encoded_value:=case jsonb_typeof(v) when 'null' then '{"type":"null"}'::jsonb
   when 'number' then jsonb_build_object('type','number','value',v#>>'{}')
   else jsonb_build_object('type',jsonb_typeof(v),'value',v) end;
  stored:=jsonb_build_object('type','map','value',jsonb_build_object('value',encoded_value,'expiresAt',
   case when item.value->>'expiresAt' is null then '{"type":"null"}'::jsonb else jsonb_build_object('type','number','value',item.value->>'expiresAt') end));
  ops:=ops||jsonb_build_array(jsonb_build_object('path','telegram_ai_state/'||p_ids[item.key::integer+1],'kind','set','encoded',stored));
 end loop;
 perform public.efl_runtime_commit(p_space,ops,null);
 return result;
end $$;
revoke all on function public.efl_runtime_notification(text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.efl_runtime_notification(text,text,text[],jsonb) to service_role;
commit;
