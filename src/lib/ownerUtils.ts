import { isValidTelegramUsername } from './telegramUtils';

export interface ClubOwnerInput {
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  managerUsername?: string | null;
  managerDisplayName?: string | null;
  managerFirstName?: string | null;
  managerLastName?: string | null;
  isTaken?: boolean;
  owner?: {
    userId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
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
  firstName?: string | null;
  lastName?: string | null;
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
 * 1. @username (if genuine Telegram username)
 * 2. firstName + lastName
 * 3. firstName
 * 4. Telegram user (when claimed)
 * 5. User kerak ONLY when genuinely unclaimed
 */
export function getClubOwnerDisplay(
  club?: ClubOwnerInput | null,
  fixtureUser?: FixtureUserInput | null,
  ownerIdFallback?: string | null,
  unclaimedText: string = 'User kerak'
): ClubOwnerDisplay {
  // 1. Check for genuine username candidate
  const rawUsername =
    fixtureUser?.username ||
    club?.claimedByUsername ||
    club?.managerUsername ||
    club?.owner?.username ||
    club?.occupancy?.username ||
    null;

  const cleanUsername = rawUsername ? rawUsername.replace(/^@+/, '').trim() : '';
  const isSyntheticUsername = cleanUsername.startsWith('tg_') || cleanUsername.startsWith('user_');
  const hasValidTg = isValidTelegramUsername(cleanUsername) && !isSyntheticUsername;

  // 2. Check for userId candidate
  const resolvedUserId =
    fixtureUser?.userId ||
    fixtureUser?.id ||
    club?.claimedByUserId ||
    club?.owner?.userId ||
    club?.occupancy?.userId ||
    ownerIdFallback ||
    null;

  // 3. Resolve name components
  const firstName =
    club?.owner?.firstName?.trim() ||
    club?.managerFirstName?.trim() ||
    fixtureUser?.firstName?.trim() ||
    '';
  const lastName =
    club?.owner?.lastName?.trim() ||
    club?.managerLastName?.trim() ||
    fixtureUser?.lastName?.trim() ||
    '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  const displayNameCandidate =
    (fixtureUser?.displayName && fixtureUser.displayName !== unclaimedText ? fixtureUser.displayName.trim() : '') ||
    (club?.managerDisplayName && club.managerDisplayName !== unclaimedText ? club.managerDisplayName.trim() : '') ||
    (club?.owner?.displayName && club.owner?.displayName !== unclaimedText ? club.owner.displayName.trim() : '');

  // 4. Determine whether a user is genuinely attached/claimed
  const isClaimed = Boolean(
    (cleanUsername && !isSyntheticUsername) ||
    resolvedUserId ||
    displayNameCandidate ||
    firstName ||
    (club?.occupancy && club.occupancy.status !== 'available' && club.occupancy.status !== undefined) ||
    club?.isTaken
  );

  // 5. Display hierarchy
  // Step 1: Genuine @username
  if (hasValidTg && cleanUsername) {
    return {
      isClaimed: true,
      hasValidTelegram: true,
      username: cleanUsername,
      userId: resolvedUserId,
      displayText: `@${cleanUsername}`,
    };
  }

  // Step 2-4: If claimed, resolve according to hierarchy
  if (isClaimed) {
    let displayText = 'Telegram user';
    if (fullName) {
      displayText = fullName;
    } else if (firstName) {
      displayText = firstName;
    } else if (displayNameCandidate && displayNameCandidate !== 'User kerak') {
      displayText = displayNameCandidate;
    }

    return {
      isClaimed: true,
      hasValidTelegram: false,
      username: hasValidTg ? cleanUsername : null,
      userId: resolvedUserId,
      displayText,
    };
  }

  // Step 5: Truly unclaimed club
  return {
    isClaimed: false,
    hasValidTelegram: false,
    username: null,
    userId: null,
    displayText: unclaimedText,
  };
}
