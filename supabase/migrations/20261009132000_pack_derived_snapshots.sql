-- Derived snapshots use JSON wire semantics. Store their payload once as text
-- instead of recursively decoding every fixture for both fresh and LKG copies.
-- Authoritative documents are unchanged. Coordinate with runtime transactions.
begin;
select generation from efl_runtime.spaces where name='production' for update;
with changed as (
 update efl_runtime.documents
 set encoded=jsonb_set(encoded,'{value}',((encoded->'value')-'snapshot')||jsonb_build_object('snapshotJson',jsonb_build_object('type','string','value',(data->'snapshot')::text))),
     data=(data-'snapshot')||jsonb_build_object('snapshotJson',(data->'snapshot')::text)
 where space='production' and collection_path='durable_read_snapshots'
   and data ? 'snapshot' and data#>>'{snapshot,schemaVersion}' is not null
 returning 1
)
update efl_runtime.spaces set generation=generation+1
where name='production' and exists(select 1 from changed);
commit;
