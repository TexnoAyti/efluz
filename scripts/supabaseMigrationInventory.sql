-- Read-only evidence collection for the current EFLUZ Supabase source.
-- Run in the SQL editor or authorized read-only query interface.
-- Never export JSON payloads, tokens or user details to GitHub.
SELECT space,count(*)::bigint AS total_documents
FROM efl_runtime.documents
GROUP BY space
ORDER BY space;

SELECT space,split_part(collection_path,'/',1) AS collection,
       count(*)::bigint AS documents
FROM efl_runtime.documents
GROUP BY space,split_part(collection_path,'/',1)
ORDER BY space,documents DESC;

SELECT status,count(*)::bigint AS runs
FROM efl_migration.runs
GROUP BY status;

SELECT status,count(*)::bigint AS exports
FROM efl_migration.source_exports
GROUP BY status;

-- A migration run being VERIFIED does not prove current production parity.
-- Export and compare current source/target snapshots immediately before cutover.
