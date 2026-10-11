-- One-time welcome credit for every registered account. Idempotent and additive.
-- Matches ensureFreeTournamentTicket; no user, club, fixture or tournament deletes.
-- Tests override efl.welcome_space to preview. Production is the operator default.
begin;
do $$
declare
 target_space text := coalesce(nullif(current_setting('efl.welcome_space',true),''),'production');
 row record; account jsonb; patch jsonb; wire jsonb; audit jsonb;
 operations jsonb := '[]'; now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 perform 1 from efl_runtime.spaces where name=target_space and mode<>'frozen' for update;
 if not found then raise exception 'WELCOME_SPACE_UNAVAILABLE'; end if;
 for row in
  select u.document_id,u.data->>'telegramId' telegram_id,t.encoded,t.data
  from efl_runtime.documents u left join efl_runtime.documents t
   on t.space=u.space and t.collection_path='user_tickets' and t.document_id=u.document_id
  where u.space=target_space and u.collection_path='users' and not coalesce(t.data ? 'freeTicketGrantedAt',false)
 loop
  account:=coalesce(row.data,jsonb_build_object('userId',row.document_id,'telegramId',coalesce(row.telegram_id,''),'balance',0,'totalGranted',0,'totalSpent',0,'totalRefunded',0));
  patch:=jsonb_build_object('balance',coalesce((account->>'balance')::integer,0)+1,
    'totalGranted',coalesce((account->>'totalGranted')::integer,0)+1,'freeTicketGrantedAt',now_text,'updatedAt',now_text);
  select jsonb_build_object('type','map','value',jsonb_object_agg(key,jsonb_build_object('type',jsonb_typeof(value),'value',value))) into wire from jsonb_each(case when row.encoded is null then account||patch else patch end);
  wire:=case when row.encoded is null then wire else efl_runtime.merge(row.encoded,wire,true,false) end;
  audit:=jsonb_build_object('id','welcome_'||row.document_id,'userId',row.document_id,'type','GRANT','amount',1,'idempotencyKey','welcome_'||row.document_id,'note','One-time free welcome tournament ticket','createdAt',now_text);
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','set','path','user_tickets/'||row.document_id,'encoded',wire));
  select jsonb_build_object('type','map','value',jsonb_object_agg(key,jsonb_build_object('type',jsonb_typeof(value),'value',value))) into wire from jsonb_each(audit);
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','create','path','ticket_transactions/welcome_'||row.document_id,'encoded',wire));
  if jsonb_array_length(operations)>=500 then
    perform public.efl_runtime_commit_safe(target_space,operations,null); operations:='[]';
  end if;
 end loop;
 if jsonb_array_length(operations)>0 then perform public.efl_runtime_commit_safe(target_space,operations,null); end if;
end $$;
commit;
