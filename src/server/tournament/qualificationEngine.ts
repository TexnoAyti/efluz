import { getFirestoreDb } from '../firebase/admin';
import {
  COLLECTIONS,
  FirestoreCompetitionDoc,
  FirestoreCompetitionParticipantDoc,
  FirestoreFixtureDoc,
  FirestoreClubDoc,
} from '../firebase/collections';
import { calculateCompetitionStandingsFirestore, rebuildCompetitionStandingsFirestore, firestoreCircuitBreaker } from '../firebase/firestoreStore';
import { createAuditLog } from '../services/adminService';
import { createNotification } from '../services/notificationService';
import { queryAll, queryGet, queryRun } from '../db';
import { SEED_CLUBS } from '../db/seed';
import {
  redisGetRaw,
  redisSetRaw,
  redisDelRaw,
  getUpstashClient,
  ReadModelKeys,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import crypto from 'crypto';

export interface QualificationResult {
  seasonId: string;
  sourceCompetitionId: string;
  sourceCompetitionName: string;
  targetCompetitionId: string;
  targetCompetitionName: string;
  clubId: string;
  clubName: string;
  ownerUserId: string | null;
  rank: number;
  reason: string;
}

export interface EuropeanQualificationDiff {
  competitionId: string;
  competitionName: string;
  totalTarget: number;
  retained: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
  added: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
  removed: Array<{ clubId: string; clubName: string; previousReason?: string }>;
}

export interface EuropeanQualificationPreview {
  previewToken: string;
  seasonId: string;
  mode: 'provisional' | 'final';
  canApply: boolean;
  blockReason?: string;
  domesticLeaguesCompleted: boolean;
  unplayedLeagueMatchesCount: number;
  hasEuropeanStarted: boolean;
  summary: {
    ucl: { totalTarget: number; retainedCount: number; addedCount: number; removedCount: number };
    uel: { totalTarget: number; retainedCount: number; addedCount: number; removedCount: number };
  };
  diff: {
    ucl: EuropeanQualificationDiff;
    uel: EuropeanQualificationDiff;
  };
  projectedQualifications: QualificationResult[];
  generatedAt: string;
  expiresAt: string;
}

export interface EuropeanStandingsRow {
  position: number;
  clubId: string;
  clubName: string;
  badgeUrl?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  zone: 'DIRECT_R16' | 'KNOCKOUT_PLAYOFF' | 'ELIMINATED';
  zoneLabel: string;
}

// ----------------------------------------------------
// REDIS PREVIEW TOKEN STORE (15-Minute TTL)
// ----------------------------------------------------
const PREVIEW_TOKEN_REDIS_PREFIX = 'qualification:preview:';
const PREVIEW_TOKEN_TTL_SECONDS = 900; // 15 minutes
const previewTokenCache = new Map<string, { preview: EuropeanQualificationPreview; expiresAt: number }>();

export async function saveQualificationPreviewToken(
  token: string,
  preview: EuropeanQualificationPreview
): Promise<void> {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  const payload = {
    preview,
    token,
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_SECONDS * 1000,
  };
  const client = getUpstashClient();
  if (client) {
    try {
      await client.set(key, payload, { ex: PREVIEW_TOKEN_TTL_SECONDS });
    } catch (err: any) {
      console.warn(`[QUALIFICATION] Failed to write preview token to Upstash Redis:`, err?.message || err);
    }
  }
  previewTokenCache.set(token, payload);
}

export async function getQualificationPreviewToken(
  token: string
): Promise<EuropeanQualificationPreview | null> {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  const client = getUpstashClient();
  if (client) {
    try {
      const data = await client.get<any>(key);
      if (data && data.preview) {
        return data.preview;
      }
    } catch (err: any) {
      console.warn(`[QUALIFICATION] Failed to read preview token from Upstash Redis:`, err?.message || err);
    }
  }
  const mem = previewTokenCache.get(token);
  if (mem && Date.now() <= mem.expiresAt) {
    return mem.preview;
  }
  return null;
}

export async function deleteQualificationPreviewToken(token: string): Promise<void> {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  previewTokenCache.delete(token);
  const client = getUpstashClient();
  if (client) {
    try {
      await client.del(key);
    } catch {}
  }
}

/**
 * Previews European Qualification synchronization (provisional vs final).
 * STRICT DATA SAFETY GUARDS:
 * 1. Block participant sync if competition has started.
 * 2. Block finalization until domestic leagues finish.
 * 3. Never do automatic destructive purges.
 */
export async function previewEuropeanQualificationSync(
  seasonId = 'season-2026-27',
  mode: 'provisional' | 'final' = 'provisional'
): Promise<EuropeanQualificationPreview> {
  const db = getFirestoreDb();
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Fetch competitions, participants, fixtures and occupancies
  const [compSnap, partsSnap, fixSnap, occSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).where('seasonId', '==', seasonId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('seasonId', '==', seasonId).get(),
    db.collection(COLLECTIONS.FIXTURES).where('seasonId', '==', seasonId).get(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).get(),
  ]);

  const allComps = compSnap.docs.map((d) => d.data() as FirestoreCompetitionDoc);
  const leagues = allComps.filter((c) => c.type === 'LEAGUE');
  const allFixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);
  const existingParts = partsSnap.docs.map((d) => d.data() as FirestoreCompetitionParticipantDoc);

  const occupancyMap = new Map<string, string>();
  for (const doc of occSnap.docs) {
    const data = doc.data();
    if (data.userId && data.clubId) {
      occupancyMap.set(data.clubId, data.userId);
    }
  }

  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));

  // Identify UCL and UEL competitions
  const uclComp = allComps.find(
    (c) => c.type === 'EUROPEAN_LEAGUE_PHASE' && (c.name.toLowerCase().includes('champions') || c.id.includes('ucl'))
  ) || { id: 'comp-champions-league-2026', name: 'UEFA Champions League', seasonId, type: 'EUROPEAN_LEAGUE_PHASE' as const };

  const uelComp = allComps.find(
    (c) => c.type === 'EUROPEAN_LEAGUE_PHASE' && (c.name.toLowerCase().includes('europa') || c.id.includes('uel'))
  ) || { id: 'comp-europa-league-2026', name: 'UEFA Europa League', seasonId, type: 'EUROPEAN_LEAGUE_PHASE' as const };

  // SAFETY GUARD 1: Has UCL or UEL competition started?
  const europeanFixtures = allFixtures.filter(
    (f) => f.competitionId === uclComp.id || f.competitionId === uelComp.id
  );
  const playedEuropeanFixtures = europeanFixtures.filter(
    (f) => f.status === 'CONFIRMED' || f.status === 'PENDING_CONFIRMATION' || f.status === 'AWAITING_RESULT'
  );
  const hasEuropeanStarted = playedEuropeanFixtures.length > 0;

  // SAFETY GUARD 2: Check domestic league completion
  const leagueIds = new Set(leagues.map((l) => l.id));
  const leagueFixtures = allFixtures.filter((f) => leagueIds.has(f.competitionId));
  const unplayedLeagueMatchesCount = leagueFixtures.filter((f) => f.status !== 'CONFIRMED').length;
  const domesticLeaguesCompleted = leagueFixtures.length > 0 && unplayedLeagueMatchesCount === 0;

  let canApply = true;
  let blockReason: string | undefined;

  if (hasEuropeanStarted) {
    canApply = false;
    blockReason = `European competitions have already started (${playedEuropeanFixtures.length} played/in-progress matches). Participant synchronization is strictly blocked to protect active competition integrity.`;
  } else if (mode === 'final' && !domesticLeaguesCompleted) {
    canApply = false;
    blockReason = `Domestic leagues are not finished (${unplayedLeagueMatchesCount} unconfirmed fixtures remaining). Final European qualification sync can only be applied after all domestic league matches are confirmed.`;
  }

  // Calculate projected qualifications from domestic league standings
  const projectedUcl: QualificationResult[] = [];
  const projectedUel: QualificationResult[] = [];

  for (const league of leagues) {
    const standings = await calculateCompetitionStandingsFirestore(league.id);
    if (standings.length === 0) continue;

    const leagueIdLower = (league.id || '').toLowerCase();
    const leagueNameLower = (league.name || '').toLowerCase();

    // Allocation quotas:
    // Premier League: 7 UCL, 7 UEL
    // La Liga: 7 UCL, 7 UEL
    // Serie A: 6 UCL, 6 UEL
    // Bundesliga: 6 UCL, 6 UEL
    // Ligue 1: 6 UCL, 6 UEL
    // Total: exactly 32 UCL, 32 UEL!
    let uclSpots = 7;
    let uelSpots = 7;

    if (
      leagueIdLower.includes('serie-a') ||
      leagueNameLower.includes('serie a') ||
      leagueIdLower.includes('bundesliga') ||
      leagueNameLower.includes('bundesliga') ||
      leagueIdLower.includes('ligue-1') ||
      leagueNameLower.includes('ligue 1')
    ) {
      uclSpots = 6;
      uelSpots = 6;
    }

    // UCL spots
    for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
      const row = standings[i];
      const ownerUserId = occupancyMap.get(row.clubId) || null;
      projectedUcl.push({
        seasonId,
        sourceCompetitionId: league.id,
        sourceCompetitionName: league.name,
        targetCompetitionId: uclComp.id,
        targetCompetitionName: uclComp.name,
        clubId: row.clubId,
        clubName: row.clubName,
        ownerUserId,
        rank: row.position,
        reason: `${league.name} Rank #${row.position} (UCL Spot)`,
      });
    }

    // UEL spots
    for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
      const row = standings[i];
      const ownerUserId = occupancyMap.get(row.clubId) || null;
      projectedUel.push({
        seasonId,
        sourceCompetitionId: league.id,
        sourceCompetitionName: league.name,
        targetCompetitionId: uelComp.id,
        targetCompetitionName: uelComp.name,
        clubId: row.clubId,
        clubName: row.clubName,
        ownerUserId,
        rank: row.position,
        reason: `${league.name} Rank #${row.position} (UEL Spot)`,
      });
    }
  }

  // Compute Diffs for UCL & UEL against existing participants
  const existingUclParts = existingParts.filter((p) => p.competitionId === uclComp.id);
  const existingUclClubIds = new Set(existingUclParts.map((p) => p.clubId));
  const projectedUclClubIds = new Set(projectedUcl.map((p) => p.clubId));

  const uclDiff: EuropeanQualificationDiff = {
    competitionId: uclComp.id,
    competitionName: uclComp.name,
    totalTarget: 32,
    retained: projectedUcl
      .filter((p) => existingUclClubIds.has(p.clubId))
      .map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    added: projectedUcl
      .filter((p) => !existingUclClubIds.has(p.clubId))
      .map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    removed: existingUclParts
      .filter((p) => !projectedUclClubIds.has(p.clubId))
      .map((p) => {
        const club = clubsMap.get(p.clubId);
        return { clubId: p.clubId, clubName: club?.name || p.clubId, previousReason: p.qualificationReason };
      }),
  };

  const existingUelParts = existingParts.filter((p) => p.competitionId === uelComp.id);
  const existingUelClubIds = new Set(existingUelParts.map((p) => p.clubId));
  const projectedUelClubIds = new Set(projectedUel.map((p) => p.clubId));

  const uelDiff: EuropeanQualificationDiff = {
    competitionId: uelComp.id,
    competitionName: uelComp.name,
    totalTarget: 32,
    retained: projectedUel
      .filter((p) => existingUelClubIds.has(p.clubId))
      .map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    added: projectedUel
      .filter((p) => !existingUelClubIds.has(p.clubId))
      .map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    removed: existingUelParts
      .filter((p) => !projectedUelClubIds.has(p.clubId))
      .map((p) => {
        const club = clubsMap.get(p.clubId);
        return { clubId: p.clubId, clubName: club?.name || p.clubId, previousReason: p.qualificationReason };
      }),
  };

  const previewToken = `prev-qual-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  const preview: EuropeanQualificationPreview = {
    previewToken,
    seasonId,
    mode,
    canApply,
    blockReason,
    domesticLeaguesCompleted,
    unplayedLeagueMatchesCount,
    hasEuropeanStarted,
    summary: {
      ucl: {
        totalTarget: 32,
        retainedCount: uclDiff.retained.length,
        addedCount: uclDiff.added.length,
        removedCount: uclDiff.removed.length,
      },
      uel: {
        totalTarget: 32,
        retainedCount: uelDiff.retained.length,
        addedCount: uelDiff.added.length,
        removedCount: uelDiff.removed.length,
      },
    },
    diff: {
      ucl: uclDiff,
      uel: uelDiff,
    },
    projectedQualifications: [...projectedUcl, ...projectedUel],
    generatedAt: nowIso,
    expiresAt,
  };

  await saveQualificationPreviewToken(previewToken, preview);

  return preview;
}

/**
 * Safely applies European Qualification synchronization using an approved preview token.
 * STRICT DATA SAFETY RULES:
 * - Requires explicit admin confirmation.
 * - Requires valid, non-expired previewToken stored in Redis.
 * - Non-destructive: preserves existing participants where possible, never blind batch delete.
 * - Enforces strict apply-time preconditions (competition not started, domestic leagues completed if final).
 */
export async function applyEuropeanQualificationSync(params: {
  seasonId?: string;
  previewToken: string;
  confirmation: boolean;
  adminUserId: string;
  adminUsername?: string;
}): Promise<{
  success: boolean;
  message: string;
  qualificationsApplied: number;
  participantsAdded: number;
  participantsRemoved: number;
}> {
  if (!params.confirmation) {
    throw new Error('Explicit admin confirmation is required to apply European qualifications sync.');
  }

  const preview = await getQualificationPreviewToken(params.previewToken);
  if (!preview) {
    throw new Error('Preview token is invalid, expired, or was already applied. Please generate a fresh preview before applying.');
  }

  if (!preview.canApply) {
    throw new Error(preview.blockReason || 'Cannot apply qualifications sync: preconditions failed.');
  }

  const db = getFirestoreDb();

  // STRICT APPLY-TIME VALIDATION:
  // 1. Re-check European competitions have not started (played or in-progress fixtures)
  const activeEuropeanFixSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', 'in', [preview.diff.ucl.competitionId, preview.diff.uel.competitionId])
    .where('status', 'in', ['CONFIRMED', 'PLAYING'])
    .limit(1)
    .get();

  if (!activeEuropeanFixSnap.empty) {
    throw new Error(
      'Precondition Failed: European competitions have already started with active or confirmed matches. Modifying participants is strictly prohibited.'
    );
  }

  // 2. If mode is final, re-verify all domestic league matches are completed
  if (preview.mode === 'final') {
    const unplayedLeaguesSnap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('seasonId', '==', preview.seasonId)
      .where('status', '==', 'SCHEDULED')
      .get();
    const leagueIds = [
      'comp-premier-league-2026',
      'comp-la-liga-2026',
      'comp-serie-a-2026',
      'comp-bundesliga-2026',
      'comp-ligue-1-2026',
    ];
    const unplayedLeagueMatches = unplayedLeaguesSnap.docs.filter((d) =>
      leagueIds.includes(d.data().competitionId)
    ).length;
    if (unplayedLeagueMatches > 0) {
      throw new Error(
        `Precondition Failed: Domestic leagues still have ${unplayedLeagueMatches} unplayed scheduled matches. Final qualification sync cannot be applied.`
      );
    }
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  let participantsAdded = 0;
  let participantsRemoved = 0;
  const notificationsToSend: Array<{ userId: string; title: string; message: string }> = [];

  // 1. Process UCL additions / updates
  for (let i = 0; i < preview.diff.ucl.added.length; i++) {
    const item = preview.diff.ucl.added[i];
    const qual = preview.projectedQualifications.find((q) => q.clubId === item.clubId && q.targetCompetitionId === preview.diff.ucl.competitionId);
    const partId = `part-${preview.diff.ucl.competitionId}-${item.clubId}`;
    const partRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(partId);

    const docData: FirestoreCompetitionParticipantDoc = {
      id: partId,
      competitionId: preview.diff.ucl.competitionId,
      clubId: item.clubId,
      seasonId: preview.seasonId,
      ownerUserId: qual?.ownerUserId || undefined,
      sourceCompetitionId: qual?.sourceCompetitionId,
      sourceCompetitionName: qual?.sourceCompetitionName,
      sourcePosition: item.rank,
      qualificationReason: qual?.reason || 'Qualified for UCL',
      qualificationTimestamp: now,
      seedNumber: i + 1,
      createdAt: now,
    };

    batch.set(partRef, docData, { merge: true });
    participantsAdded++;

    if (qual?.ownerUserId) {
      notificationsToSend.push({
        userId: qual.ownerUserId,
        title: '🏆 Qualified for UEFA Champions League!',
        message: `Congratulations! ${item.clubName} qualified for the UEFA Champions League (${item.sourceLeague} #${item.rank})!`,
      });
    }
  }

  // 2. Process UEL additions / updates
  for (let i = 0; i < preview.diff.uel.added.length; i++) {
    const item = preview.diff.uel.added[i];
    const qual = preview.projectedQualifications.find((q) => q.clubId === item.clubId && q.targetCompetitionId === preview.diff.uel.competitionId);
    const partId = `part-${preview.diff.uel.competitionId}-${item.clubId}`;
    const partRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(partId);

    const docData: FirestoreCompetitionParticipantDoc = {
      id: partId,
      competitionId: preview.diff.uel.competitionId,
      clubId: item.clubId,
      seasonId: preview.seasonId,
      ownerUserId: qual?.ownerUserId || undefined,
      sourceCompetitionId: qual?.sourceCompetitionId,
      sourceCompetitionName: qual?.sourceCompetitionName,
      sourcePosition: item.rank,
      qualificationReason: qual?.reason || 'Qualified for UEL',
      qualificationTimestamp: now,
      seedNumber: i + 1,
      createdAt: now,
    };

    batch.set(partRef, docData, { merge: true });
    participantsAdded++;

    if (qual?.ownerUserId) {
      notificationsToSend.push({
        userId: qual.ownerUserId,
        title: 'Qualified for UEFA Europa League',
        message: `Congratulations! ${item.clubName} qualified for the UEFA Europa League (${item.sourceLeague} #${item.rank})!`,
      });
    }
  }

  // 3. Process removals (only explicitly approved items from diff)
  for (const rem of [...preview.diff.ucl.removed, ...preview.diff.uel.removed]) {
    const compId = preview.diff.ucl.removed.includes(rem) ? preview.diff.ucl.competitionId : preview.diff.uel.competitionId;
    const partId = `part-${compId}-${rem.clubId}`;
    const partRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(partId);
    batch.delete(partRef);
    participantsRemoved++;
  }

  await batch.commit();

  // Mirror to SQLite
  for (const q of preview.projectedQualifications) {
    try {
      const partId = `part-${q.targetCompetitionId}-${q.clubId}`;
      queryRun(
        `INSERT OR REPLACE INTO competition_participants 
         (id, competition_id, club_id, season_id, owner_user_id, source_competition_id, source_position, qualification_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [partId, q.targetCompetitionId, q.clubId, preview.seasonId, q.ownerUserId, q.sourceCompetitionId, q.rank, q.reason, now]
      );
    } catch {}
  }

  // Remove used preview token from Redis and memory
  await deleteQualificationPreviewToken(params.previewToken);

  // Invalidate competition participants and table caches
  await redisDelRaw(ReadModelKeys.competitions(preview.seasonId)).catch(() => {});
  for (const compId of [preview.diff.ucl.competitionId, preview.diff.uel.competitionId]) {
    await redisDelRaw(ReadModelKeys.standings(compId, preview.seasonId)).catch(() => {});
    await redisDelRaw(ReadModelKeys.competitionFixtures(compId, preview.seasonId)).catch(() => {});
  }

  // Send notifications
  await Promise.all(
    notificationsToSend.map((n) =>
      createNotification(n.userId, 'QUALIFICATION_CONFIRMED', n.title, n.message).catch(() => {})
    )
  );

  // Write audit log
  await createAuditLog(
    params.adminUserId,
    'EUROPEAN_QUALIFICATIONS_SYNCED',
    'SEASON',
    preview.seasonId,
    undefined,
    {
      mode: preview.mode,
      totalQualified: preview.projectedQualifications.length,
      participantsAdded,
      participantsRemoved,
      previewToken: params.previewToken,
      timestamp: now,
    },
    undefined,
    params.adminUsername || 'admin',
    `Applied European qualification sync (${preview.mode}): ${participantsAdded} added, ${participantsRemoved} removed.`
  );

  return {
    success: true,
    message: `Successfully applied European qualifications sync (${preview.mode}): ${participantsAdded} added, ${participantsRemoved} removed.`,
    qualificationsApplied: preview.projectedQualifications.length,
    participantsAdded,
    participantsRemoved,
  };
}

/**
 * Rebuilds UEFA Champions League or Europa League single 32-team league phase standings table.
 */
export async function rebuildEuropeanStandings(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<EuropeanStandingsRow[]> {
  const db = getFirestoreDb();

  // 1. Fetch participants and fixtures
  const [compDoc, partsSnap, fixSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId', '==', competitionId).get(),
    db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get(),
  ]);

  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const participants = partsSnap.docs.map((d) => d.data() as FirestoreCompetitionParticipantDoc);
  const fixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);

  // If no registered participants, seed fallback from all clubs with seeds
  let clubIds = participants.map((p) => p.clubId);
  if (clubIds.length === 0) {
    clubIds = SEED_CLUBS.slice(0, 32).map((c) => c.id);
  }

  // Initialize standings map
  const statsMap = new Map<string, {
    clubId: string;
    clubName: string;
    badgeUrl?: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  }>();

  for (const cid of clubIds) {
    const club = clubsMap.get(cid);
    statsMap.set(cid, {
      clubId: cid,
      clubName: club?.name || cid,
      badgeUrl: club?.logoUrl,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  // Accumulate confirmed fixtures
  for (const f of fixtures) {
    if (f.status !== 'CONFIRMED' || f.homeScore === null || f.awayScore === null) continue;

    const home = statsMap.get(f.homeClubId);
    const away = statsMap.get(f.awayClubId);

    if (home) {
      home.played += 1;
      home.goalsFor += f.homeScore;
      home.goalsAgainst += f.awayScore;
      home.goalDifference = home.goalsFor - home.goalsAgainst;

      if (f.homeScore > f.awayScore) {
        home.won += 1;
        home.points += 3;
      } else if (f.homeScore === f.awayScore) {
        home.drawn += 1;
        home.points += 1;
      } else {
        home.lost += 1;
      }
    }

    if (away) {
      away.played += 1;
      away.goalsFor += f.awayScore;
      away.goalsAgainst += f.homeScore;
      away.goalDifference = away.goalsFor - away.goalsAgainst;

      if (f.awayScore > f.homeScore) {
        away.won += 1;
        away.points += 3;
      } else if (f.homeScore === f.awayScore) {
        away.drawn += 1;
        away.points += 1;
      } else {
        away.lost += 1;
      }
    }
  }

  // Sort by Points -> Goal Difference -> Goals For -> Club Name
  const sorted = Array.from(statsMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.clubName.localeCompare(b.clubName);
  });

  const rows: EuropeanStandingsRow[] = sorted.map((s, idx) => {
    const position = idx + 1;
    let zone: EuropeanStandingsRow['zone'] = 'ELIMINATED';
    let zoneLabel = 'Eliminated (25-32)';

    if (position <= 8) {
      zone = 'DIRECT_R16';
      zoneLabel = 'Round of 16 (Direct Qualification)';
    } else if (position <= 24) {
      zone = 'KNOCKOUT_PLAYOFF';
      zoneLabel = 'Knockout Play-offs (9-24)';
    }

    return {
      position,
      clubId: s.clubId,
      clubName: s.clubName,
      badgeUrl: s.badgeUrl,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      goalDifference: s.goalDifference,
      points: s.points,
      zone,
      zoneLabel,
    };
  });

  // Save to Redis Read Model (Fresh + LKG permanent)
  const cacheKey = `european:standings:${competitionId}:${seasonId}`;
  await redisSetRaw(
    cacheKey,
    {
      data: rows,
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: 'rebuild-european-standings',
      expectedCount: 32,
    },
    86400
  );

  return rows;
}

/**
 * Reads European standings through tiered read model.
 */
export async function getEuropeanStandings(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<{ rows: EuropeanStandingsRow[]; source: string; degraded: boolean }> {
  const cacheKey = `european:standings:${competitionId}:${seasonId}`;
  const raw = await redisGetRaw<EuropeanStandingsRow[]>(cacheKey);

  if (raw?.data && Array.isArray(raw.data) && raw.data.length > 0) {
    return {
      rows: raw.data,
      source: 'redis-read-model',
      degraded: false,
    };
  }

  try {
    const rows = await rebuildEuropeanStandings(competitionId, seasonId);
    return { rows, source: 'firestore', degraded: false };
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    return { rows: [], source: 'error-fallback', degraded: true };
  }
}

/**
 * Backwards compatibility wrapper for evaluateSeasonQualifications
 */
export async function evaluateSeasonQualifications(seasonId = 'season-2026-27'): Promise<{
  success: boolean;
  qualifications: QualificationResult[];
  participantsAdded: number;
}> {
  const preview = await previewEuropeanQualificationSync(seasonId, 'provisional');
  if (preview.canApply) {
    const res = await applyEuropeanQualificationSync({
      seasonId,
      previewToken: preview.previewToken,
      confirmation: true,
      adminUserId: 'system',
      adminUsername: 'system-evaluator',
    });
    return {
      success: true,
      qualifications: preview.projectedQualifications,
      participantsAdded: res.participantsAdded,
    };
  }

  return {
    success: false,
    qualifications: preview.projectedQualifications,
    participantsAdded: 0,
  };
}

export const evaluateSeasonQualificationsFirestore = evaluateSeasonQualifications;

/**
 * Resolves and populates Super Cup participants from league champions and cup winners/runners-up.
 */
export async function populateSuperCupParticipants(
  seasonId = 'season-2026-27',
  superCupCompetitionId: string
): Promise<{
  competitionId: string;
  participants: Array<{ clubId: string; clubName: string; role: string }>;
}> {
  const db = getFirestoreDb();
  const SUPER_CUP_MAP: Record<string, { leagueId: string; cupId?: string; name: string }> = {
    'comp-community-shield-2026': { leagueId: 'comp-premier-league-2026', cupId: 'comp-fa-cup-2026', name: 'FA Community Shield' },
    'comp-supercopa-2026': { leagueId: 'comp-la-liga-2026', cupId: 'comp-copa-del-rey-2026', name: 'Supercopa de España' },
    'comp-supercoppa-2026': { leagueId: 'comp-serie-a-2026', cupId: 'comp-coppa-italia-2026', name: 'Supercoppa Italiana' },
    'comp-dfl-supercup-2026': { leagueId: 'comp-bundesliga-2026', cupId: 'comp-dfb-pokal-2026', name: 'DFL-Supercup' },
    'comp-trophee-champions-2026': { leagueId: 'comp-ligue-1-2026', cupId: 'comp-coupe-de-france-2026', name: 'Trophée des Champions' },
    'comp-uefa-super-cup-2026': { leagueId: 'comp-champions-league-2026', cupId: 'comp-europa-league-2026', name: 'UEFA Super Cup' },
  };

  const config = SUPER_CUP_MAP[superCupCompetitionId] || { leagueId: 'comp-premier-league-2026', name: 'Super Cup' };

  // Calculate league standings
  const leagueStandings = await calculateCompetitionStandingsFirestore(config.leagueId);
  const leagueChampion = leagueStandings[0];

  let secondClub = leagueStandings[1] || leagueStandings[0];
  if (config.cupId) {
    try {
      const cupFinalSnap = await db
        .collection(COLLECTIONS.FIXTURES)
        .where('competitionId', '==', config.cupId)
        .where('roundName', '==', 'Final')
        .get();
      if (!cupFinalSnap.empty) {
        const finalMatch = cupFinalSnap.docs[0].data() as FirestoreFixtureDoc;
        if (finalMatch.winnerClubId && finalMatch.winnerClubId !== leagueChampion?.clubId) {
          const cDoc = await db.collection(COLLECTIONS.CLUBS).doc(finalMatch.winnerClubId).get();
          if (cDoc.exists) {
            secondClub = {
              clubId: finalMatch.winnerClubId,
              clubName: (cDoc.data() as any)?.name || finalMatch.winnerClubId,
            } as any;
          }
        }
      }
    } catch {}
  }

  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const champClub = leagueChampion
    ? clubsMap.get(leagueChampion.clubId) || { id: leagueChampion.clubId, name: leagueChampion.clubName }
    : SEED_CLUBS[0];
  const chalClub = secondClub
    ? clubsMap.get(secondClub.clubId) || { id: secondClub.clubId, name: secondClub.clubName }
    : SEED_CLUBS[1];

  const participants = [
    { clubId: champClub.id, clubName: champClub.name, role: 'LEAGUE_CHAMPION' },
    { clubId: chalClub.id, clubName: chalClub.name, role: 'CUP_CHAMPION_OR_RUNNER_UP' },
  ];

  try {
    const batch = db.batch();
    for (const p of participants) {
      const docRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(`${superCupCompetitionId}_${p.clubId}`);
      batch.set(
        docRef,
        {
          id: `${superCupCompetitionId}_${p.clubId}`,
          competitionId: superCupCompetitionId,
          clubId: p.clubId,
          clubName: p.clubName,
          seasonId,
          qualificationReason: p.role,
          sourceCompetitionId: config.leagueId,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err: any) {
    console.warn('[SUPER_CUP] Firestore commit error:', err.message);
  }

  return {
    competitionId: superCupCompetitionId,
    participants,
  };
}

