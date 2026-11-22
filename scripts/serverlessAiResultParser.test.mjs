import assert from 'node:assert/strict';
import {parseScoreText, aiProviderStatus} from '../tgcloud/lib/aiResultParser.js';

assert.deepEqual(parseScoreText('Barcelona 2-1 Real Madrid'), {
  home: 'Barcelona', away: 'Real Madrid', homeScore: 2, awayScore: 1,
  source: 'text-fallback', needsConfirmation: true,
});
assert.equal(parseScoreText('natija: 2-1'), null);
assert.equal(parseScoreText('Barcelona ikki bir Real Madrid'), null);
assert.equal(aiProviderStatus().writesResults, false);
console.log('serverless AI result parser tests: ok');
