import type { GoogleGenAI } from '@google/genai';
import { createAiTournamentReader } from './telegramAiDataService';
import { withinAiDeadline } from './telegramAiDeadline';

export const AI_CLARIFICATION_REPLY = 'Savolni aniq tushunmadim. Qaysi jamoa yoki turnir haqida, nimani bilmoqchisiz?';

export function aiProviderFailureKind(error: any): 'busy' | 'quota' | 'connection' {
  let details = error;
  try { details = JSON.parse(String(error?.message || '')); } catch { /* SDK may expose a plain message. */ }
  const code = Number(details?.error?.code || details?.code || error?.status || error?.code);
  const message = String(error?.message || '').toLowerCase();
  if (code === 429 || /resource_exhausted|quota|\b429\b/.test(message)) return 'quota';
  if (code === 503 || /\b503\b|unavailable|high demand/.test(message)) return 'busy';
  return 'connection';
}

function answerText(response: any): string {
  const text = response.text?.trim();
  if (text) return text;
  if (response.promptFeedback?.blockReason || response.candidates?.some((c: any) => ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION'].includes(c.finishReason))) {
    return 'Bu savolga javob tayyorlay olmadim. Boshqacha yozib ko‘ring.';
  }
  return AI_CLARIFICATION_REPLY;
}

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

/** Public requests use one read-tool round; admin planning permits up to three.
 * At most four validated queries per round and eight overall, then an answer.
 * Tool calls cannot request arbitrary database paths or execute administration. */
export async function generateGroundedTelegramAnswer(options: {
  ai: GoogleGenAI; model: string; contents: any[]; systemPrompt: string; signal: AbortSignal;
  generate?: (request: any) => Promise<any>; read?: (args: unknown) => Promise<unknown>; deadlineAt?: number;
  maxToolRounds?: number;
  extraReadTools?: Array<{ declaration: any; run: (args: unknown) => Promise<unknown> }>;
}): Promise<string> {
  const generate = options.generate || ((request: any) => options.ai.models.generateContent(request));
  const read = options.read || createAiTournamentReader(options.signal).read;
  let retriedBusy = false;
  const requestModel = async (request: any): Promise<any> => {
    try { return await withinAiDeadline(options.signal, () => generate(request)); }
    catch (error) {
      // Read-only generation only: one retry across both rounds, with time reserved for delivery.
      if (retriedBusy || options.signal.aborted || aiProviderFailureKind(error) !== 'busy' || !options.deadlineAt || options.deadlineAt - Date.now() < 2500) throw error;
      retriedBusy = true;
      console.warn('[AI GEMINI RETRY] Busy provider; one bounded retry');
      return withinAiDeadline(options.signal, () => generate(request));
    }
  };
  const config = { systemInstruction: options.systemPrompt, temperature: 0.65, maxOutputTokens: 400, abortSignal: options.signal };
  const rounds = Math.min(3, Math.max(1, options.maxToolRounds || 1));
  const declarations = [tournamentReadTool, ...(options.extraReadTools || []).map(tool => tool.declaration)];
  let contents = [...options.contents];
  let first = await requestModel({ model: options.model, contents, config: { ...config, tools: [{ functionDeclarations: declarations }] } });
  let totalCalls = 0;
  for (let round = 0; round < rounds; round++) {
  const calls = first.functionCalls || [];
  if (!calls.length) return answerText(first);
  totalCalls += calls.length;
  if (calls.length > 4 || totalCalls > 8 || calls.some((call: any) => !declarations.some(tool => tool.name === call.name))) return 'So‘rovni aniqroq yozing: jamoa, turnir va kerakli tur yoki bosqichni ko‘rsating.';
  const responses = [];
  for (const call of calls) {
    const extra = options.extraReadTools?.find(tool => tool.declaration.name === call.name);
    let result:any = await withinAiDeadline(options.signal, () => extra ? extra.run(call.args) : read(call.args));
    // Continue a long list without another model call, bounded by the same global deadline.
    if(!extra && !result.error && Array.isArray(result.data)){
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
  contents = [...contents, modelContent, { role: 'user', parts: responses }];
  first = await requestModel({ model: options.model, contents, config: round + 1 < rounds ? { ...config, tools: [{ functionDeclarations: declarations }] } : config });
  }
  if (first.functionCalls?.length) throw new Error('CLARIFY:Qidiruvni bitta amal bilan aniqlashtiring. Klub, foydalanuvchi yoki turdan qaysi biri kerak?');
  return answerText(first);
}
