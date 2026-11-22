import {EndpointError} from 'sdk';
import {aiProviderStatus, parseScoreText} from '../lib/aiResultParser.js';

// Serverless AI entry point. Until a platform secret/provider is configured,
// only deterministic text extraction is enabled. No database mutation occurs.
export default async function(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new EndpointError('AI so‘rovi noto‘g‘ri.', {code: 'INVALID_AI_INPUT'});
  const text = typeof input.text === 'string' ? input.text : '';
  const result = parseScoreText(text);
  return {ok: true, provider: aiProviderStatus(), result};
}
