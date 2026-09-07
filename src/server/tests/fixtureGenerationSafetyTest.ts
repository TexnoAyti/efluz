import assert from 'node:assert/strict';
import { assertNonDestructiveFixtureGeneration } from '../firebase/fixtureGenerationSafety';

assert.doesNotThrow(() => assertNonDestructiveFixtureGeneration({ force: false }));
assert.doesNotThrow(() => assertNonDestructiveFixtureGeneration({}));
assert.throws(
  () => assertNonDestructiveFixtureGeneration({ force: true }),
  /NON_DESTRUCTIVE_FIXTURE_POLICY/
);

console.log('PASS: fixture generation safety contract');
