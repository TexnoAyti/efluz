import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

export type SmartNotificationEvent =
  | 'resultVerification'
  | 'resultConfirmed'
  | 'resultDisputed'
  | 'nextOpponent'
  | 'matchdayOpened'
  | 'cupProgress'
  | 'qualification'
  | 'europeanOutcome';

export interface SmartNotificationSettings {
  seasonId: string;
  enabled: boolean;
  events: Record<SmartNotificationEvent, boolean>;
  updatedAt?: string;
  updatedBy?: string;
}

// Short cache keeps admin toggles responsive across serverless instances without Firestore reads.
const SETTINGS_TTL_MS = 15_000;
const memory = new Map<string, { value: SmartNotificationSettings; expiresAt: number }>();

export const DEFAULT_SMART_NOTIFICATION_EVENTS: Record<SmartNotificationEvent, boolean> = {
  resultVerification: true,
  resultConfirmed: true,
  resultDisputed: true,
  nextOpponent: true,
  matchdayOpened: true,
  cupProgress: true,
  qualification: true,
  europeanOutcome: true,
};

export function defaultSmartNotificationSettings(seasonId = 'season-2026-27'): SmartNotificationSettings {
  return {
    seasonId,
    enabled: true,
    events: { ...DEFAULT_SMART_NOTIFICATION_EVENTS },
  };
}

function settingsKey(seasonId: string): string {
  return `${KEY_PREFIX}:telegram:smart:settings:${seasonId}`;
}

function normalizeSettings(raw: Partial<SmartNotificationSettings> | null | undefined, seasonId: string): SmartNotificationSettings {
  const base = defaultSmartNotificationSettings(seasonId);
  return {
    seasonId,
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : base.enabled,
    events: {
      ...base.events,
      ...(raw?.events || {}),
    },
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
  };
}

export async function getSmartNotificationSettings(
  seasonId = 'season-2026-27'
): Promise<SmartNotificationSettings> {
  const cached = memory.get(seasonId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const client = getUpstashClient();
  if (!client) {
    const fallback = defaultSmartNotificationSettings(seasonId);
    memory.set(seasonId, { value: fallback, expiresAt: Date.now() + SETTINGS_TTL_MS });
    return fallback;
  }

  try {
    const raw = await client.get<SmartNotificationSettings>(settingsKey(seasonId));
    const value = normalizeSettings(raw, seasonId);
    memory.set(seasonId, { value, expiresAt: Date.now() + SETTINGS_TTL_MS });
    return value;
  } catch (error: any) {
    console.warn('[SMART_NOTIFY_SETTINGS] Redis read failed, using safe defaults:', error?.message || error);
    const fallback = defaultSmartNotificationSettings(seasonId);
    memory.set(seasonId, { value: fallback, expiresAt: Date.now() + SETTINGS_TTL_MS });
    return fallback;
  }
}

export async function updateSmartNotificationSettings(params: {
  seasonId?: string;
  enabled: boolean;
  events: Record<SmartNotificationEvent, boolean>;
  updatedBy: string;
}): Promise<SmartNotificationSettings> {
  const seasonId = params.seasonId || 'season-2026-27';
  const value: SmartNotificationSettings = normalizeSettings({
    enabled: params.enabled,
    events: params.events,
    updatedAt: new Date().toISOString(),
    updatedBy: params.updatedBy,
  }, seasonId);

  const client = getUpstashClient();
  const isHosted = Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.NODE_ENV === 'production');
  if (!client) {
    if (isHosted) throw new Error('SMART_NOTIFICATION_SETTINGS_REDIS_UNAVAILABLE');
    memory.set(seasonId, { value, expiresAt: Number.MAX_SAFE_INTEGER });
    return value;
  }

  await client.set(settingsKey(seasonId), value);
  memory.set(seasonId, { value, expiresAt: Date.now() + SETTINGS_TTL_MS });
  return value;
}

export async function isSmartNotificationEventEnabled(
  seasonId: string,
  event?: SmartNotificationEvent | null
): Promise<boolean> {
  const settings = await getSmartNotificationSettings(seasonId);
  if (!settings.enabled) return false;
  if (!event) return true;
  return settings.events[event] !== false;
}
