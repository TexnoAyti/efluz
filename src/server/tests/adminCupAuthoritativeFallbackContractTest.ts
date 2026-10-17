import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/server/tournament/domesticCupService.ts', 'utf8');
const start = source.indexOf('export async function getDomesticCupDetails');
const end = source.indexOf('export async function previewDomesticCupBracket', start);
const details = source.slice(start, end);

assert(details.includes('const [compDoc, fixSnap] = await Promise.all(['), 'competition and fixtures must be authoritative reads');
assert(details.includes('Promise.allSettled(['), 'participant and ownership reads must be optional');
assert(details.includes("source: 'redis-lkg'"), 'verified Redis bracket must precede SQLite fallback');
assert(details.indexOf("source: 'redis-lkg'") < details.indexOf('// Fallback to SQLite'), 'Redis bracket fallback must run before SQLite');

console.log('Admin cup authoritative fallback contract: PASS');
