begin;
-- Notification payloads are opaque values, already parsed as JSON by all
-- readers. Preserve every receipt/job and its TTL while avoiding recursive
-- decoding of the entire broadcast history on each queue operation.
-- Lock namespace generations exactly as runtime commits do, preventing a
-- transaction that read the old representation from overwriting this change.
do $$
begin
 perform name from efl_runtime.spaces order by name for update;
 with changed as (
  update efl_runtime.documents
  set encoded=jsonb_set(encoded,'{value,value}',jsonb_build_object('type','string','value',(data->'value')::text)),
      data=jsonb_set(data,'{value}',to_jsonb((data->'value')::text))
  where collection_path='telegram_ai_state'
    and document_id in (
      select encode(sha256(convert_to(key,'UTF8')),'hex')
      from unnest(array['efluz:v1:telegram:broadcasts','efluz:v1:telegram:queue','efluz:v1:telegram:processing']) as keys(key)
    )
    and encoded#>>'{value,value,type}' in ('map','array')
    and jsonb_typeof(data->'value') in ('object','array')
  returning space
 )
 update efl_runtime.spaces set generation=generation+1 where name in (select space from changed);
end $$;
commit;
