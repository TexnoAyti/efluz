import assert from 'node:assert/strict';
import type {PGlite} from '@electric-sql/pglite';

/** Real SQL regression: ID membership remains typed and uses the existing PK. */
export async function verifyIndexedDocumentIds(pg: PGlite) {
  const collection = 'indexed_id_audit';
  const ids = ['123', 'alpha', "quote'Id", 'o‘zbek', 'zulu'];
  await pg.exec('begin');
  try {
    for (const [rank, id] of ids.entries()) {
      await pg.query(`insert into efl_runtime.documents(space,collection_path,document_id,encoded,data)
        values('preview',$1,$2,'{"type":"map","value":{}}',$3::jsonb)`, [collection, id, JSON.stringify({rank})]);
    }
    const generation = (await pg.query<{generation: string}>(`select generation::text from efl_runtime.spaces where name='preview'`)).rows[0].generation;
    const read = async (values: unknown[], extra = {}) => {
      const result = await pg.query<{value: any}>('select public.efl_runtime_read($1,$2::jsonb) as value', ['preview', JSON.stringify({collection, filters: [{field: '__name__', op: 'in', value: values}], ...extra})]);
      assert.equal(result.rows[0].value.generation, generation);
      return result.rows[0].value;
    };
    const docIds = (result: any) => result.documents.map((doc: any) => doc.id);
    assert.deepEqual(docIds(await read(['zulu', 'alpha', 'alpha', 'missing'])), ['alpha', 'zulu']);
    assert.deepEqual(docIds(await read([])), []);
    assert.deepEqual(docIds(await read([123, null, true, ['alpha'], {id: 'alpha'}])), []);
    assert.deepEqual(docIds(await read([123, '123', "quote'Id", 'o‘zbek'])), ['123', 'o‘zbek', "quote'Id"]);
    assert.deepEqual(docIds(await read(ids, {orders: [{field: '__name__', direction: 'desc'}], limit: 2})), ['zulu', "quote'Id"]);
    assert.deepEqual(docIds(await read(ids, {cursor: {id: 'alpha', data: {rank: 1}}})), ['o‘zbek', "quote'Id", 'zulu']);
    assert.equal((await read(ids, {count: true, limit: 2})).count, 2);
    assert.deepEqual(docIds(await read(ids, {filters: [{field: '__name__', op: 'in', value: ids}, {field: 'rank', op: '>=', value: 3}]})), ['o‘zbek', 'zulu']);
    // A large collection ensures the planner has a meaningful choice.
    await pg.exec(`insert into efl_runtime.documents(space,collection_path,document_id,encoded,data)
      select 'preview','indexed_id_plan',md5(n::text),'{"type":"map","value":{}}','{}' from generate_series(1,10000) n;
      analyze efl_runtime.documents;`);
    const plan = (await pg.query(`explain select document_id from efl_runtime.documents
      where space='preview' and collection_path='indexed_id_plan'
      and document_id = any(array(select ids.value #>> '{}' from jsonb_array_elements('["missing-a","missing-b",123,null]'::jsonb) as ids(value) where jsonb_typeof(ids.value)='string'))`)).rows;
    const detail = JSON.stringify(plan);
    assert.match(detail, /Index (Only )?Scan|Bitmap Index Scan/);
    assert.match(detail, /Index Cond[^\n]*document_id/);
    const privileges = (await pg.query(`select has_function_privilege('anon','public.efl_runtime_read(text,jsonb)','execute') as anon,
      has_function_privilege('authenticated','public.efl_runtime_read(text,jsonb)','execute') as authenticated,
      has_function_privilege('service_role','public.efl_runtime_read(text,jsonb)','execute') as service,
      (select prosecdef from pg_proc where oid='public.efl_runtime_read(text,jsonb)'::regprocedure) as definer`)).rows[0];
    assert.deepEqual(privileges, {anon: false, authenticated: false, service: true, definer: false});
    console.log('Indexed document-ID SQL audit passed: typed membership, cursors, limits, counts, primary-key plan, private grants.');
  } finally {
    await pg.exec('rollback');
  }
}
