import test from 'node:test';
import assert from 'node:assert/strict';
import {rowsEquivalent} from '../tgcloud/lib/importEngine.js';

test('distinct invalid JSON values can never be accepted as equivalent',()=>{
 assert.equal(rowsEquivalent({data:'{broken'},{data:'{other'},['data']),false);
 assert.equal(rowsEquivalent({settings:'{broken'},{settings:'{broken'},['settings']),false);
});
test('equivalent JSON objects with different key order remain idempotent',()=>{
 assert.equal(rowsEquivalent({data:'{"b":2,"a":1}'},{data:{a:1,b:2}},['data']),true);
});
test('different valid JSON values never compare equal',()=>{
 assert.equal(rowsEquivalent({data:'{"a":1}'},{data:{a:2}},['data']),false);
});
