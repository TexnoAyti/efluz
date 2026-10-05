import type { GoogleGenAI } from '@google/genai';
import { createAiTournamentReader } from './telegramAiDataService';
import { withinAiDeadline } from './telegramAiDeadline';

export const tournamentReadTool = {
  name: 'read_tournament_data',
  description: 'Search the complete EFL UZ active-season database snapshots: all competitions, clubs and public owners, fixtures, standings, statistics. Use for facts missing from the initial packet; never assume missing initial facts mean missing database data. Errors ENTITY_CLARIFICATION/AMBIGUOUS_* require asking the user, never silently changing filters. complete=false means only partial cached coverage; disclose stale data, never claim missing fixtures are not scheduled. Supports exact IDs or full names, semifinal/final, matchday, opponent, owner username and pagination. No writes or private fields.',
  parametersJsonSchema: {
    type: 'object', required: ['dataset'], additionalProperties: false,
    properties: {
      dataset: { type: 'string', enum: ['competitions', 'clubs', 'fixtures', 'standings', 'statistics'] },
      competition: { type: 'string' }, club: { type: 'string' }, opponent: { type: 'string' },
      ownerUsername: { type: 'string' }, fixtureId: { type: 'string' }, stage: { type: 'string' },
      matchday: { type: 'integer' }, status: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' },
    },
  },
};

/** Exactly one read-tool round, at most four validated queries, then an answer.
 * Tool calls cannot request arbitrary database paths or execute administration. */
export async function generateGroundedTelegramAnswer(options: {
  ai: GoogleGenAI; model: string; contents: any[]; systemPrompt: string; signal: AbortSignal;
  generate?: (request: any) => Promise<any>; read?: (args: unknown) => Promise<unknown>;
}): Promise<string> {
  const generate = options.generate || ((request: any) => options.ai.models.generateContent(request));
  const read = options.read || createAiTournamentReader(options.signal).read;
  const config = { systemInstruction: options.systemPrompt, temperature: 0.4, maxOutputTokens: 400, abortSignal: options.signal };
  const first = await withinAiDeadline(options.signal, () => generate({ model: options.model, contents: options.contents, config: { ...config, tools: [{ functionDeclarations: [tournamentReadTool] }] } }));
  const calls = first.functionCalls || [];
  if (!calls.length) return first.text?.trim() || '';
  if (calls.length > 4 || calls.some((call: any) => call.name !== tournamentReadTool.name)) return 'So‘rovni aniqroq yozing: jamoa, turnir va kerakli tur yoki bosqichni ko‘rsating.';
  const responses = [];
  for (const call of calls) {
    let result:any = await withinAiDeadline(options.signal, () => read(call.args));
    // Continue a long list without another model call, bounded by the same global deadline.
    if(!result.error && Array.isArray(result.data)){
      result={...result,data:[...result.data]};
      for(let page=1;page<3 && Number.isInteger(result.nextOffset);page++){
        const next:any=await withinAiDeadline(options.signal,()=>read({...call.args,offset:result.nextOffset}));
        if(next.error || !Array.isArray(next.data) || next.offset!==result.nextOffset || !next.data.length){
          result={...result,complete:false,paginationError:next.error||'INCOMPLETE_PAGE'};break;
        }
        result={...result,data:[...result.data,...next.data],nextOffset:next.nextOffset,stale:Boolean(result.stale||next.stale),complete:result.complete!==false&&next.complete!==false,
          missingDatasets:[...new Set([...(result.missingDatasets||[]),...(next.missingDatasets||[])])],failedDatasets:[...new Set([...(result.failedDatasets||[]),...(next.failedDatasets||[])])]};
      }
      result.truncated=Number.isInteger(result.nextOffset);
    }
    responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
  }
  const modelContent = first.candidates?.[0]?.content;
  if (!modelContent) return 'Ma’lumot so‘rovini yakunlab bo‘lmadi. Qayta urinib ko‘ring.';
  const final = await withinAiDeadline(options.signal, () => generate({ model: options.model, contents: [...options.contents, modelContent, { role: 'user', parts: responses }], config }));
  return final.text?.trim() || '';
}
