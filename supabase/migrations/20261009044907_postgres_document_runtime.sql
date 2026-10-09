begin;
create schema if not exists efl_runtime;
revoke all on schema efl_runtime from public,anon,authenticated;
grant usage on schema efl_runtime to service_role;
create table if not exists efl_runtime.spaces (
 name text primary key check(name in ('preview','production')),
 generation bigint not null default 0, mode text not null default 'staging' check(mode in ('staging','active','frozen')),
 archive_run uuid
);
create table if not exists efl_runtime.documents (
 space text not null references efl_runtime.spaces(name), collection_path text not null, document_id text not null,
 encoded jsonb not null check(encoded->>'type'='map'), data jsonb not null,
 primary key(space,collection_path,document_id)
);
alter table efl_runtime.spaces enable row level security;
alter table efl_runtime.documents enable row level security;
grant select,update on efl_runtime.spaces to service_role;
grant select,insert,update,delete on efl_runtime.documents to service_role;
insert into efl_runtime.spaces(name) values('preview'),('production') on conflict do nothing;
create index if not exists runtime_docs_filter on efl_runtime.documents using gin(data jsonb_path_ops);
create index if not exists runtime_docs_competition on efl_runtime.documents(space,collection_path,(data->>'competitionId'));
create index if not exists runtime_docs_season on efl_runtime.documents(space,collection_path,(data->>'seasonId'));
create index if not exists runtime_docs_user on efl_runtime.documents(space,collection_path,(data->>'userId'));

create or replace function efl_runtime.decode(v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare answer jsonb; entry record; t text:=v->>'type';
begin
 if t='map' then
  answer:='{}';for entry in select * from jsonb_each(v->'value') loop answer:=answer||jsonb_build_object(entry.key,efl_runtime.decode(entry.value));end loop;return answer;
 elsif t='array' then select coalesce(jsonb_agg(efl_runtime.decode(value)),'[]') into answer from jsonb_array_elements(v->'value');return answer;
 elsif t='null' then return 'null';
 elsif t in ('number','integer') then return to_jsonb((v->>'value')::numeric);
 elsif t in ('string','boolean','date') then return v->'value';
 elsif t='timestamp' then return to_jsonb(to_char(to_timestamp((v#>>'{value,0}')::numeric+(v#>>'{value,1}')::numeric/1000000000) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 else return v;end if;
end $$;
create or replace function efl_runtime.put_field(target jsonb,parts text[],v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=coalesce(target,'{"type":"map","value":{}}');
begin
 if result->>'type'<>'map' then result:='{"type":"map","value":{}}';end if;
 if cardinality(parts)=1 then return jsonb_set(result,array['value',parts[1]],v,true);end if;
 return jsonb_set(result,array['value',parts[1]],efl_runtime.put_field(result#>array['value',parts[1]],parts[2:cardinality(parts)],v),true);
end $$;
create or replace function efl_runtime.merge(target jsonb,patch jsonb,deep boolean,dotted boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=coalesce(target,'{"type":"map","value":{}}');entry record;old jsonb;value jsonb;
begin
 for entry in select * from jsonb_each(patch->'value') loop
  value:=entry.value;old:=result#>array['value',entry.key];
  if deep and old->>'type'='map' and value->>'type'='map' then value:=efl_runtime.merge(old,value,true,false);end if;
  result:=efl_runtime.put_field(result,case when dotted then string_to_array(entry.key,'.') else array[entry.key] end,value);
 end loop;return result;
end $$;

create or replace function public.efl_runtime_commit(p_space text,p_operations jsonb,p_generation text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_generation bigint;current_mode text;op jsonb;parts text[];col text;id text;prior jsonb;next jsonb;
begin
 select generation,mode into current_generation,current_mode from efl_runtime.spaces where name=p_space for update;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if current_mode='frozen' then raise exception 'RUNTIME_FROZEN';end if;
 if p_generation is not null and current_generation<>p_generation::bigint then raise exception 'TRANSACTION_CONFLICT' using errcode='40001';end if;
 if jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations)>500 then raise exception 'INVALID_OPERATIONS';end if;
 for op in select value from jsonb_array_elements(p_operations) loop
  parts:=string_to_array(op->>'path','/');
  if cardinality(parts)%2<>0 or cardinality(parts)<2 or ''=any(parts) then raise exception 'INVALID_DOCUMENT_PATH';end if;
  col:=array_to_string(parts[1:cardinality(parts)-1],'/');id:=parts[cardinality(parts)];
  select encoded into prior from efl_runtime.documents where space=p_space and collection_path=col and document_id=id;
  if op->>'kind'='delete' then delete from efl_runtime.documents where space=p_space and collection_path=col and document_id=id;continue;end if;
  if op->>'kind'='create' and prior is not null then raise exception 'DOCUMENT_ALREADY_EXISTS';end if;
  if op->>'kind'='update' and prior is null then raise exception 'DOCUMENT_NOT_FOUND';end if;
  if op->>'kind' not in ('set','create','update') or op#>>'{encoded,type}' is distinct from 'map' then raise exception 'INVALID_OPERATION';end if;
  next:=case when op->>'kind'='update' then efl_runtime.merge(prior,op->'encoded',false,true)
    when coalesce((op->>'merge')::boolean,false) then efl_runtime.merge(prior,op->'encoded',true,false) else op->'encoded' end;
  insert into efl_runtime.documents(space,collection_path,document_id,encoded,data) values(p_space,col,id,next,efl_runtime.decode(next))
    on conflict(space,collection_path,document_id) do update set encoded=excluded.encoded,data=excluded.data;
 end loop;
 if jsonb_array_length(p_operations)>0 then update efl_runtime.spaces set generation=generation+1 where name=p_space returning generation into current_generation;end if;
 return jsonb_build_object('generation',current_generation::text);
end $$;

create or replace function public.efl_runtime_read(p_space text,p_query jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare gen bigint;where_sql text;order_sql text:='';orders jsonb;f jsonb;o jsonb;expr text;value_sql text;op text;dir text;
 cursor_sql text:='';prefix_sql text:='true';cv text;result jsonb;cnt bigint;parts text[];lim integer;
begin
 select generation into gen from efl_runtime.spaces where name=p_space for share;
 if not found then raise exception 'UNKNOWN_RUNTIME_SPACE';end if;
 if p_query?'path' then
  parts:=string_to_array(p_query->>'path','/');
  select coalesce(jsonb_agg(jsonb_build_object('id',document_id,'encoded',encoded)),'[]') into result
   from efl_runtime.documents where space=p_space and collection_path=array_to_string(parts[1:cardinality(parts)-1],'/') and document_id=parts[cardinality(parts)];
  return jsonb_build_object('generation',gen::text,'documents',result);
 end if;
 where_sql:=format('space=%L and collection_path=%L',p_space,p_query->>'collection');
 for f in select value from jsonb_array_elements(coalesce(p_query->'filters','[]')) loop
  expr:=case when f->>'field'='__name__' then 'to_jsonb(document_id)' else format('(data #> string_to_array(%L,''.''))',f->>'field') end;
  value_sql:=format('%L::jsonb',(f->'value')::text);op:=f->>'op';
  if op in ('==','!=','>','>=','<','<=') then
   where_sql:=where_sql||format(' and %s is not null and %s %s %s',expr,expr,case op when '==' then '=' when '!=' then '<>' else op end,value_sql);
   if op='!=' then where_sql:=where_sql||format(' and %s<>''null''::jsonb',expr);end if;
  elsif op in ('in','not-in') then
   where_sql:=where_sql||format(' and %s is not null and %s exists(select 1 from jsonb_array_elements(%s) v where v=%s)',expr,case when op='not-in' then 'not' else '' end,value_sql,expr);
  elsif op='array-contains' then where_sql:=where_sql||format(' and %s @> jsonb_build_array(%s)',expr,value_sql);
  elsif op='array-contains-any' then where_sql:=where_sql||format(' and exists(select 1 from jsonb_array_elements(%s) v where %s @> jsonb_build_array(v))',value_sql,expr);
  else raise exception 'INVALID_QUERY';end if;
 end loop;
 orders:=coalesce(p_query->'orders','[]');
 if not exists(select 1 from jsonb_array_elements(orders) x where x->>'field'='__name__') then
  orders:=orders||jsonb_build_array(jsonb_build_object('field','__name__','direction',coalesce(orders->-1->>'direction','asc')));
 end if;
 for o in select value from jsonb_array_elements(orders) loop
  dir:=o->>'direction';if dir not in ('asc','desc') then raise exception 'INVALID_QUERY';end if;
  expr:=case when o->>'field'='__name__' then 'to_jsonb(document_id)' else format('(data #> string_to_array(%L,''.''))',o->>'field') end;
  order_sql:=order_sql||case when order_sql='' then '' else ',' end||expr||' '||dir;
  where_sql:=where_sql||format(' and %s is not null',expr);
  if p_query?'cursor' then
   cv:=format('%L::jsonb',case when o->>'field'='__name__' then (p_query#>'{cursor,id}')::text else (p_query#>'{cursor,data}' #>string_to_array(o->>'field','.'))::text end);
   if cv='NULL::jsonb' then raise exception 'INVALID_QUERY';end if;
   cursor_sql:=cursor_sql||case when cursor_sql='' then '' else ' or ' end||format('(%s and %s %s %s)',prefix_sql,expr,case dir when 'asc' then '>' else '<' end,cv);
   prefix_sql:=prefix_sql||format(' and %s=%s',expr,cv);
  end if;
 end loop;
 if cursor_sql<>'' then where_sql:=where_sql||' and ('||cursor_sql||')';end if;
 lim:=coalesce((p_query->>'limit')::integer,10000);if lim<1 or lim>10000 then raise exception 'INVALID_QUERY';end if;
 if coalesce((p_query->>'count')::boolean,false) then
  execute 'select count(*) from (select 1 from efl_runtime.documents where '||where_sql||case when p_query?'limit' then ' limit '||lim else '' end||') s' into cnt;
  return jsonb_build_object('generation',gen::text,'count',cnt);
 end if;
 execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',document_id,''encoded'',encoded)),''[]'') from (select document_id,encoded from efl_runtime.documents where '||where_sql||' order by '||order_sql||' limit '||lim||') s' into result;
 return jsonb_build_object('generation',gen::text,'documents',result);
end $$;

create or replace function efl_runtime.load_archive(p_space text,p_run uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare n bigint;m text;
begin
 select mode into m from efl_runtime.spaces where name=p_space for update;
 if m is distinct from 'staging' then raise exception 'RUNTIME_NOT_STAGING';end if;
 if not exists(select 1 from efl_migration.runs where id=p_run and status='VERIFIED') then raise exception 'ARCHIVE_NOT_VERIFIED';end if;
 delete from efl_runtime.documents where space=p_space;
 insert into efl_runtime.documents
 select p_space,array_to_string((string_to_array(document_path,'/'))[1:cardinality(string_to_array(document_path,'/'))-1],'/'),split_part(document_path,'/',-1),payload::jsonb,efl_runtime.decode(payload::jsonb)
 from efl_migration.documents where run_id=p_run;
 get diagnostics n=row_count;
 update efl_runtime.spaces set generation=generation+1,archive_run=p_run where name=p_space;return n;
end $$;
revoke all on all functions in schema efl_runtime from public,anon,authenticated,service_role;
grant execute on function efl_runtime.decode(jsonb),efl_runtime.put_field(jsonb,text[],jsonb),efl_runtime.merge(jsonb,jsonb,boolean,boolean) to service_role;
revoke all on function public.efl_runtime_read(text,jsonb),public.efl_runtime_commit(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.efl_runtime_read(text,jsonb),public.efl_runtime_commit(text,jsonb,text) to service_role;
commit;
