import { createAiTournamentReader } from './telegramAiDataService';
import { resolveAiClubs } from './telegramAiEntities';
import { z } from 'zod';
import { isAiPrivateActorChat } from './telegramAiAdminReadTools';
import { executeAiAdminRoute } from './telegramAiAdminGateway';
import { validateModelAdminPlan } from './telegramAiAdminPlanReadiness';
import type { TelegramAiMessagePayload } from './telegramAiService';

const schema = z.object({ dataset: z.enum(['disputes', 'submissions', 'no_show_reports']), fixtureId: z.string().regex(/^[A-Za-z0-9_:-]{1,180}$/) }).strict();
const sources = {
  disputes: { action: 'disputes', field: 'disputes', limit: 30, writes: ['dispute_resolve', 'match_dispute_resolve'] },
  submissions: { action: 'submissions', field: 'submissions', limit: 30, writes: ['submission_delete'] },
  no_show_reports: { action: 'match_operations', field: 'noShowReports', limit: 150, writes: ['no_show_resolve'] },
};

/** IDs are trusted only after a protected read resolves exactly one record for the
 * explicitly requested fixture. Evidence lives for this one planning call only. */
export function createAiAdminRecordResolver(payload: TelegramAiMessagePayload | undefined, request: string, signal: AbortSignal,
  execute: typeof executeAiAdminRoute = executeAiAdminRoute) {
  const verifiedTargets = new Set<string>();
  const fixtureIds = new Map<string, string>();
  const memo = new Map<string, Promise<{ status: number; data: any }>>();
  if (!payload || !isAiPrivateActorChat(payload)) return { tools: [], verifiedTargets, fixtureIds };
  return { verifiedTargets, fixtureIds, tools: [{ declaration: {
    name: 'resolve_admin_record',
    description: 'Find the exact private dispute, submission or no-show report ID for a fixture already identified from the user request. Protected read only. Exactly one current matching record is required; ambiguous or incomplete sources require clarification. This grants no permission and never executes a write.',
    parametersJsonSchema: { type: 'object', required: ['dataset', 'fixtureId'], additionalProperties: false,
      properties: { dataset: { type: 'string', enum: ['disputes', 'submissions', 'no_show_reports'] }, fixtureId: { type: 'string' } } },
  }, run: async (raw: unknown) => {
    if (!isAiPrivateActorChat(payload)) return { error: 'PRIVATE_ADMIN_CHAT_REQUIRED' };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { error: 'INVALID_RECORD_QUERY' };
    const { dataset, fixtureId } = parsed.data;
    // Reuse public target checks: wrong club/round and invented fixture IDs fail.
    await validateModelAdminPlan({ action: 'result_clear', targetId: fixtureId, body: {} }, request, signal);
    const fixtureResult: any = await createAiTournamentReader(signal).read({ dataset: 'fixtures', fixtureId, limit: 1 });
    if (!fixtureResult.complete || fixtureResult.stale || fixtureResult.data?.length !== 1) return { error: 'RECORD_SOURCE_INCOMPLETE' };
    const fixture = fixtureResult.data[0];
    const named = resolveAiClubs(request, [{ id: fixture.homeClubId, name: fixture.home }, { id: fixture.awayClubId, name: fixture.away }] as any);
    if (!request.includes(fixtureId) && (named.clarification || named.clubs.length !== 2)) return { error: 'EXPLICIT_FIXTURE_REQUIRED', message: 'Qaysi o‘yin? Ikkala jamoa va tur/bosqichni aniqlashtiring.' };
    const source = sources[dataset];
    const body = dataset === 'submissions' ? { fixtureId, limit: source.limit } : dataset === 'disputes' ? { status: 'OPEN', limit: source.limit } : {};
    const key = dataset + (dataset === 'submissions' ? ':' + fixtureId : '');
    if (!memo.has(key)) memo.set(key, execute({ action: source.action, body }, payload.fromUser.id, 'ai-resolve-' + payload.updateId, signal));
    const response = await memo.get(key)!;
    if (response.status !== 200) return { error: response.status === 403 ? 'ADMIN_PERMISSION_DENIED' : 'RECORD_SOURCE_UNAVAILABLE' };
    const data = response.data, rows = data?.[source.field];
    if (!Array.isArray(rows) || data.stale || data.degraded || data.pendingSync || rows.length >= source.limit || data.hasMore || data.nextCursor)
      return { error: 'RECORD_SOURCE_INCOMPLETE', message: 'Joriy ro‘yxat to‘liq tekshirilmadi. Aniq ID yoki qo‘shimcha aniqlik kerak.' };
    const matches = rows.filter(row => row.fixtureId === fixtureId && (dataset === 'submissions' || ['OPEN', 'UNDER_REVIEW'].includes(row.status)));
    if (matches.length !== 1) return { error: matches.length ? 'AMBIGUOUS_RECORD' : 'RECORD_NOT_FOUND', matches: matches.length };
    const row = matches[0];
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_:-]{1,180}$/.test(row.id)) return { error: 'INVALID_RECORD_ID' };
    fixtureIds.set(row.id, fixtureId);
    for (const action of source.writes) verifiedTargets.add(`${action}:${row.id}`);
    return { id: row.id, fixtureId, dataset, status: row.status, verified: true };
  } }] };
}
