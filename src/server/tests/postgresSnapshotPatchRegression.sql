-- Synthetic data only. All test writes are rolled back.
begin;
set local statement_timeout='15s';
do $$
declare ids text[]:=array[repeat('a',64),repeat('b',64),repeat('c',64)];
 snapshot jsonb; payload text; row jsonb; t timestamptz:=clock_timestamp(); ok boolean;
begin
 select jsonb_build_object('schemaVersion',1,'actualCount',1752,'expectedCount',1752,'generatedAt','2026-10-09T00:00:00Z','data',jsonb_agg(jsonb_build_object('id','synthetic-'||i,'updatedAt','2026-10-09T00:00:00Z','status','SCHEDULED','name',repeat('x',500)))) into snapshot from generate_series(1,1752) i;
 payload:=snapshot::text;
 insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values('preview','durable_read_snapshots',ids[2],jsonb_build_object('type','map','value',jsonb_build_object('snapshotJson',jsonb_build_object('type','string','value',payload),'expiresAt',jsonb_build_object('type','null'))),jsonb_build_object('snapshotJson',payload,'expiresAt',null)) on conflict(space,collection_path,document_id) do update set encoded=excluded.encoded,data=excluded.data;
 row:=jsonb_build_object('id','synthetic-1','updatedAt','2026-10-09T01:00:00Z','status','CONFIRMED','homeScore',2,'awayScore',1);
 ok:=public.efl_runtime_patch_snapshot('preview',ids,row,false,86400,'synthetic-test');
 if not ok then raise exception 'PATCH_FAILED';end if;
 select (data->>'snapshotJson')::jsonb into snapshot from efl_runtime.documents where space='preview' and collection_path='durable_read_snapshots' and document_id=ids[1];
 if jsonb_array_length(snapshot->'data')<>1752 or snapshot#>>'{data,0,homeScore}'<>'2' or snapshot#>>'{data,1,status}'<>'SCHEDULED' then raise exception 'ROW_PRESERVATION_FAILED';end if;
 perform public.efl_runtime_patch_snapshot('preview',ids,row||jsonb_build_object('updatedAt','2026-10-08T00:00:00Z','homeScore',9),false,86400,'stale');
 select (data->>'snapshotJson')::jsonb into snapshot from efl_runtime.documents where space='preview' and collection_path='durable_read_snapshots' and document_id=ids[2];
 if snapshot#>>'{data,0,homeScore}'<>'2' then raise exception 'STALE_OVERWRITE';end if;
 ok:=public.efl_runtime_patch_snapshot('preview',ids,jsonb_build_object('id','missing'),false,86400,'missing');
 if ok then raise exception 'MISSING_ROW_ACCEPTED';end if;
 delete from efl_runtime.documents where space='preview' and collection_path='durable_read_snapshots' and document_id=ids[1];
 insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values('preview','durable_read_snapshots',ids[3],'{"type":"map","value":{}}','{}') on conflict(space,collection_path,document_id) do nothing;
 perform public.efl_runtime_patch_snapshot('preview',ids,row,false,86400,'same-row');
 if not exists(select 1 from efl_runtime.documents where space='preview' and collection_path='durable_read_snapshots' and document_id=ids[1]) or exists(select 1 from efl_runtime.documents where space='preview' and collection_path='durable_read_snapshots' and document_id=ids[3]) then raise exception 'FRESH_OR_DIRTY_REPAIR_FAILED';end if;
 if has_function_privilege('anon','public.efl_runtime_patch_snapshot(text,text[],jsonb,boolean,integer,text)','execute') or has_function_privilege('authenticated','public.efl_runtime_patch_snapshot(text,text[],jsonb,boolean,integer,text)','execute') then raise exception 'PUBLIC_EXECUTE_GRANTED';end if;
 raise notice 'PASS full-season row patch, stale guard, missing row, fresh repair and private execution; ms=%',extract(epoch from clock_timestamp()-t)*1000;
end $$;
do $$
declare row jsonb:='{"id":"synthetic-delta","seasonId":"test-season","competitionId":"test-comp","updatedAt":"2026-10-09T02:00:00Z","homeScore":2}'; stored jsonb;
begin
 perform public.efl_runtime_save_fixture_delta('preview',row,'{"type":"map","value":{}}');
 perform public.efl_runtime_save_fixture_delta('preview',row||'{"updatedAt":"2026-10-09T01:00:00Z","homeScore":9}','{"type":"map","value":{}}');
 select data into stored from efl_runtime.documents where space='preview' and collection_path='durable_fixture_overrides' and document_id='synthetic-delta';
 if stored->>'homeScore'<>'2' then raise exception 'STALE_DELTA_OVERWRITE';end if;
 if has_function_privilege('anon','public.efl_runtime_save_fixture_delta(text,jsonb,jsonb)','execute') then raise exception 'PUBLIC_DELTA_EXECUTE';end if;
end $$;
rollback;
