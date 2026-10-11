import { randomUUID } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import { createAiTournamentReader } from './telegramAiDataService';
import { withinAiDeadline } from './telegramAiDeadline';
import { getAiResponsePolicy, type AiResponsePolicy } from './telegramAiResponsePolicy';

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
      matchday: { type: 'integer' }, matchdayTo: { type: 'integer', description: 'Inclusive upper round bound; hozirgacha means up to currentMatchday, including earlier rounds, excluding future rounds.' },
      fixtureState: { type: 'string', enum: ['unplayed', 'awaiting_confirmation', 'disputed', 'unfinished', 'confirmed'], description: 'unplayed = SCHEDULED/POSTPONED only. Submitted/disputed games are not proven unplayed. unfinished = all non-confirmed games.' },
      status: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' },
    },
  },
};

/** Answer budgets depend on the requested depth, with fixed ceilings and a shared deadline.
 * At most four queries per round; cached pages never remove coverage/uncertainty metadata.
 * Tool calls cannot request arbitrary database paths or execute administration. */
export async function generateGroundedTelegramAnswer(options: {
  ai: GoogleGenAI; model: string; contents: any[]; systemPrompt: string; signal: AbortSignal;
  generate?: (request: any) => Promise<any>; read?: (args: unknown) => Promise<unknown>; deadlineAt?: number;
  maxToolRounds?: number;
  responsePolicy?: AiResponsePolicy;
  extraReadTools?: Array<{ declaration: any; run: (args: unknown) => Promise<unknown> }>;
}): Promise<string> {
  const policy = options.responsePolicy || getAiResponsePolicy('');
  const signal = options.deadlineAt === undefined ? options.signal : AbortSignal.any([
    options.signal, AbortSignal.timeout(Math.max(0, options.deadlineAt - Date.now())),
  ]);
  if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) throw new Error('TIMEOUT_ABORTED');
  const generate = options.generate || ((request: any) => options.ai.models.generateContent(request));
  const rawRead = options.read || createAiTournamentReader(signal).read;
  const memo = new Map<string, unknown>();
  let cacheHits = 0;
  let reads = 0;
  const maxReads = Math.min(24, Math.max(1, policy.maxReadCalls * 2));
  const traceId = randomUUID();
  const read = async (args: any): Promise<any> => {
    const key = JSON.stringify(args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))) : args);
    if (key && memo.has(key)) { cacheHits++; return memo.get(key); }
    if (++reads > maxReads) return { error: 'READ_BUDGET_EXCEEDED', complete: false };
    const result: any = await rawRead(args);
    if (key && result && !result.error) memo.set(key, result);
    return result;
  };
  const safeRead = async (operation: () => Promise<any>): Promise<any> => {
    try { return await withinAiDeadline(signal, operation) || { error: 'READ_EMPTY_RESPONSE' }; }
    catch (error: any) {
      if (signal.aborted) throw new Error('TIMEOUT_ABORTED');
      if (String(error?.message || '').startsWith('CLARIFY:')) return { error: 'ENTITY_CLARIFICATION', message: error.message.slice(8, 308), complete: false };
      return { error: 'READ_UNAVAILABLE', complete: false, message: 'So‘ralgan manba hozir o‘qilmadi. Yo‘q ma’lumotni taxmin qilmang.' };
    }
  };
  let retriedBusy = false;
  const requestModel = async (request: any): Promise<any> => {
    try { return await withinAiDeadline(signal, () => generate(request)); }
    catch (error) {
      // Read-only generation only: one retry across both rounds, with time reserved for delivery.
      if (retriedBusy || signal.aborted || aiProviderFailureKind(error) !== 'busy' || !options.deadlineAt || options.deadlineAt - Date.now() < 2500) throw error;
      retriedBusy = true;
      console.warn('[AI GEMINI RETRY] Busy provider; one bounded retry');
      return withinAiDeadline(signal, () => generate(request));
    }
  };
  const config = { systemInstruction: options.systemPrompt, temperature: 0.65, maxOutputTokens: Math.min(1200, Math.max(400, policy.maxOutputTokens)), abortSignal: signal };
  const rounds = Math.min(4, Math.max(1, options.maxToolRounds || policy.maxToolRounds));
  const maxCalls = Math.min(12, Math.max(1, policy.maxReadCalls));
  const maxPages = Math.min(5, Math.max(1, policy.maxReadPages));
  const declarations = [tournamentReadTool, ...(options.extraReadTools || []).map(tool => tool.declaration)];
  let contents = [...options.contents];
  let first = await requestModel({ model: options.model, contents, config: { ...config, tools: [{ functionDeclarations: declarations }] } });
  let totalCalls = 0;
  for (let round = 0; round < rounds; round++) {
  const calls = first.functionCalls || [];
  if (!calls.length) return answerText(first);
  totalCalls += calls.length;
  if (calls.length > 4 || totalCalls > maxCalls || calls.some((call: any) => !declarations.some(tool => tool.name === call.name))) return 'So‘rovni aniqroq yozing: jamoa, turnir va kerakli tur yoki bosqichni ko‘rsating.';
  const responses = [];
  for (const call of calls) {
    const extra = options.extraReadTools?.find(tool => tool.declaration.name === call.name);
    const startedAt = Date.now(), previousCacheHits = cacheHits;
    let result:any = await safeRead(() => extra ? extra.run(call.args) : read(call.args));
    // Continue a long list without another model call, bounded by the same global deadline.
    if(!extra && !result.error && Array.isArray(result.data)){
      result={...result,data:[...result.data]};
      let pageOffset = result.offset ?? call.args?.offset ?? 0;
      for(let page=1;page<maxPages && Number.isInteger(result.nextOffset);page++){
        if (result.nextOffset <= pageOffset || options.deadlineAt !== undefined && options.deadlineAt - Date.now() < 1800) {
          result = { ...result, complete: false, paginationError: 'INCOMPLETE_PAGE' }; break;
        }
        const next:any=await safeRead(()=>read({...call.args,offset:result.nextOffset}));
        if(next.error || !Array.isArray(next.data) || next.offset!==result.nextOffset || !next.data.length){
          result={...result,complete:false,paginationError:next.error||'INCOMPLETE_PAGE'};break;
        }
        pageOffset = next.offset;
        result={...result,data:[...result.data,...next.data],nextOffset:next.nextOffset,stale:Boolean(result.stale||next.stale),complete:result.complete!==false&&next.complete!==false,
          missingDatasets:[...new Set([...(result.missingDatasets||[]),...(next.missingDatasets||[])])],failedDatasets:[...new Set([...(result.failedDatasets||[]),...(next.failedDatasets||[])])]};
      }
      result.truncated=Number.isInteger(result.nextOffset);
    }
    console.info('[AI_READ_TOOL]', JSON.stringify({ traceId, tool: call.name, round: round + 1, durationMs: Date.now() - startedAt,
      outcome: result.error ? 'error' : 'ok', cacheHits: cacheHits - previousCacheHits,
      rowsReturned: Array.isArray(result.data) ? result.data.length : undefined,
      stale: result.stale === true, incomplete: result.complete === false || result.truncated === true }));
    responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
  }
  const modelContent = first.candidates?.[0]?.content;
  if (!modelContent) return 'Ma’lumot so‘rovini yakunlab bo‘lmadi. Qayta urinib ko‘ring.';
  contents = [...contents, modelContent, { role: 'user', parts: responses }];
  first = await requestModel({ model: options.model, contents, config: round + 1 < rounds && (!options.deadlineAt || options.deadlineAt - Date.now() >= 1800) ? { ...config, tools: [{ functionDeclarations: declarations }] } : config });
  }
  if (first.functionCalls?.length) throw new Error('CLARIFY:Qidiruvni bitta amal bilan aniqlashtiring. Klub, foydalanuvchi yoki turdan qaysi biri kerak?');
  return answerText(first);
}
