/**
 * Custom Tournament Core Service
 *
 * Manages tournament lifecycle, atomic club claiming, match results,
 * dispute resolution, private/public isolation, and assistant admins.
 */

import crypto from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentStandingsRow,
  CustomTournamentAuditLog,
} from '../../types/customTournament';
import { spendTicketForTournament, spendTicketInTransaction } from './customTournamentTicketService';
import {
  generateRoundRobinFixtures,
  generatePlayoffBracketFixtures,
  calculateCustomStandings,
  resolvePlayoffWinner,
} from './customTournamentEngine';
import { SEED_CLUBS } from '../db/seed';

// In-memory fallback stores for test suite
const memoryTournaments = new Map<string, CustomTournament>();
const memoryParticipants = new Map<string, CustomTournamentParticipant[]>();
const memoryFixtures = new Map<string, CustomTournamentFixture[]>();
const memoryAuditLogs = new Map<string, CustomTournamentAuditLog[]>();
const memoryClubClaims = new Map<string, string>(); // `${tournamentId}_${clubId}` -> userId

export function clearMemoryCustomTournamentStore(): void {
  memoryTournaments.clear();
  memoryParticipants.clear();
  memoryFixtures.clear();
  memoryAuditLogs.clear();
  memoryClubClaims.clear();
}

function generateSecureToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Creates a tournament in DRAFT status (0 tickets deducted).
 */
export async function createTournamentDraft(params: {
  name: string;
  description?: string;
  organizerUserId: string;
  organizerTelegramId: string;
  organizerUsername?: string;
  format: CustomTournament['format'];
  leagueScope: CustomTournament['leagueScope'];
  selectedLeagueId?: string;
  maxParticipants: number;
  rules: CustomTournament['rules'];
  visibility?: CustomTournament['visibility'];
  spectatorAccess?: CustomTournament['spectatorAccess'];
}): Promise<CustomTournament> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const tournamentId = `ct_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const tournament: CustomTournament = {
    id: tournamentId,
    name: params.name.trim(),
    description: params.description?.trim(),
    organizerUserId: params.organizerUserId,
    organizerTelegramId: params.organizerTelegramId,
    organizerUsername: params.organizerUsername,
    assistantAdminIds: [],
    status: 'DRAFT',
    visibility: params.visibility || 'PUBLIC_OPEN',
    spectatorAccess: params.spectatorAccess || 'PUBLIC_LINK',
    inviteToken: generateSecureToken('inv'),
    spectatorToken: generateSecureToken('spec'),
    format: params.format,
    leagueScope: params.leagueScope,
    selectedLeagueId: params.selectedLeagueId,
    maxParticipants: Math.max(4, Math.min(32, params.maxParticipants)),
    currentParticipantsCount: 0,
    rules: {
      roundsCount: params.rules.roundsCount || 1,
      playoffLegMode: params.rules.playoffLegMode || 'SINGLE_LEG',
      playoffQualifiersCount: params.rules.playoffQualifiersCount,
      groupStageMode: params.rules.groupStageMode,
      groupsCount: params.rules.groupsCount,
      matchDurationHours: params.rules.matchDurationHours || 36,
    },
    createdAt: now,
    updatedAt: now,
  };

  if (isFallback) {
    memoryTournaments.set(tournamentId, tournament);
    memoryParticipants.set(tournamentId, []);
    memoryFixtures.set(tournamentId, []);
    return { ...tournament };
  }

  const db = getFirestoreDb();
  await db.collection('custom_tournaments').doc(tournamentId).set(tournament);
  return tournament;
}

/**
 * Publishes tournament: spends 1 ticket atomically and opens registration.
 */
export async function publishTournament(params: {
  tournamentId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<CustomTournament> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  if (!isFallback) {
    const db = getFirestoreDb();
    const tournamentRef = db.collection('custom_tournaments').doc(params.tournamentId);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(tournamentRef);
      const tournament = snapshot.data() as CustomTournament | undefined;
      if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
      if (tournament.organizerUserId !== params.userId) {
        throw Object.assign(new Error('Faqat tashkilotchi turnirni e‘lon qila oladi.'), { statusCode: 403, code: 'UNAUTHORIZED' });
      }
      if (tournament.status !== 'DRAFT') return tournament;
      const spend = await spendTicketInTransaction(params, transaction);
      const published: CustomTournament = {
        ...tournament, status: 'REGISTRATION_OPEN', ticketSpentTransactionId: spend.transactionId, updatedAt: new Date().toISOString(),
      };
      transaction.update(tournamentRef, {
        status: published.status, ticketSpentTransactionId: published.ticketSpentTransactionId, updatedAt: published.updatedAt,
      });
      return published;
    });
  }
  const tournament = memoryTournaments.get(params.tournamentId);

  if (!tournament) {
    throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  if (tournament.organizerUserId !== params.userId) {
    throw Object.assign(new Error('Faqat tashkilotchi turnirni e‘lon qila oladi.'), {
      statusCode: 403,
      code: 'UNAUTHORIZED',
    });
  }

  if (tournament.status !== 'DRAFT') {
    return tournament; // Already published or started
  }

  // Atomically spend 1 ticket (idempotent)
  const spendResult = await spendTicketForTournament({
    userId: params.userId,
    tournamentId: params.tournamentId,
    idempotencyKey: params.idempotencyKey,
  });

  const now = new Date().toISOString();
  tournament.status = 'REGISTRATION_OPEN';
  tournament.ticketSpentTransactionId = spendResult.transactionId;
  tournament.updatedAt = now;

  memoryTournaments.set(params.tournamentId, tournament);
  return { ...tournament };
}

/**
 * Claims a club in a tournament for a user with atomic concurrency guarantees.
 * Rules:
 * 1. Exactly 1 user per club in this tournament.
 * 2. Exactly 1 club per user in this tournament.
 * 3. Club must belong to allowed league scope.
 */
export async function claimTournamentClub(params: {
  tournamentId: string;
  userId: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  clubId: string;
}): Promise<CustomTournamentParticipant> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  // Validate club existence in seed
  const seedClub = SEED_CLUBS.find((c) => c.id === params.clubId);
  if (!seedClub) {
    throw Object.assign(new Error('Tanlangan klub mavjud emas.'), { statusCode: 400, code: 'INVALID_CLUB' });
  }

  if (isFallback) {
    const tournament = memoryTournaments.get(params.tournamentId);
    if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Ushbu turnirda ro‘yxatdan o‘tish yopilgan yoki turnir boshlangan.'), {
        statusCode: 400,
        code: 'REGISTRATION_CLOSED',
      });
    }

    // Check scope
    if (tournament.leagueScope === 'SINGLE_LEAGUE' && tournament.selectedLeagueId && seedClub.leagueId !== tournament.selectedLeagueId) {
      throw Object.assign(new Error('Ushbu klub turnirning tanlangan ligasiga tegishli emas.'), {
        statusCode: 400,
        code: 'CLUB_OUT_OF_SCOPE',
      });
    }

    const participants = memoryParticipants.get(params.tournamentId) || [];
    if (participants.length >= tournament.maxParticipants) {
      throw Object.assign(new Error('Turnirda barcha o‘rinlar band bo‘lgan.'), { statusCode: 400, code: 'TOURNAMENT_FULL' });
    }

    // 1 User 1 Club check
    if (participants.some((p) => p.userId === params.userId)) {
      throw Object.assign(new Error('Siz ushbu turnirda allaqachon klub tanlagansiz.'), {
        statusCode: 409,
        code: 'USER_ALREADY_HAS_CLUB',
      });
    }

    // 1 Club 1 User atomic check
    const claimKey = `${params.tournamentId}_${params.clubId}`;
    if (memoryClubClaims.has(claimKey)) {
      throw Object.assign(new Error('Bu klub boshqa ishtirokchi tomonidan band qilingan.'), {
        statusCode: 409,
        code: 'CLUB_ALREADY_TAKEN',
      });
    }

    memoryClubClaims.set(claimKey, params.userId);

    const participant: CustomTournamentParticipant = {
      id: `${params.tournamentId}_${params.clubId}`,
      tournamentId: params.tournamentId,
      userId: params.userId,
      telegramId: params.telegramId,
      username: params.username,
      firstName: params.firstName,
      clubId: params.clubId,
      clubName: seedClub.name,
      clubShortName: seedClub.shortName,
      clubLogoUrl: seedClub.logoUrl,
      status: 'REGISTERED',
      joinedAt: now,
    };

    participants.push(participant);
    memoryParticipants.set(params.tournamentId, participants);
    tournament.currentParticipantsCount = participants.length;
    tournament.updatedAt = now;
    memoryTournaments.set(params.tournamentId, tournament);

    return participant;
  }

  // Firestore Atomic Transaction
  const db = getFirestoreDb();
  const tournRef = db.collection('custom_tournaments').doc(params.tournamentId);
  const userClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_user_${params.userId}`);
  const clubClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_club_${params.clubId}`);
  const partRef = db.collection('custom_tournament_participants').doc(`${params.tournamentId}_${params.clubId}`);

  return await db.runTransaction(async (transaction) => {
    const tournDoc = await transaction.get(tournRef);
    if (!tournDoc.exists) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    const tournament = tournDoc.data() as CustomTournament;

    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnirda ro‘yxatdan o‘tish yopilgan.'), { statusCode: 400, code: 'REGISTRATION_CLOSED' });
    }

    if (tournament.currentParticipantsCount >= tournament.maxParticipants) {
      throw Object.assign(new Error('Turnirda barcha o‘rinlar band bo‘lgan.'), { statusCode: 400, code: 'TOURNAMENT_FULL' });
    }

    if (tournament.leagueScope === 'SINGLE_LEAGUE' && tournament.selectedLeagueId && seedClub.leagueId !== tournament.selectedLeagueId) {
      throw Object.assign(new Error('Klub turnir ligasiga mos kelmaydi.'), { statusCode: 400, code: 'CLUB_OUT_OF_SCOPE' });
    }

    // Check user already has a club
    const userClaimDoc = await transaction.get(userClaimRef);
    if (userClaimDoc.exists) {
      throw Object.assign(new Error('Siz ushbu turnirda allaqachon klub tanlagansiz.'), { statusCode: 409, code: 'USER_ALREADY_HAS_CLUB' });
    }

    // Check club already taken
    const clubClaimDoc = await transaction.get(clubClaimRef);
    if (clubClaimDoc.exists) {
      throw Object.assign(new Error('Bu klub boshqa ishtirokchi tomonidan band qilingan.'), { statusCode: 409, code: 'CLUB_ALREADY_TAKEN' });
    }

    const participant: CustomTournamentParticipant = {
      id: `${params.tournamentId}_${params.clubId}`,
      tournamentId: params.tournamentId,
      userId: params.userId,
      telegramId: params.telegramId,
      username: params.username,
      firstName: params.firstName,
      clubId: params.clubId,
      clubName: seedClub.name,
      clubShortName: seedClub.shortName,
      clubLogoUrl: seedClub.logoUrl,
      status: 'REGISTERED',
      joinedAt: now,
    };

    transaction.set(userClaimRef, { clubId: params.clubId, joinedAt: now });
    transaction.set(clubClaimRef, { userId: params.userId, joinedAt: now });
    transaction.set(partRef, participant);
    transaction.update(tournRef, {
      currentParticipantsCount: tournament.currentParticipantsCount + 1,
      updatedAt: now,
    });

    return participant;
  });
}

/**
 * Starts tournament and generates match schedule.
 * If participant count is less than initial capacity, adjusts capacity down (User Decision 3).
 */
export async function startTournament(params: {
  tournamentId: string;
  userId: string;
}): Promise<{ tournament: CustomTournament; fixturesCount: number }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  let tournament: CustomTournament;
  let participants: CustomTournamentParticipant[];

  if (isFallback) {
    tournament = memoryTournaments.get(params.tournamentId)!;
    participants = memoryParticipants.get(params.tournamentId) || [];
  } else {
    const db = getFirestoreDb();
    const tDoc = await db.collection('custom_tournaments').doc(params.tournamentId).get();
    tournament = tDoc.data() as CustomTournament;
    const pSnap = await db.collection('custom_tournament_participants').where('tournamentId', '==', params.tournamentId).get();
    participants = pSnap.docs.map((d) => d.data() as CustomTournamentParticipant);
  }

  if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
  if (tournament.organizerUserId !== params.userId) {
    throw Object.assign(new Error('Faqat tashkilotchi turnirni boshlay oladi.'), { statusCode: 403 });
  }
  if (tournament.status !== 'REGISTRATION_OPEN') {
    throw Object.assign(new Error('Turnir holati boshlashga mos emas.'), { statusCode: 400 });
  }
  if (participants.length < 4) {
    throw Object.assign(new Error('Turnirni boshlash uchun kamida 4 ta qatnashchi zarur.'), {
      statusCode: 400,
      code: 'INSUFFICIENT_PARTICIPANTS',
    });
  }

  // Adjust maxParticipants to actual registered count if not full
  const finalParticipantsCount = participants.length;
  tournament.maxParticipants = finalParticipantsCount;
  tournament.currentParticipantsCount = finalParticipantsCount;

  // Generate Fixtures based on format
  let generatedFixtures: CustomTournamentFixture[] = [];

  if (tournament.format === 'LEAGUE') {
    generatedFixtures = generateRoundRobinFixtures(
      tournament.id,
      participants,
      tournament.rules.roundsCount,
      tournament.rules.matchDurationHours
    );
  } else if (tournament.format === 'PLAYOFF') {
    generatedFixtures = generatePlayoffBracketFixtures(
      tournament.id,
      participants,
      tournament.rules.playoffLegMode,
      tournament.rules.matchDurationHours
    );
  } else {
    // LEAGUE_AND_PLAYOFF
    if (tournament.rules.groupStageMode === 'GROUPS' && tournament.rules.groupsCount) {
      // Split into groups
      const gCount = tournament.rules.groupsCount;
      participants.forEach((p, idx) => {
        p.groupIndex = idx % gCount;
      });
      for (let g = 0; g < gCount; g++) {
        const groupParts = participants.filter((p) => p.groupIndex === g);
        const groupFixs = generateRoundRobinFixtures(
          tournament.id,
          groupParts,
          tournament.rules.roundsCount,
          tournament.rules.matchDurationHours,
          g
        );
        generatedFixtures.push(...groupFixs);
      }
    } else {
      // Single table league stage
      generatedFixtures = generateRoundRobinFixtures(
        tournament.id,
        participants,
        tournament.rules.roundsCount,
        tournament.rules.matchDurationHours
      );
    }
  }

  tournament.status = 'IN_PROGRESS';
  tournament.startedAt = now;
  tournament.updatedAt = now;

  if (isFallback) {
    memoryTournaments.set(tournament.id, tournament);
    memoryParticipants.set(tournament.id, participants);
    memoryFixtures.set(tournament.id, generatedFixtures);
    return { tournament: { ...tournament }, fixturesCount: generatedFixtures.length };
  }

  const db = getFirestoreDb();
  const batch = db.batch();
  batch.update(db.collection('custom_tournaments').doc(tournament.id), {
    status: 'IN_PROGRESS',
    maxParticipants: finalParticipantsCount,
    startedAt: now,
    updatedAt: now,
  });

  // Save fixtures
  for (const f of generatedFixtures) {
    batch.set(db.collection('custom_tournament_fixtures').doc(f.id), f);
  }
  await batch.commit();

  return { tournament, fixturesCount: generatedFixtures.length };
}

/**
 * Submits match result and handles confirmation or dispute.
 */
export async function submitCustomMatchResult(params: {
  tournamentId: string;
  fixtureId: string;
  userId: string;
  homeScore: number;
  awayScore: number;
  penaltyHomeScore?: number;
  penaltyAwayScore?: number;
  proofUrl?: string;
}): Promise<{ fixture: CustomTournamentFixture; tournamentCompleted?: boolean }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  let fixture: CustomTournamentFixture | undefined;
  let tournament: CustomTournament | undefined;

  if (isFallback) {
    const list = memoryFixtures.get(params.tournamentId) || [];
    fixture = list.find((f) => f.id === params.fixtureId);
    tournament = memoryTournaments.get(params.tournamentId);
  } else {
    const db = getFirestoreDb();
    const fDoc = await db.collection('custom_tournament_fixtures').doc(params.fixtureId).get();
    fixture = fDoc.data() as CustomTournamentFixture;
    const tDoc = await db.collection('custom_tournaments').doc(params.tournamentId).get();
    tournament = tDoc.data() as CustomTournament;
  }

  if (!fixture || !tournament) throw Object.assign(new Error('Match not found.'), { statusCode: 404 });
  if (fixture.status === 'CONFIRMED') {
    throw Object.assign(new Error('Ushbu natija allaqachon tasdiqlangan.'), { statusCode: 409 });
  }

  // Check user is participant in this match or organizer
  const isHomeUser = fixture.homeUserId === params.userId;
  const isAwayUser = fixture.awayUserId === params.userId;
  const isOrganizer = tournament.organizerUserId === params.userId || tournament.assistantAdminIds.includes(params.userId);

  if (!isHomeUser && !isAwayUser && !isOrganizer) {
    throw Object.assign(new Error('Siz ushbu o‘yinda ishtirok etmaysiz.'), { statusCode: 403 });
  }

  // If first submission or organizer override
  if (!fixture.submittedByUserId || isOrganizer) {
    fixture.homeScore = params.homeScore;
    fixture.awayScore = params.awayScore;
    fixture.penaltyHomeScore = params.penaltyHomeScore ?? null;
    fixture.penaltyAwayScore = params.penaltyAwayScore ?? null;
    fixture.proofUrl = params.proofUrl ?? null;
    fixture.submittedByUserId = params.userId;

    if (isOrganizer) {
      // Direct confirm by organizer
      fixture.status = 'CONFIRMED';
      fixture.confirmedAt = now;
    } else {
      fixture.status = 'PENDING_CONFIRMATION';
    }
  } else {
    // Second submission by opponent -> verify matching score
    if (fixture.homeScore === params.homeScore && fixture.awayScore === params.awayScore) {
      fixture.status = 'CONFIRMED';
      fixture.confirmedAt = now;
      if (params.penaltyHomeScore !== undefined) fixture.penaltyHomeScore = params.penaltyHomeScore;
      if (params.penaltyAwayScore !== undefined) fixture.penaltyAwayScore = params.penaltyAwayScore;
    } else {
      fixture.status = 'DISPUTED';
    }
  }

  // If confirmed in playoff, advance winner
  if (fixture.status === 'CONFIRMED' && fixture.stage.startsWith('PLAYOFF')) {
    const outcome = resolvePlayoffWinner(fixture);
    fixture.winnerClubId = outcome.winnerClubId;

    if (outcome.winnerClubId && fixture.nextMatchFixtureId) {
      // Advance to next fixture
      if (isFallback) {
        const allFix = memoryFixtures.get(params.tournamentId) || [];
        const nextFix = allFix.find((f) => f.id === fixture!.nextMatchFixtureId);
        if (nextFix) {
          if (nextFix.homeClubId === 'TBD') {
            nextFix.homeClubId = outcome.winnerClubId;
            nextFix.homeClubName = fixture.homeClubId === outcome.winnerClubId ? fixture.homeClubName : fixture.awayClubName;
            nextFix.homeUserId = fixture.homeClubId === outcome.winnerClubId ? fixture.homeUserId : fixture.awayUserId;
          } else if (nextFix.awayClubId === 'TBD') {
            nextFix.awayClubId = outcome.winnerClubId;
            nextFix.awayClubName = fixture.homeClubId === outcome.winnerClubId ? fixture.homeClubName : fixture.awayClubName;
            nextFix.awayUserId = fixture.homeClubId === outcome.winnerClubId ? fixture.homeUserId : fixture.awayUserId;
          }
        }
      }
    }
  }

  if (isFallback) {
    const list = memoryFixtures.get(params.tournamentId) || [];
    const idx = list.findIndex((f) => f.id === fixture!.id);
    if (idx >= 0) list[idx] = fixture;
  } else {
    const db = getFirestoreDb();
    await db.collection('custom_tournament_fixtures').doc(fixture.id).set(fixture, { merge: true });
  }

  return { fixture };
}

/**
 * Retrieves public tournaments with pagination (Strictly hides PRIVATE tournaments).
 */
export async function getPublicTournaments(limitCount = 20): Promise<CustomTournament[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    return Array.from(memoryTournaments.values())
      .filter((t) => t.visibility === 'PUBLIC_OPEN' || t.visibility === 'PUBLIC_MODERATED')
      .slice(0, limitCount);
  }

  const db = getFirestoreDb();
  const snap = await db
    .collection('custom_tournaments')
    .where('visibility', 'in', ['PUBLIC_OPEN', 'PUBLIC_MODERATED'])
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();

  return snap.docs.map((d) => d.data() as CustomTournament);
}

/**
 * Retrieves tournaments relevant to a specific user (organized, assisted, or joined).
 */
export async function getMyTournaments(userId: string): Promise<CustomTournament[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const joinedIds = new Set<string>();
    for (const [tId, pList] of memoryParticipants.entries()) {
      if (pList.some((p) => p.userId === userId)) joinedIds.add(tId);
    }
    return Array.from(memoryTournaments.values()).filter(
      (t) => t.organizerUserId === userId || t.assistantAdminIds.includes(userId) || joinedIds.has(t.id)
    );
  }

  const db = getFirestoreDb();
  // Query where organizer
  const orgSnap = await db.collection('custom_tournaments').where('organizerUserId', '==', userId).get();
  const myTourns = new Map<string, CustomTournament>();
  orgSnap.docs.forEach((d) => myTourns.set(d.id, d.data() as CustomTournament));

  // Query where participant
  const partSnap = await db.collection('custom_tournament_participants').where('userId', '==', userId).get();
  for (const p of partSnap.docs) {
    const tId = p.data().tournamentId;
    if (!myTourns.has(tId)) {
      const tDoc = await db.collection('custom_tournaments').doc(tId).get();
      if (tDoc.exists) myTourns.set(tId, tDoc.data() as CustomTournament);
    }
  }

  return Array.from(myTourns.values());
}

/**
 * Retrieves a tournament by ID, validating private token or membership access.
 */
export async function getTournamentByIdWithAccess(
  tournamentId: string,
  requesterUserId?: string,
  token?: string
): Promise<{
  tournament: CustomTournament;
  participants: CustomTournamentParticipant[];
  fixtures: CustomTournamentFixture[];
  standings?: CustomTournamentStandingsRow[];
  canManage: boolean;
}> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  let tournament: CustomTournament | undefined;
  let participants: CustomTournamentParticipant[] = [];
  let fixtures: CustomTournamentFixture[] = [];

  if (isFallback) {
    tournament = memoryTournaments.get(tournamentId);
    participants = memoryParticipants.get(tournamentId) || [];
    fixtures = memoryFixtures.get(tournamentId) || [];
  } else {
    const db = getFirestoreDb();
    const tDoc = await db.collection('custom_tournaments').doc(tournamentId).get();
    tournament = tDoc.data() as CustomTournament;
    const pSnap = await db.collection('custom_tournament_participants').where('tournamentId', '==', tournamentId).get();
    participants = pSnap.docs.map((d) => d.data() as CustomTournamentParticipant);
    const fSnap = await db.collection('custom_tournament_fixtures').where('tournamentId', '==', tournamentId).get();
    fixtures = fSnap.docs.map((d) => d.data() as CustomTournamentFixture);
  }

  if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });

  const isOrganizer = requesterUserId ? tournament.organizerUserId === requesterUserId : false;
  const isAssistant = requesterUserId ? tournament.assistantAdminIds.includes(requesterUserId) : false;
  const isParticipant = requesterUserId ? participants.some((p) => p.userId === requesterUserId) : false;
  const isTokenMatch = token ? tournament.inviteToken === token || tournament.spectatorToken === token : false;

  // Private tournament security boundary
  if (tournament.visibility === 'PRIVATE' && !isOrganizer && !isAssistant && !isParticipant && !isTokenMatch) {
    throw Object.assign(new Error('Bu yopiq (private) turnir. Ko‘rish uchun taklif havolasi talab qilinadi.'), {
      statusCode: 403,
      code: 'PRIVATE_ACCESS_DENIED',
    });
  }

  // Calculate standings if league stage exists
  let standings: CustomTournamentStandingsRow[] | undefined;
  if (tournament.format === 'LEAGUE' || tournament.format === 'LEAGUE_AND_PLAYOFF') {
    standings = calculateCustomStandings(participants, fixtures);
  }

  return {
    tournament,
    participants,
    fixtures,
    standings,
    canManage: isOrganizer || isAssistant,
  };
}

/**
 * Leaves tournament before start, freeing up the club claim.
 */
export async function leaveTournamentClub(params: {
  tournamentId: string;
  userId: string;
}): Promise<{ success: boolean; freedClubId: string }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  if (isFallback) {
    const tournament = memoryTournaments.get(params.tournamentId);
    if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnir boshlangandan keyin chiqib ketish mumkin emas (texnik mag‘lubiyat qo‘llanadi).'), {
        statusCode: 400,
        code: 'CANNOT_LEAVE_STARTED_TOURNAMENT',
      });
    }

    const participants = memoryParticipants.get(params.tournamentId) || [];
    const partIdx = participants.findIndex((p) => p.userId === params.userId);
    if (partIdx === -1) {
      throw Object.assign(new Error('Siz bu turnirda qatnashmaysiz.'), { statusCode: 404 });
    }

    const freedClubId = participants[partIdx].clubId;
    participants.splice(partIdx, 1);
    memoryParticipants.set(params.tournamentId, participants);
    memoryClubClaims.delete(`${params.tournamentId}_${freedClubId}`);

    tournament.currentParticipantsCount = participants.length;
    tournament.updatedAt = now;
    memoryTournaments.set(params.tournamentId, tournament);

    return { success: true, freedClubId };
  }

  const db = getFirestoreDb();
  const tournRef = db.collection('custom_tournaments').doc(params.tournamentId);
  const userClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_user_${params.userId}`);

  return await db.runTransaction(async (transaction) => {
    const tournDoc = await transaction.get(tournRef);
    if (!tournDoc.exists) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    const tournament = tournDoc.data() as CustomTournament;

    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw Object.assign(new Error('Turnir boshlangandan keyin chiqib ketish mumkin emas.'), {
        statusCode: 400,
        code: 'CANNOT_LEAVE_STARTED_TOURNAMENT',
      });
    }

    const userClaimDoc = await transaction.get(userClaimRef);
    if (!userClaimDoc.exists) {
      throw Object.assign(new Error('Siz bu turnirda qatnashmaysiz.'), { statusCode: 404 });
    }

    const freedClubId = userClaimDoc.data()?.clubId;
    const clubClaimRef = db.collection('custom_tournament_claims').doc(`${params.tournamentId}_club_${freedClubId}`);
    const partRef = db.collection('custom_tournament_participants').doc(`${params.tournamentId}_${freedClubId}`);

    transaction.delete(userClaimRef);
    transaction.delete(clubClaimRef);
    transaction.delete(partRef);
    transaction.update(tournRef, {
      currentParticipantsCount: Math.max(0, tournament.currentParticipantsCount - 1),
      updatedAt: now,
    });

    return { success: true, freedClubId };
  });
}

/**
 * Manages assistant admins for the tournament (Organizer only).
 */
export async function updateAssistantAdmins(params: {
  tournamentId: string;
  organizerUserId: string;
  assistantUserId: string;
  action: 'ADD' | 'REMOVE';
}): Promise<{ assistantAdminIds: string[] }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  if (isFallback) {
    const tournament = memoryTournaments.get(params.tournamentId);
    if (!tournament) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
    if (tournament.organizerUserId !== params.organizerUserId) {
      throw Object.assign(new Error('Faqat tashkilotchi yordamchi adminlarni boshqara oladi.'), { statusCode: 403 });
    }

    const currentSet = new Set(tournament.assistantAdminIds || []);
    if (params.action === 'ADD') currentSet.add(params.assistantUserId);
    else currentSet.delete(params.assistantUserId);

    tournament.assistantAdminIds = Array.from(currentSet);
    tournament.updatedAt = now;
    memoryTournaments.set(params.tournamentId, tournament);

    return { assistantAdminIds: tournament.assistantAdminIds };
  }

  const db = getFirestoreDb();
  const tournRef = db.collection('custom_tournaments').doc(params.tournamentId);
  const tDoc = await tournRef.get();
  if (!tDoc.exists) throw Object.assign(new Error('Turnir topilmadi.'), { statusCode: 404 });
  const tournament = tDoc.data() as CustomTournament;

  if (tournament.organizerUserId !== params.organizerUserId) {
    throw Object.assign(new Error('Faqat tashkilotchi yordamchi adminlarni boshqara oladi.'), { statusCode: 403 });
  }

  const currentSet = new Set(tournament.assistantAdminIds || []);
  if (params.action === 'ADD') currentSet.add(params.assistantUserId);
  else currentSet.delete(params.assistantUserId);

  const updatedList = Array.from(currentSet);
  await tournRef.update({ assistantAdminIds: updatedList, updatedAt: now });

  return { assistantAdminIds: updatedList };
}

/**
 * Administrative dispute resolution or manual score correction with audit trail.
 */
export async function correctCustomMatchScore(params: {
  tournamentId: string;
  fixtureId: string;
  adminUserId: string;
  homeScore: number;
  awayScore: number;
  penaltyHomeScore?: number;
  penaltyAwayScore?: number;
  note?: string;
}): Promise<{ fixture: CustomTournamentFixture }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  let tournament: CustomTournament | undefined;
  let fixture: CustomTournamentFixture | undefined;

  if (isFallback) {
    tournament = memoryTournaments.get(params.tournamentId);
    const list = memoryFixtures.get(params.tournamentId) || [];
    fixture = list.find((f) => f.id === params.fixtureId);
  } else {
    const db = getFirestoreDb();
    const tDoc = await db.collection('custom_tournaments').doc(params.tournamentId).get();
    tournament = tDoc.data() as CustomTournament;
    const fDoc = await db.collection('custom_tournament_fixtures').doc(params.fixtureId).get();
    fixture = fDoc.data() as CustomTournamentFixture;
  }

  if (!tournament || !fixture) throw Object.assign(new Error('Match yoki turnir topilmadi.'), { statusCode: 404 });

  const isOrganizer = tournament.organizerUserId === params.adminUserId;
  const isAssistant = tournament.assistantAdminIds.includes(params.adminUserId);
  if (!isOrganizer && !isAssistant) {
    throw Object.assign(new Error('Faqat tashkilotchi yoki yordamchi admin natijani tuzata oladi.'), { statusCode: 403 });
  }

  fixture.homeScore = params.homeScore;
  fixture.awayScore = params.awayScore;
  fixture.penaltyHomeScore = params.penaltyHomeScore ?? null;
  fixture.penaltyAwayScore = params.penaltyAwayScore ?? null;
  fixture.status = 'CONFIRMED';
  fixture.confirmedAt = now;

  // Handle playoff advancement if playoff stage
  if (fixture.stage.startsWith('PLAYOFF')) {
    const outcome = resolvePlayoffWinner(fixture);
    fixture.winnerClubId = outcome.winnerClubId;
  }

  // Audit log entry
  const auditLog: CustomTournamentAuditLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tournamentId: params.tournamentId,
    action: 'DISPUTE_RESOLVED',
    performedByUserId: params.adminUserId,
    details: {
      fixtureId: params.fixtureId,
      homeScore: params.homeScore,
      awayScore: params.awayScore,
      penaltyHomeScore: params.penaltyHomeScore,
      penaltyAwayScore: params.penaltyAwayScore,
      note: params.note || 'Admin manual score adjustment / dispute resolution',
    },
    createdAt: now,
  };

  if (isFallback) {
    const logs = memoryAuditLogs.get(params.tournamentId) || [];
    logs.push(auditLog);
    memoryAuditLogs.set(params.tournamentId, logs);
    const fList = memoryFixtures.get(params.tournamentId) || [];
    const idx = fList.findIndex((f) => f.id === fixture!.id);
    if (idx >= 0) fList[idx] = fixture;
  } else {
    const db = getFirestoreDb();
    await db.collection('custom_tournament_fixtures').doc(fixture.id).set(fixture, { merge: true });
    await db.collection('custom_tournament_audit_logs').doc(auditLog.id).set(auditLog);
  }

  return { fixture };
}

/**
 * Retrieves audit logs for a tournament (Admin / Host only).
 */
export async function getTournamentAuditLogs(tournamentId: string): Promise<CustomTournamentAuditLog[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  if (isFallback) {
    return memoryAuditLogs.get(tournamentId) || [];
  }
  const db = getFirestoreDb();
  const snap = await db
    .collection('custom_tournament_audit_logs')
    .where('tournamentId', '==', tournamentId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snap.docs.map((d) => d.data() as CustomTournamentAuditLog);
}
