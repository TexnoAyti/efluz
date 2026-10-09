-- Reads use MVCC and do not block behind namespace writes.
-- A concurrent commit changes generation, so optimistic transactions retry.
create or replace function public.efl_runtime_read(p_space text,p_query jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare gen bigint;where_sql text;order_sql text:='';orders jsonb;f jsonb;o jsonb;expr text;value_sql text;op text;dir text;
 cursor_sql text:='';prefix_sql text:='true';cv text;result jsonb;cnt bigint;parts text[];lim integer;
begin
 select generation into gen from efl_runtime.spaces where name=p_space;
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

