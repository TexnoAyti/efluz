import { waitUntil } from '@vercel/functions';
import { getOptionalCurrentClub } from '../readModel/readModelStore';

const unavailable = () => ({ currentClub: null, ownedClubs: [], currentClubStatus: 'unavailable' as const, degraded: true });

/** Club metadata must never hold a verified identity behind a database refresh. */
export async function getLoginClubState(userId: string, budgetMs = 1200, seasonId = 'season-2026-27') {
  const lookup = getOptionalCurrentClub(userId, seasonId).catch(() => unavailable());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup,
      new Promise<ReturnType<typeof unavailable>>(resolve => {
        timer = setTimeout(() => {
          try { if (process.env.VERCEL === '1') waitUntil(lookup); } catch { /* A missing lifecycle hook cannot delay login. */ }
          resolve(unavailable());
        }, budgetMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
