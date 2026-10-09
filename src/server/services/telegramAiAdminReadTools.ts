import { z } from 'zod';
import { AI_ADMIN_ACTIONS, adminPlanSchema, type AdminPlan } from './telegramAiAdminCatalog';
import { assertAiAdminActionAllowed, isAiAdminActor } from './telegramAiAdminAccess';
import { executeAiAdminRoute } from './telegramAiAdminGateway';
import type { TelegramAiMessagePayload } from './telegramAiService';

const readActions = Object.keys(AI_ADMIN_ACTIONS).filter(key => AI_ADMIN_ACTIONS[key].method === 'GET');
const querySchema = z.object({
  action: z.string().max(80), targetId: z.string().max(180).optional(),
  section: z.string().max(180).regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,4}$/).optional(),
  offset: z.number().int().min(0).max(10000).default(0),
  query: z.record(z.string(), z.union([z.string().max(180), z.number().finite(), z.boolean()])).default({}),
}).strict().refine(value => Object.keys(value.query).length <= 15, 'Too many query fields');
const secretKey = /token|secret|password|credential|authorization|cookie|initdata|api.?key|private.?key|service.?account/i;

/** Bound every result, including singleton objects. Never pass credentials to the model. */
export function projectAiAdminData(value: unknown): { data: unknown; truncated: boolean } {
  let truncated = false, remaining = 14000;
  function visit(input: any, depth: number): any {
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') {
      const length = Math.min(input.length, 1000, Math.max(0, remaining));
      remaining -= length; if (length < input.length) truncated = true;
      return input.slice(0, length);
    }
    if (depth > 7 || remaining <= 0) { truncated = true; return null; }
    if (Array.isArray(input)) {
      if (input.length > 30) truncated = true;
      return input.slice(0, 30).map(item => visit(item, depth + 1));
    }
    if (typeof input === 'object') {
      const entries = Object.entries(input).filter(([key]) => !secretKey.test(key));
      if (entries.length > 60) truncated = true;
      const result: Record<string, unknown> = {};
      for (const [key, item] of entries.slice(0, 60)) { remaining -= key.length; result[key] = visit(item, depth + 1); }
      return result;
    }
    return null;
  }
  const data = visit(value, 0);
  return { data, truncated };
}

export function isAiPrivateActorChat(payload: TelegramAiMessagePayload): boolean {
  return Number.isSafeInteger(payload.fromUser?.id) && isAiAdminActor(payload.fromUser.id)
    && !payload.fromUser.is_bot && payload.chatId === payload.fromUser.id && payload.threadId === 0
    && !payload.senderChat && !payload.forwarded;
}

/** Only direct, verified actor DMs get private tools. The real route rechecks current
 * account, suspension and league permissions on EVERY read, never model authority. */
export function createAiAdminReadTools(payload: TelegramAiMessagePayload, signal: AbortSignal,
  execute: typeof executeAiAdminRoute = executeAiAdminRoute) {
  const privateActor = () => isAiPrivateActorChat(payload);
  if (!privateActor()) return [];
  return [{ declaration: {
    name: 'read_admin_data',
    description: 'Read protected EFL UZ admin data in this authorized private chat. Use capabilities to discover permitted actions and fields; runtime account and league permissions still apply. Fixed GET actions only: users, user detail, submissions, pending results, disputes, audit, match operations, settings, notifications, admission, metrics, season control and tournament management. Exact target IDs; query uses catalog fields, bounded pages/limits. No writes. For truncated arrays request section plus offset to inspect later rows; database query.page/cursor and section offset are different. Never infer full database coverage from a route response or invent missing facts.',
    parametersJsonSchema: { type: 'object', required: ['action'], additionalProperties: false, properties: {
      action: { type: 'string', enum: ['capabilities', ...readActions] }, targetId: { type: 'string' },
      section: { type: 'string', description: 'Optional returned JSON array section (e.g. users, disputes, noShowReports or archive.standings); select a list to page through the entire route response without skipping rows.' },
      offset: { type: 'integer', description: 'Offset within section, 30 rows per local page. Use nextOffset; separate from database query.page/cursor.' },
      query: { type: 'object', additionalProperties: false, properties: {
        clubId: { type: 'string' }, seasonId: { type: 'string' }, leagueId: { type: 'string' }, competitionId: { type: 'string' },
        includeArchive: { type: 'string', enum: ['0', '1'] }, fixtureId: { type: 'string' }, userId: { type: 'string' }, search: { type: 'string' }, status: { type: 'string' }, cursor: { type: 'string' },
        matchday: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' }, limit: { type: 'integer' },
      } },
    } },
  }, run: async (input: unknown) => {
    if (!privateActor()) return { error: 'PRIVATE_ADMIN_CHAT_REQUIRED' };
    if (signal.aborted) return { error: 'READ_DEADLINE_EXCEEDED' };
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) return { error: 'INVALID_ADMIN_READ_QUERY' };
    const { action, targetId, query, section, offset } = parsed.data;
    if (offset && !section) return { error: 'READ_SECTION_REQUIRED' };
    if (action === 'capabilities') {
      const actions = Object.entries(AI_ADMIN_ACTIONS).filter(([name]) => {
        try { assertAiAdminActionAllowed(payload.fromUser.id, { action: name, body: {} }); return true; } catch { return false; }
      }).map(([name, spec]) => ({ action: name, method: spec.method, targetRequired: spec.path.includes(':id'), fields: spec.fields }));
      return { actions, writesRequireConfirmation: true, applicationPermissionsRequired: true, dangerActionsPrimaryOwnerOnly: true };
    }
    if (!readActions.includes(action)) return { error: 'READ_ONLY_ACTION_REQUIRED' };
    const spec = AI_ADMIN_ACTIONS[action];
    const allowed = spec.fields.split(',').map(field => field.trim().replace(/\?.*|:.*/g, '')).filter(Boolean);
    if (Object.keys(query).some(key => !allowed.includes(key))) return { error: 'INVALID_QUERY_FIELD', allowed };
    for (const key of ['limit', 'pageSize']) if (query[key] !== undefined) {
      if (!Number.isInteger(query[key]) || Number(query[key]) < 1) return { error: 'INVALID_PAGE_SIZE' };
      query[key] = Math.min(30, Number(query[key]));
    }
    if (allowed.includes('limit') && query.limit === undefined) query.limit = 30;
    if (allowed.includes('pageSize') && query.pageSize === undefined) query.pageSize = 30;
    if (allowed.includes('page') && query.page === undefined) query.page = 1;
    if (query.page !== undefined && (!Number.isInteger(query.page) || Number(query.page) < 1 || Number(query.page) > 10000)) return { error: 'INVALID_PAGE' };
    const plan = adminPlanSchema.safeParse({ action, targetId, body: query });
    if (!plan.success) return { error: 'EXACT_TARGET_ID_REQUIRED' };
    try {
      assertAiAdminActionAllowed(payload.fromUser.id, plan.data as AdminPlan);
      const response = await execute(plan.data, payload.fromUser.id, `ai-read-${payload.updateId}-${action}`, signal);
      if (response.status < 200 || response.status >= 300) return { error: response.status === 403 ? 'ADMIN_PERMISSION_DENIED' : 'ADMIN_READ_UNAVAILABLE', status: response.status };
      if (section) {
        let rows = response.data;
        for (const key of section.split('.')) {
          if (secretKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !rows || !Object.hasOwn(rows, key)) return { error: 'INVALID_READ_SECTION' };
          rows = rows[key];
        }
        if (!Array.isArray(rows)) return { error: 'READ_SECTION_NOT_A_LIST' };
        return { action, query, section, offset, total: rows.length, nextOffset: offset + 30 < rows.length ? offset + 30 : null,
          ...projectAiAdminData(rows.slice(offset, offset + 30)),
          routeMetadata: projectAiAdminData(Object.fromEntries(['source', 'stale', 'degraded', 'total', 'page', 'hasMore', 'nextCursor'].filter(key => Object.hasOwn(response.data, key)).map(key => [key, response.data[key]]))).data,
          coverage: 'route_response_section', permissionsChecked: true };
      }
      return { action, query, ...projectAiAdminData(response.data), coverage: 'route_response', permissionsChecked: true };
    } catch (error: any) {
      if (/OWNER_ONLY|OWNER_AUTHORIZATION|asosiy admin/.test(String(error?.message))) return { error: 'ADMIN_PERMISSION_DENIED' };
      return { error: signal.aborted ? 'READ_DEADLINE_EXCEEDED' : 'ADMIN_READ_UNAVAILABLE' };
    }
  } }];
}
