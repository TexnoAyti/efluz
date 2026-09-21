import { isValidTelegramUsername } from './telegramUtils';

export interface ClubOwnerInput {
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  managerUsername?: string | null;
  isTaken?: boolean;
  owner?: {
    userId?: string;
    username?: string;
    firstName?: string;
  } | null;
  occupancy?: {
    status?: 'occupied' | 'owned' | 'available' | string;
    userId?: string;
    username?: string;
  } | null;
}

export interface FixtureUserInput {
  id?: string | null;
  userId?: string | null;
  telegramId?: string | null;
  username?: string | null;
  displayName?: string | null;
}

export interface ClubOwnerDisplay {
  isClaimed: boolean;
  hasValidTelegram: boolean;
  username: string | null;
  userId: string | null;
  displayText: string;
}

/**
 * Deterministically resolves the owner display text and metadata for a club.
 * Strictly adheres to rule:
 * - occupied/claimed club + valid owner username -> @username
 * - occupied/claimed club + owner exists but username unavailable -> safe display name/identity (NEVER "User kerak")
 * - genuinely unclaimed club -> "User kerak" (or translated text)
 */
export function getClubOwnerDisplay(
  club?: ClubOwnerInput | null,
  fixtureUser?: FixtureUserInput | null,
  ownerIdFallback?: string | null,
  unclaimedText: string = 'User kerak'
): ClubOwnerDisplay {
  // 1. Check for username candidate
  const rawUsername =
    fixtureUser?.username ||
    club?.claimedByUsername ||
    club?.managerUsername ||
    club?.owner?.username ||
    club?.occupancy?.username ||
    null;

  const cleanUsername = rawUsername ? rawUsername.replace(/^@+/, '').trim() : '';
  const hasValidTg = isValidTelegramUsername(cleanUsername);

  // 2. Check for userId candidate
  const resolvedUserId =
    fixtureUser?.userId ||
    fixtureUser?.id ||
    club?.claimedByUserId ||
    club?.owner?.userId ||
    club?.occupancy?.userId ||
    ownerIdFallback ||
    null;

  // 3. Determine whether a user is genuinely attached/claimed
  const isClaimed = Boolean(
    cleanUsername ||
    resolvedUserId ||
    (fixtureUser?.displayName && fixtureUser.displayName !== unclaimedText) ||
    club?.owner?.firstName ||
    (club?.occupancy && club.occupancy.status !== 'available' && club.occupancy.status !== undefined) ||
    club?.isTaken
  );

  // 4. Resolve display text
  if (cleanUsername) {
    return {
      isClaimed: true,
      hasValidTelegram: hasValidTg,
      username: cleanUsername,
      userId: resolvedUserId,
      displayText: `@${cleanUsername}`,
    };
  }

  if (isClaimed) {
    const fallbackName =
      (fixtureUser?.displayName && fixtureUser.displayName !== unclaimedText)
        ? fixtureUser.displayName
        : club?.owner?.firstName || 'Telegram user';

    return {
      isClaimed: true,
      hasValidTelegram: false,
      username: null,
      userId: resolvedUserId,
      displayText: fallbackName,
    };
  }

  return {
    isClaimed: false,
    hasValidTelegram: false,
    username: null,
    userId: null,
    displayText: unclaimedText,
  };
}
