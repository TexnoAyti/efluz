-- Decode wide notification maps without repeatedly copying the growing object.
-- No data, transaction locking, or execution grants are changed.
begin;
create or replace function efl_runtime.decode(v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare answer jsonb; t text:=v->>'type';
begin
 if t='map' then
  -- Build maps once: repeated concatenation copies every preceding entry.
  select coalesce(jsonb_object_agg(entry.key,efl_runtime.decode(entry.value)),'{}') into answer from jsonb_each(v->'value') entry;return answer;
 elsif t='array' then select coalesce(jsonb_agg(efl_runtime.decode(value)),'[]') into answer from jsonb_array_elements(v->'value');return answer;
 elsif t='null' then return 'null';
 elsif t in ('number','integer') then return to_jsonb((v->>'value')::numeric);
 elsif t in ('string','boolean','date') then return v->'value';
 elsif t='timestamp' then return to_jsonb(to_char(to_timestamp((v#>>'{value,0}')::numeric+(v#>>'{value,1}')::numeric/1000000000) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 else return v;end if;
end $$;
commit;
