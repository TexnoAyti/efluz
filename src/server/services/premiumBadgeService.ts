import { getUpstashClient, KEY_PREFIX, getAdminClubsFromReadModel } from '../readModel/readModelStore';
import { listPremiumEntitlements } from './premiumService';

function badgeKey(seasonId: string) {
  return `${KEY_PREFIX}:premium:active-users:${seasonId}`;
}

/** Rebuild once on a cold cache, then invalidate only when an entitlement changes. */
export async function getPremiumClubBadgeIds(seasonId: string): Promise<string[]> {
  const client = getUpstashClient();
  if (!client) return [];
  let users = await client.get<string[]>(badgeKey(seasonId));
  if (!Array.isArray(users)) {
    users = (await listPremiumEntitlements(seasonId))
      .filter((entitlement) => entitlement.status === 'ACTIVE')
      .map((entitlement) => entitlement.userId);
    await client.set(badgeKey(seasonId), users, { ex: 86400 });
  }
  const owners = await getAdminClubsFromReadModel(seasonId);
  const active = new Set(users);
  return owners.clubs.filter((club) => club.ownerUserId && active.has(club.ownerUserId)).map((club) => club.id);
}

export async function invalidatePremiumBadges(seasonId: string): Promise<void> {
  await getUpstashClient()?.del(badgeKey(seasonId));
}
