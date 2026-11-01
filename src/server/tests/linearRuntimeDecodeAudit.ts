import assert from 'node:assert/strict';
import type {PGlite} from '@electric-sql/pglite';
import {encodeValue} from '../migration/firestoreArchive';

export async function verifyLinearRuntimeDecode(pg: PGlite) {
  // Differential oracle: the original decoder, confined to this test transaction.
  await pg.exec('begin');
  try {
    await pg.exec(`create function efl_runtime.decode_original(v jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
      declare answer jsonb; entry record; t text:=v->>'type'; begin
      if t='map' then answer:='{}';for entry in select * from jsonb_each(v->'value') loop answer:=answer||jsonb_build_object(entry.key,efl_runtime.decode_original(entry.value));end loop;return answer;
      elsif t='array' then select coalesce(jsonb_agg(efl_runtime.decode_original(value)),'[]') into answer from jsonb_array_elements(v->'value');return answer;
      elsif t='null' then return 'null';
      elsif t in ('number','integer') then return to_jsonb((v->>'value')::numeric);
      elsif t in ('string','boolean','date') then return v->'value';
      elsif t='timestamp' then return to_jsonb(to_char(to_timestamp((v#>>'{value,0}')::numeric+(v#>>'{value,1}')::numeric/1000000000) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
      else return v;end if;end $$;`);
    const samples = [encodeValue({}), encodeValue([]), encodeValue({null: null, nested: [{bool: true, text: "O‘zbek's", num: -1.5}, {}], empty: [], integer: 9007199254740993n, date: new Date('2026-11-01T00:00:00Z')}),
      {type: 'map', value: {timestamp: {type: 'timestamp', value: ['1793491200', 123456000]}, unknown: {type: 'bytes', value: 'AQI='}, missing: {type: 'string'}}}];
    for (const sample of samples) {
      const row = (await pg.query<{equal: boolean}>('select efl_runtime.decode($1::jsonb) is not distinct from efl_runtime.decode_original($1::jsonb) as equal', [JSON.stringify(sample)])).rows[0];
      assert.equal(row.equal, true, 'Stored value semantics must match the original decoder');
    }
    const wide = Object.fromEntries(Array.from({length: 1100}, (_, i) => ['broadcast-' + i, {text: 'x'.repeat(1500), count: i, channels: [1, 2], status: 'sent'}]));
    const encoded = JSON.stringify(encodeValue({value: wide, expiresAt: null}));
    const started = performance.now();
    const value = (await pg.query<{value: any}>('select efl_runtime.decode($1::jsonb) as value', [encoded])).rows[0].value;
    assert.deepEqual(value, {value: wide, expiresAt: null});
    console.log(`Linear runtime decoder: ${encoded.length} bytes / 1100 broadcasts decoded in ${Math.round(performance.now() - started)} ms.`);
    // Exercise actual commit/read consistency; rollback leaves no test documents.
    await pg.query(`select public.efl_runtime_commit_safe('preview',$1::jsonb,null)`, [JSON.stringify([{kind: 'set', path: 'decode_audit/wide', encoded: JSON.parse(encoded)}])]);
    const saved = (await pg.query<{matches: boolean}>(`select data=efl_runtime.decode(encoded) as matches from efl_runtime.documents where space='preview' and collection_path='decode_audit' and document_id='wide'`)).rows[0];
    assert.equal(saved.matches, true);
    console.log('Linear runtime decoder SQL audit passed: original type equivalence and wide-map commit consistency.');
  } finally { await pg.exec('rollback'); }
}
