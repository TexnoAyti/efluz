/**
 * TEAMS (Jamoalar) Management & Invitation Service for EFL UZ
 */

import { getFirestoreDb } from '../firebase/admin';
import { Team, TeamMember, TeamInvitation, TeamStats } from '../../types/team';
import { spendTeamTicket, isPrimaryOwner } from './teamTicketService';
import { verifyTelegramGroupMembership, sendTelegramMessage } from './telegramBotService';

// In-memory fallback stores for test and offline modes
const memoryTeams = new Map<string, Team>();
const memoryInvitations = new Map<string, TeamInvitation>();

export function clearMemoryTeamsStore(): void {
  memoryTeams.clear();
  memoryInvitations.clear();
}

const DEFAULT_STATS: TeamStats = {
  matchesPlayed: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
};

/**
 * Creates a new team. Requires:
 * 1. Mandatory @efleagueuz group membership.
 * 2. 1 TEAM_CREATION ticket spent atomically.
 * 3. Creator becomes team admin.
 */
export async function createTeam(params: {
  name: string;
  tag: string;
  logoUrl?: string;
  description?: string;
  creatorUserId: string;
  creatorTelegramId: string;
  creatorUsername?: string;
  creatorDisplayName?: string;
  idempotencyKey?: string;
}): Promise<Team> {
  const trimmedName = (params.name || '').trim();
  const trimmedTag = (params.tag || '').trim().toUpperCase();

  if (!trimmedName || trimmedName.length < 2) {
    throw Object.assign(new Error('Team nomi kamida 2 ta belgidan iborat bo‘lishi lozim.'), {
      statusCode: 400,
      code: 'INVALID_TEAM_NAME',
    });
  }

  if (!trimmedTag || trimmedTag.length < 2 || trimmedTag.length > 5) {
    throw Object.assign(new Error('Team qisqa tegi (tag) 2 tadan 5 tagacha harfdan iborat bo‘lishi lozim.'), {
      statusCode: 400,
      code: 'INVALID_TEAM_TAG',
    });
  }

  // 1. Mandatory Telegram group membership check (@efleagueuz)
  if (params.creatorTelegramId) {
    const membership = await verifyTelegramGroupMembership(params.creatorTelegramId);
    if (!membership.isMember) {
      throw Object.assign(new Error("Team yaratish uchun avval @efleagueuz Telegram guruhiga a'zo bo'lishingiz lozim."), {
        statusCode: 403,
        code: 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
        groupUsername: '@efleagueuz',
        groupUrl: 'https://t.me/efleagueuz',
      });
    }
  }

  const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const idempotencyKey = params.idempotencyKey || `team_create_${params.creatorUserId}_${teamId}`;

  // 2. Atomically spend 1 team ticket
  const ticketResult = await spendTeamTicket({
    userId: params.creatorUserId,
    teamId,
    idempotencyKey,
  });

  const now = new Date().toISOString();
  const creatorMember: TeamMember = {
    id: `member_${params.creatorUserId}`,
    userId: params.creatorUserId,
    telegramId: params.creatorTelegramId,
    username: params.creatorUsername,
    displayName: params.creatorDisplayName || params.creatorUsername || 'Team Admin',
    role: 'ADMIN',
    isVerifiedAccount: true,
    joinedAt: now,
  };

  const newTeam: Team = {
    id: teamId,
    name: trimmedName,
    tag: trimmedTag,
    logoUrl: params.logoUrl || '',
    description: (params.description || '').trim(),
    creatorUserId: params.creatorUserId,
    creatorTelegramId: params.creatorTelegramId,
    creatorUsername: params.creatorUsername,
    ticketTransactionId: ticketResult.transactionId,
    status: 'ACTIVE',
    roster: [creatorMember],
    stats: { ...DEFAULT_STATS },
    createdAt: now,
    updatedAt: now,
  };

  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    memoryTeams.set(teamId, newTeam);
    return { ...newTeam };
  }

  const db = getFirestoreDb();
  await db.collection('teams').doc(teamId).set(newTeam);
  return newTeam;
}

/**
 * Lists teams with optional query search.
 */
export async function getTeams(options: { search?: string; status?: string } = {}): Promise<Team[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    let list = Array.from(memoryTeams.values());
    if (options.status) {
      list = list.filter((t) => t.status === options.status);
    }
    if (options.search) {
      const q = options.search.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const db = getFirestoreDb();
  let query: FirebaseFirestore.Query = db.collection('teams');
  if (options.status) {
    query = query.where('status', '==', options.status);
  }

  const snap = await query.get();
  let list = snap.docs.map((d) => d.data() as Team);

  if (options.search) {
    const q = options.search.toLowerCase();
    list = list.filter(
      (t) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q)
    );
  }

  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Gets a team by ID.
 */
export async function getTeamById(teamId: string): Promise<Team | null> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const found = memoryTeams.get(teamId);
    return found ? { ...found } : null;
  }

  const db = getFirestoreDb();
  const doc = await db.collection('teams').doc(teamId).get();
  if (!doc.exists) return null;
  return doc.data() as Team;
}

/**
 * Updates team details (name, tag, logo, description). Only team creator or global admin.
 */
export async function updateTeam(
  teamId: string,
  updates: Partial<Pick<Team, 'name' | 'tag' | 'logoUrl' | 'description'>>,
  userId: string,
  userTelegramId?: string | number,
  isAdmin?: boolean
): Promise<Team> {
  const team = await getTeamById(teamId);
  if (!team) {
    throw Object.assign(new Error('Team topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const canEdit = team.creatorUserId === userId || isPrimaryOwner(userTelegramId) || Boolean(isAdmin);
  if (!canEdit) {
    throw Object.assign(new Error('Faqat ushbu jamoa administratori yoki asosiy admin jamoani tahrirlashi mumkin.'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }

  const now = new Date().toISOString();
  const updated: Team = {
    ...team,
    name: updates.name ? updates.name.trim() : team.name,
    tag: updates.tag ? updates.tag.trim().toUpperCase() : team.tag,
    logoUrl: updates.logoUrl !== undefined ? updates.logoUrl : team.logoUrl,
    description: updates.description !== undefined ? updates.description.trim() : team.description,
    updatedAt: now,
  };

  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  if (isFallback) {
    memoryTeams.set(teamId, updated);
    return { ...updated };
  }

  const db = getFirestoreDb();
  await db.collection('teams').doc(teamId).set(updated, { merge: true });
  return updated;
}

/**
 * Creates an invitation to an EFLUZ user to join the team.
 * Sends a Telegram bot notification with inline buttons ("Qabul qilish", "Rad etish").
 */
export async function createTeamInvitation(params: {
  teamId: string;
  inviterUserId: string;
  inviterDisplayName: string;
  inviterTelegramId?: string | number;
  inviteeUser: {
    id: string;
    telegramId: string;
    username?: string;
    displayName: string;
  };
  legacyRosterMemberId?: string;
  isAdmin?: boolean;
}): Promise<TeamInvitation> {
  const team = await getTeamById(params.teamId);
  if (!team) {
    throw Object.assign(new Error('Team topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const canInvite = team.creatorUserId === params.inviterUserId || isPrimaryOwner(params.inviterTelegramId) || Boolean(params.isAdmin);
  if (!canInvite) {
    throw Object.assign(new Error('Faqat team administratori yangi a’zo taklif qila oladi.'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }

  // Check if invitee is already in confirmed roster
  const alreadyInRoster = team.roster.some(
    (m) => (m.userId && m.userId === params.inviteeUser.id) || (m.telegramId && m.telegramId === params.inviteeUser.telegramId)
  );
  if (alreadyInRoster) {
    throw Object.assign(new Error('Foydalanuvchi allaqachon jamoa tarkibida mavjud.'), {
      statusCode: 400,
      code: 'ALREADY_IN_ROSTER',
    });
  }

  // Check for existing pending invitation
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();

  let existingPending: TeamInvitation | undefined;
  if (isFallback) {
    for (const inv of memoryInvitations.values()) {
      if (inv.teamId === params.teamId && inv.inviteeUserId === params.inviteeUser.id && inv.status === 'PENDING') {
        existingPending = inv;
        break;
      }
    }
  } else {
    const db = getFirestoreDb();
    const snap = await db
      .collection('team_invitations')
      .where('teamId', '==', params.teamId)
      .where('inviteeUserId', '==', params.inviteeUser.id)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();
    if (!snap.empty) {
      existingPending = snap.docs[0].data() as TeamInvitation;
    }
  }

  if (existingPending) {
    // Return existing pending invitation without creating duplicate
    return existingPending;
  }

  const invitationId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const invitation: TeamInvitation = {
    id: invitationId,
    teamId: team.id,
    teamName: team.name,
    teamTag: team.tag,
    teamLogoUrl: team.logoUrl,
    inviterUserId: params.inviterUserId,
    inviterDisplayName: params.inviterDisplayName,
    inviteeUserId: params.inviteeUser.id,
    inviteeTelegramId: params.inviteeUser.telegramId,
    inviteeUsername: params.inviteeUser.username,
    inviteeDisplayName: params.inviteeUser.displayName,
    legacyRosterMemberId: params.legacyRosterMemberId,
    status: 'PENDING',
    sentAt: now.toISOString(),
    expiresAt,
  };

  if (isFallback) {
    memoryInvitations.set(invitationId, invitation);
  } else {
    const db = getFirestoreDb();
    await db.collection('team_invitations').doc(invitationId).set(invitation);
  }

  // Send Telegram bot notification with interactive inline buttons
  if (params.inviteeUser.telegramId && !process.env.TEST_SUPPRESS_BOT_NOTIFICATIONS) {
    const msgText = `<b>${params.inviterDisplayName}</b> sizni <b>${team.name}</b> [${team.tag}] jamoasiga taklif qilyapti.`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Qabul qilish', callback_data: `team_invite:accept:${invitationId}` },
          { text: '❌ Rad etish', callback_data: `team_invite:reject:${invitationId}` },
        ],
      ],
    };

    sendTelegramMessage(params.inviteeUser.telegramId, msgText, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    }).catch(() => undefined);
  }

  return invitation;
}

/**
 * Responds to a team invitation (ACCEPT or REJECT).
 * Strictly enforces:
 * 1. Only the invitee can respond (matches userId or telegramId).
 * 2. Mandatory @efleagueuz group membership before accepting.
 * 3. Idempotent: duplicate button clicks do not duplicate membership.
 */
export async function respondToTeamInvitation(params: {
  invitationId: string;
  userId?: string;
  telegramId?: string | number;
  accept: boolean;
}): Promise<{ success: boolean; status: 'ACCEPTED' | 'REJECTED'; message: string; team?: Team }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  let invitation: TeamInvitation | null = null;

  if (isFallback) {
    invitation = memoryInvitations.get(params.invitationId) || null;
  } else {
    const db = getFirestoreDb();
    const doc = await db.collection('team_invitations').doc(params.invitationId).get();
    if (doc.exists) invitation = doc.data() as TeamInvitation;
  }

  if (!invitation) {
    throw Object.assign(new Error('Taklif topilmadi yoki muddati tugagan.'), {
      statusCode: 404,
      code: 'INVITATION_NOT_FOUND',
    });
  }

  // 1. Verify that respondent is the invitee
  const matchesUser = params.userId && params.userId === invitation.inviteeUserId;
  const matchesTg = params.telegramId && String(params.telegramId).trim() === String(invitation.inviteeTelegramId).trim();

  if (!matchesUser && !matchesTg) {
    throw Object.assign(new Error('Faqat taklif yuborilgan foydalanuvchining o‘zi javob bera oladi.'), {
      statusCode: 403,
      code: 'FORBIDDEN_NOT_INVITEE',
    });
  }

  // If already resolved, return idempotent success
  if (invitation.status === 'ACCEPTED' || invitation.status === 'REJECTED') {
    const team = await getTeamById(invitation.teamId);
    return {
      success: true,
      status: invitation.status,
      message: `Taklif allaqachon ${invitation.status === 'ACCEPTED' ? 'qabul qilingan' : 'rad etilgan'}.`,
      team: team || undefined,
    };
  }

  const now = new Date().toISOString();

  // If REJECT:
  if (!params.accept) {
    invitation.status = 'REJECTED';
    invitation.respondedAt = now;
    if (isFallback) {
      memoryInvitations.set(invitation.id, invitation);
    } else {
      const db = getFirestoreDb();
      await db.collection('team_invitations').doc(invitation.id).update({ status: 'REJECTED', respondedAt: now });
    }
    return { success: true, status: 'REJECTED', message: 'Taklif rad etildi.' };
  }

  // 2. If ACCEPT: verify mandatory Telegram group membership
  const targetTelegramId = invitation.inviteeTelegramId || (params.telegramId ? String(params.telegramId) : '');
  if (targetTelegramId) {
    const membership = await verifyTelegramGroupMembership(targetTelegramId);
    if (!membership.isMember) {
      throw Object.assign(new Error("Jamoaga qo‘shilish uchun avval @efleagueuz Telegram guruhiga a'zo bo'lishingiz lozim."), {
        statusCode: 403,
        code: 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
        groupUsername: '@efleagueuz',
        groupUrl: 'https://t.me/efleagueuz',
      });
    }
  }

  // 3. Add to team roster atomically
  const team = await getTeamById(invitation.teamId);
  if (!team) {
    throw Object.assign(new Error('Team topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const existingMemberIndex = team.roster.findIndex(
    (m) => (m.userId && m.userId === invitation!.inviteeUserId) || (m.telegramId && m.telegramId === invitation!.inviteeTelegramId)
  );

  let updatedRoster = [...team.roster];

  if (existingMemberIndex >= 0) {
    // Already in roster; make sure isVerifiedAccount is true
    updatedRoster[existingMemberIndex] = {
      ...updatedRoster[existingMemberIndex],
      isVerifiedAccount: true,
    };
  } else if (invitation.legacyRosterMemberId) {
    // Linking an existing unverified legacy slot
    const legacyIndex = updatedRoster.findIndex((m) => m.id === invitation!.legacyRosterMemberId);
    if (legacyIndex >= 0) {
      updatedRoster[legacyIndex] = {
        ...updatedRoster[legacyIndex],
        userId: invitation.inviteeUserId,
        telegramId: invitation.inviteeTelegramId,
        username: invitation.inviteeUsername,
        displayName: invitation.inviteeDisplayName,
        isVerifiedAccount: true,
      };
    } else {
      // Add new
      updatedRoster.push({
        id: `member_${invitation.inviteeUserId}`,
        userId: invitation.inviteeUserId,
        telegramId: invitation.inviteeTelegramId,
        username: invitation.inviteeUsername,
        displayName: invitation.inviteeDisplayName,
        role: 'MEMBER',
        isVerifiedAccount: true,
        joinedAt: now,
      });
    }
  } else {
    // Standard new member join
    updatedRoster.push({
      id: `member_${invitation.inviteeUserId}`,
      userId: invitation.inviteeUserId,
      telegramId: invitation.inviteeTelegramId,
      username: invitation.inviteeUsername,
      displayName: invitation.inviteeDisplayName,
      role: 'MEMBER',
      isVerifiedAccount: true,
      joinedAt: now,
    });
  }

  team.roster = updatedRoster;
  team.updatedAt = now;

  invitation.status = 'ACCEPTED';
  invitation.respondedAt = now;

  if (isFallback) {
    memoryTeams.set(team.id, team);
    memoryInvitations.set(invitation.id, invitation);
  } else {
    const db = getFirestoreDb();
    await db.collection('teams').doc(team.id).update({ roster: updatedRoster, updatedAt: now });
    await db.collection('team_invitations').doc(invitation.id).update({ status: 'ACCEPTED', respondedAt: now });
  }

  return {
    success: true,
    status: 'ACCEPTED',
    message: `${team.name} jamoasiga muvaffaqiyatli a’zo bo‘ldingiz!`,
    team,
  };
}

/**
 * Cancels a pending invitation.
 */
export async function cancelTeamInvitation(
  invitationId: string,
  userId: string,
  userTelegramId?: string | number,
  isAdmin?: boolean
): Promise<void> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  let invitation: TeamInvitation | null = null;

  if (isFallback) {
    invitation = memoryInvitations.get(invitationId) || null;
  } else {
    const db = getFirestoreDb();
    const doc = await db.collection('team_invitations').doc(invitationId).get();
    if (doc.exists) invitation = doc.data() as TeamInvitation;
  }

  if (!invitation) {
    throw Object.assign(new Error('Taklif topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const team = await getTeamById(invitation.teamId);
  const canCancel =
    invitation.inviterUserId === userId ||
    (team && team.creatorUserId === userId) ||
    isPrimaryOwner(userTelegramId) ||
    Boolean(isAdmin);

  if (!canCancel) {
    throw Object.assign(new Error('Taklifni bekor qilish huquqi yo‘q.'), { statusCode: 403, code: 'FORBIDDEN' });
  }

  invitation.status = 'CANCELLED';
  if (isFallback) {
    memoryInvitations.set(invitationId, invitation);
  } else {
    const db = getFirestoreDb();
    await db.collection('team_invitations').doc(invitationId).update({ status: 'CANCELLED' });
  }
}

/**
 * Gets invitations for a specific team.
 */
export async function getTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    return Array.from(memoryInvitations.values()).filter((i) => i.teamId === teamId);
  }

  const db = getFirestoreDb();
  const snap = await db.collection('team_invitations').where('teamId', '==', teamId).get();
  return snap.docs.map((d) => d.data() as TeamInvitation);
}

/**
 * Gets pending invitations for a specific user.
 */
export async function getUserPendingInvitations(userId: string, telegramId?: string): Promise<TeamInvitation[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    return Array.from(memoryInvitations.values()).filter(
      (i) => i.status === 'PENDING' && (i.inviteeUserId === userId || (telegramId && i.inviteeTelegramId === telegramId))
    );
  }

  const db = getFirestoreDb();
  const snap = await db
    .collection('team_invitations')
    .where('inviteeUserId', '==', userId)
    .where('status', '==', 'PENDING')
    .get();

  let list = snap.docs.map((d) => d.data() as TeamInvitation);

  if (telegramId) {
    const tgSnap = await db
      .collection('team_invitations')
      .where('inviteeTelegramId', '==', telegramId)
      .where('status', '==', 'PENDING')
      .get();
    const tgList = tgSnap.docs.map((d) => d.data() as TeamInvitation);
    const seen = new Set(list.map((i) => i.id));
    for (const item of tgList) {
      if (!seen.has(item.id)) list.push(item);
    }
  }

  return list;
}
