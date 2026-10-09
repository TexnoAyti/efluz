import { getFirestoreDb } from '../firebase/admin';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import { sendTelegramMessage } from './telegramBotService';
import {
  PREMIUM_DEFAULT_SEASON_ID,
  getPremiumCareerSnapshot,
  getPremiumEntitlement,
} from './premiumService';

export interface PremiumSmartAlertPreferences {
  userId: string;
  seasonId: string;
  enabled: boolean;
  deadlinePriority: boolean;
  qualificationWatch: boolean;
  cupProgress: boolean;
  formMilestones: boolean;
  careerDigest: boolean;
  updatedAt: string;
  updatedBy?: string;
}

function preferencesKey(userId: string, seasonId: string) {
  return `${KEY_PREFIX}:premium:smart-alerts:${seasonId}:${userId}`;
}

export function defaultPremiumSmartAlertPreferences(
  userId: string,
  seasonId = PREMIUM_DEFAULT_SEASON_ID
): PremiumSmartAlertPreferences {
  return {
    userId,
    seasonId,
    enabled: true,
    deadlinePriority: true,
    qualificationWatch: true,
    cupProgress: true,
    formMilestones: true,
    careerDigest: true,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function getPremiumSmartAlertPreferences(
  userId: string,
  seasonId = PREMIUM_DEFAULT_SEASON_ID
): Promise<PremiumSmartAlertPreferences> {
  const client = getUpstashClient();
  if (!client) return defaultPremiumSmartAlertPreferences(userId, seasonId);
  try {
    const stored = await client.get<PremiumSmartAlertPreferences>(preferencesKey(userId, seasonId));
    if (!stored || typeof stored !== 'object') return defaultPremiumSmartAlertPreferences(userId, seasonId);
    return {
      ...defaultPremiumSmartAlertPreferences(userId, seasonId),
      ...stored,
      userId,
      seasonId,
    };
  } catch {
    return defaultPremiumSmartAlertPreferences(userId, seasonId);
  }
}

export async function updatePremiumSmartAlertPreferences(params: {
  userId: string;
  seasonId?: string;
  values: Partial<Pick<PremiumSmartAlertPreferences,
    'enabled' | 'deadlinePriority' | 'qualificationWatch' | 'cupProgress' | 'formMilestones' | 'careerDigest'>>;
  updatedBy: string;
}): Promise<PremiumSmartAlertPreferences> {
  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;
  const current = await getPremiumSmartAlertPreferences(params.userId, seasonId);
  const next: PremiumSmartAlertPreferences = {
    ...current,
    ...params.values,
    userId: params.userId,
    seasonId,
    updatedAt: new Date().toISOString(),
    updatedBy: params.updatedBy,
  };
  const client = getUpstashClient();
  if (!client) throw new Error('PREMIUM_SMART_ALERTS_REDIS_UNAVAILABLE');
  await client.set(preferencesKey(params.userId, seasonId), next);
  return next;
}

export function buildPremiumCareerDigestHtml(params: {
  username?: string;
  career: Awaited<ReturnType<typeof getPremiumCareerSnapshot>>;
}): string {
  const { career } = params;
  const o = career.overall;
  const form = career.form.length ? career.form.join(' · ') : '—';
  const username = params.username ? `@${params.username.replace(/^@/, '')}` : 'Player';
  const club = career.currentClub?.name || 'No active club';
  return [
    '<b>✨ EFL Career Digest</b>',
    '',
    `<b>${username}</b> · ${club}`,
    '<b>Season 2026/27</b>',
    '',
    `🎮 Matches: <b>${o.matches}</b>`,
    `📊 W-D-L: <b>${o.wins}-${o.draws}-${o.losses}</b>`,
    `🎯 Goals: <b>${o.goalsFor}:${o.goalsAgainst}</b> · GD <b>${o.goalDifference >= 0 ? '+' : ''}${o.goalDifference}</b>`,
    `🔥 Win rate: <b>${o.winRate}%</b> · PPG <b>${o.pointsPerMatch}</b>`,
    `🧱 Clean sheets: <b>${o.cleanSheets}</b>`,
    `⚡ Best unbeaten run: <b>${o.longestUnbeatenRun}</b>`,
    `📈 Last five: <b>${form}</b>`,
    '',
    '<i>Your EFL Career keeps tracking official confirmed results throughout the season.</i>',
  ].join('\n');
}

export async function sendPremiumCareerDigest(params: {
  userId: string;
  seasonId?: string;
}): Promise<{ sent: boolean; telegramId: string; preview: string }> {
  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;
  const entitlement = await getPremiumEntitlement(params.userId, seasonId);
  if (entitlement?.status !== 'ACTIVE') throw new Error('PREMIUM_ENTITLEMENT_REQUIRED');

  const prefs = await getPremiumSmartAlertPreferences(params.userId, seasonId);
  if (!prefs.enabled || !prefs.careerDigest) throw new Error('PREMIUM_CAREER_DIGEST_DISABLED');

  const db = getFirestoreDb();
  const userSnap = await db.collection('users').doc(params.userId).get();
  if (!userSnap.exists) throw new Error('PREMIUM_TARGET_USER_NOT_FOUND');
  const user: any = userSnap.data();
  const telegramId = String(user?.telegramId || '').trim();
  if (!telegramId) throw new Error('PREMIUM_TARGET_TELEGRAM_UNAVAILABLE');

  const career = await getPremiumCareerSnapshot(params.userId, seasonId);
  const preview = buildPremiumCareerDigestHtml({ username: user?.username, career });
  const result = await sendTelegramMessage(telegramId, preview, { parse_mode: 'HTML' });
  if (!result.ok) throw new Error(result.error || 'PREMIUM_CAREER_DIGEST_SEND_FAILED');
  return { sent: true, telegramId, preview };
}
