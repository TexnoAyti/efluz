-- Match the JSONB expression used by efl_runtime_read for the two
-- high-volume season-scoped collections. The existing season index stores
-- text (data->>'seasonId'), while the runtime query compares JSONB via
-- data #> '{seasonId}', so PostgreSQL could only scan the collection prefix
-- and filter every row afterwards.
create index if not exists runtime_docs_fixtures_season_json
  on efl_runtime.documents (space, collection_path, ((data #> '{seasonId}')), document_id)
  where collection_path = 'fixtures';

create index if not exists runtime_docs_fixture_overrides_season_json
  on efl_runtime.documents (space, collection_path, ((data #> '{seasonId}')), document_id)
  where collection_path = 'durable_fixture_overrides';
