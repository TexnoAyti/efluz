import { getFirestoreDb } from '../firebase/admin';
import {
  COLLECTIONS,
  FirestoreCompetitionDoc,
  FirestoreCompetitionParticipantDoc,
  FirestoreFixtureDoc,
  FirestoreClubDoc,
} from '../firebase/collections';
import { calculateCompetitionStandingsFirestore, rebuildCompetitionStandingsFirestore, firestoreCircuitBreaker, trackFirestoreRead } from '../firebase/firestoreStore';
import { createAuditLog } from '../services/adminService';
import { createNotification } from '../services/notificationService';
import { enqueueSmartTelegramNotification, notifySmartEuropeanZones } from '../services/smartNotificationService';
import { queryAll, queryGet, queryRun } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS, SEED_LEAGUES } from '../db/seed';
import {
  redisGetRaw,
  redisSetRaw,
  redisGetFresh,
  redisGetLkg,
  invalidateDataset,
  readThroughReadModel,
  getUpstashClient,
  ReadModelKeys,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import crypto from 'crypto';
import { projectStandings } from './standingsProjection';

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
  sourceFingerprint?: string;
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

function fingerprintSnapshots(snapshots: any[]): string {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const rows = snapshots.map(s => s.docs.map((d: any) => ({ id: d.id, data: d.data() })).sort((a: any,b: any) => a.id.localeCompare(b.id)));
  return crypto.createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
}

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
      throw new Error('QUALIFICATION_PREVIEW_STORAGE_UNAVAILABLE');
    }
  } else if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) {
    throw new Error('REDIS_REQUIRED_FOR_QUALIFICATION_PREVIEW');
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

  // The isolated regression suite uses the SQLite seed with an empty in-memory
  // Firestore. Materialize the same read-only seed metadata only in that
  // explicit fallback mode so qualification format guards can be exercised.
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    for (const league of SEED_LEAGUES) {
      await db.collection(COLLECTIONS.COMPETITIONS).doc(league.id).set({
        id: league.id,
        seasonId,
        type: 'LEAGUE',
        name: league.name,
      }, { merge: true });
    }
    for (const competition of SEED_COMPETITIONS) {
      await db.collection(COLLECTIONS.COMPETITIONS).doc(competition.id).set({
        id: competition.id,
        seasonId: competition.seasonId || seasonId,
        leagueId: competition.leagueId,
        type: competition.type,
        name: competition.name,
        formatConfig: competition.formatConfig,
      }, { merge: true });
    }
  }

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
  const uclTotal = Number(((uclComp as FirestoreCompetitionDoc).formatConfig as any)?.leaguePhaseTeams);
  const uelTotal = Number(((uelComp as FirestoreCompetitionDoc).formatConfig as any)?.leaguePhaseTeams);
  if (!Number.isInteger(uclTotal) || !Number.isInteger(uelTotal) || uclTotal < 2 || uelTotal < 2) throw new Error('EUROPEAN_FORMAT_NOT_CONFIGURED');
  const europeanFixtures = allFixtures.filter(
    (f) => f.competitionId === uclComp.id || f.competitionId === uelComp.id
  );
  const playedEuropeanFixtures = europeanFixtures.filter(
    (f) => f.status !== 'SCHEDULED'
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
    const standings = projectStandings(SEED_CLUBS.filter(c => c.leagueId === league.leagueId), allFixtures.filter(f => f.competitionId === league.id), league.formatConfig);
    if (standings.length === 0) continue;

    const uclConfig = (uclComp as FirestoreCompetitionDoc).formatConfig as any;
    const uelConfig = (uelComp as FirestoreCompetitionDoc).formatConfig as any;
    const leagueConfig = league.formatConfig as any;
    const uclSpots = Number(uclConfig?.qualificationSlots?.[league.id] ?? leagueConfig?.qualificationSpots);
    const uelSpots = Number(uelConfig?.qualificationSlots?.[league.id] ?? leagueConfig?.europaQualificationSpots ?? leagueConfig?.qualificationSpots);
    if (!Number.isInteger(uclSpots) || !Number.isInteger(uelSpots) || uclSpots < 0 || uelSpots < 0 || uclSpots + uelSpots > standings.length) {
      throw new Error(`QUALIFICATION_ALLOCATION_INVALID: ${league.id}`);
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
    totalTarget: uclTotal,
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
    totalTarget: uelTotal,
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

  if (projectedUcl.length !== uclTotal || projectedUel.length !== uelTotal) {
    canApply = false;
    blockReason = 'QUALIFICATION_TOTAL_MISMATCH: review configured league allocations and competition team counts';
  }
  const preview: EuropeanQualificationPreview = {
    sourceFingerprint: fingerprintSnapshots([compSnap, partsSnap, fixSnap, occSnap]),
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
        totalTarget: uclTotal,
        retainedCount: uclDiff.retained.length,
        addedCount: uclDiff.added.length,
        removedCount: uclDiff.removed.length,
      },
      uel: {
        totalTarget: uelTotal,
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

  if (!preview.sourceFingerprint || Date.parse(preview.expiresAt) <= Date.now() || (params.seasonId && params.seasonId !== preview.seasonId)) {
    throw new Error('PREVIEW_EXPIRED_OR_SEASON_MISMATCH: generate a new preview');
  }

  const db = getFirestoreDb();

  // STRICT APPLY-TIME VALIDATION:
  // 1. Re-check European competitions have not started (played or in-progress fixtures)
  const activeEuropeanFixSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', 'in', [preview.diff.ucl.competitionId, preview.diff.uel.competitionId])
    .where('status', 'in', ['CONFIRMED', 'PLAYING', 'IN_PROGRESS', 'AWAITING_RESULT', 'PENDING_CONFIRMATION', 'DISPUTED'])
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
      .get();
    const leagueIds = [
      'comp-premier-league-2026',
      'comp-la-liga-2026',
      'comp-serie-a-2026',
      'comp-bundesliga-2026',
      'comp-ligue-1-2026',
    ];
    const unplayedLeagueMatches = unplayedLeaguesSnap.docs.filter((d) =>
      leagueIds.includes(d.data().competitionId) && d.data().status !== 'CONFIRMED'
    ).length;
    if (unplayedLeagueMatches > 0) {
      throw new Error(
        `Precondition Failed: Domestic leagues still have ${unplayedLeagueMatches} unplayed scheduled matches. Final qualification sync cannot be applied.`
      );
    }
  }

  const now = new Date().toISOString();
  const participantsAdded = preview.diff.ucl.added.length + preview.diff.uel.added.length;
  const participantsRemoved = preview.diff.ucl.removed.length + preview.diff.uel.removed.length;
  const notificationsToSend: Array<{ userId: string; title: string; message: string }> = [];
  await db.runTransaction(async transaction => {
    const collections = [COLLECTIONS.COMPETITIONS, COLLECTIONS.COMPETITION_PARTICIPANTS, COLLECTIONS.FIXTURES, COLLECTIONS.CLUB_OCCUPANCIES];
    const snapshots = [];
    for (const collection of collections) snapshots.push(await transaction.get(db.collection(collection).where('seasonId', '==', preview.seasonId)));
    const applicationRef = db.collection('qualification_applications').doc(params.previewToken);
    const application = await transaction.get(applicationRef);
    if (application.exists) throw new Error('PREVIEW_ALREADY_APPLIED');
    if (fingerprintSnapshots(snapshots) !== preview.sourceFingerprint) throw new Error('PREVIEW_DATA_CHANGED: refresh and review the new preview');
    const existing = snapshots[1].docs;
    for (const q of preview.projectedQualifications) {
      const matches = existing.filter(d => d.data().competitionId === q.targetCompetitionId && d.data().clubId === q.clubId);
      if (matches.length > 1) throw new Error('DUPLICATE_PARTICIPANTS: manual review required');
      const id = matches[0]?.id || `part-${q.targetCompetitionId}-${q.clubId}`;
      transaction.set(db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(id), {
        id, seasonId: preview.seasonId, competitionId: q.targetCompetitionId, clubId: q.clubId,
        ownerUserId: q.ownerUserId, sourceCompetitionId: q.sourceCompetitionId,
        sourcePosition: q.rank, qualificationReason: q.reason, qualificationTimestamp: now,
        createdAt: matches[0]?.data().createdAt || now, updatedAt: now,
      }, { merge: true });
    }
    for (const diff of [preview.diff.ucl, preview.diff.uel]) {
      for (const removed of diff.removed) {
        const matches = existing.filter(d => d.data().competitionId === diff.competitionId && d.data().clubId === removed.clubId);
        if (matches.length !== 1) throw new Error('PARTICIPANT_REMOVAL_AMBIGUOUS');
        transaction.delete(db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(matches[0].id));
      }
    }
    transaction.set(applicationRef, { appliedAt: now, adminUserId: params.adminUserId, seasonId: preview.seasonId, sourceFingerprint: preview.sourceFingerprint });
  });

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
  for (const diff of [preview.diff.ucl, preview.diff.uel]) {
    for (const removed of diff.removed) {
      try { queryRun('DELETE FROM competition_participants WHERE competition_id = ? AND season_id = ? AND club_id = ?', [diff.competitionId, preview.seasonId, removed.clubId]); } catch {}
    }
  }
  await deleteQualificationPreviewToken(params.previewToken);

  // Invalidate competition participants and table caches
  await invalidateDataset(ReadModelKeys.competitions(preview.seasonId));
  for (const compId of [preview.diff.ucl.competitionId, preview.diff.uel.competitionId]) {
    await invalidateDataset(ReadModelKeys.standings(compId, preview.seasonId));
    await invalidateDataset(ReadModelKeys.competitionFixtures(compId, preview.seasonId));
    await invalidateDataset(`european:standings:${compId}:${preview.seasonId}`);
  }

  // Final qualification is an event: notify in-app and Telegram without adding Firestore reads.
  if (preview.mode === 'final') {
    for (const q of preview.projectedQualifications) {
      if (!q.ownerUserId) continue;
      notificationsToSend.push({
        userId: q.ownerUserId,
        title: `🏆 ${q.targetCompetitionName} yo‘llanmasi`,
        message: `${q.clubName} ${q.targetCompetitionName} turniriga yo‘llanma oldi. ${q.reason}`,
      });
    }
  }
  await Promise.all(
    notificationsToSend.map(async (n) => {
      await Promise.allSettled([
        createNotification(n.userId, 'QUALIFICATION_CONFIRMED', n.title, n.message),
        enqueueSmartTelegramNotification({
          userId: n.userId,
          seasonId: preview.seasonId,
          eventId: `qualification:${preview.previewToken}:${n.userId}:${n.title}`,
          title: n.title,
          body: n.message,
        }),
      ]);
    })
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
  ).catch(() => console.warn('[QUALIFICATION] Applied transaction recorded; auxiliary audit unavailable'));

  return {
    success: true,
    message: `Successfully applied European qualifications sync (${preview.mode}): ${participantsAdded} added, ${participantsRemoved} removed.`,
    qualificationsApplied: preview.projectedQualifications.length,
    participantsAdded,
    participantsRemoved,
  };
}

export function computeEuropeanStandingsRows(
  format: any,
  clubIds: string[],
  fixtures: any[],
  seasonId = 'season-2026-27'
): EuropeanStandingsRow[] {
  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const uniqueClubIds = [...new Set(clubIds)];
  const totalTeams = Number(format?.leaguePhaseTeams);
  const directQualifiers = Number(format?.directQualifiers);
  const playoffTeams = Number(format?.playoffTeams);
  if (!Number.isInteger(totalTeams) || totalTeams !== uniqueClubIds.length || !Number.isInteger(directQualifiers) || !Number.isInteger(playoffTeams) || directQualifiers + playoffTeams > totalTeams) {
    throw new Error('EUROPEAN_FORMAT_PARTICIPANTS_MISMATCH');
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

  for (const cid of uniqueClubIds) {
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
    const homeScore = f.homeScore ?? f.home_score;
    const awayScore = f.awayScore ?? f.away_score;
    const homeClubId = f.homeClubId ?? f.home_club_id;
    const awayClubId = f.awayClubId ?? f.away_club_id;
    const fSeasonId = f.seasonId ?? f.season_id;
    const roundName = f.roundName ?? f.round_name ?? '';
    const id = f.id;

    if (f.status !== 'CONFIRMED' || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) continue;
    if ((fSeasonId && fSeasonId !== seasonId) || !homeClubId || !awayClubId) continue;
    if (/quarter|semi|final|play.?off|round of|knockout/i.test(roundName) || /-r[1-5]-m/.test(id)) continue;

    const home = statsMap.get(homeClubId);
    const away = statsMap.get(awayClubId);

    if (home) {
      home.played += 1;
      home.goalsFor += homeScore;
      home.goalsAgainst += awayScore;
      home.goalDifference = home.goalsFor - home.goalsAgainst;

      if (homeScore > awayScore) {
        home.won += 1;
        home.points += 3;
      } else if (homeScore === awayScore) {
        home.drawn += 1;
        home.points += 1;
      } else {
        home.lost += 1;
      }
    }

    if (away) {
      away.played += 1;
      away.goalsFor += awayScore;
      away.goalsAgainst += homeScore;
      away.goalDifference = away.goalsFor - away.goalsAgainst;

      if (awayScore > homeScore) {
        away.won += 1;
        away.points += 3;
      } else if (homeScore === awayScore) {
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

  return sorted.map((s, idx) => {
    const position = idx + 1;
    let zone: EuropeanStandingsRow['zone'] = 'ELIMINATED';
    let zoneLabel = 'Eliminated';

    if (position <= directQualifiers) {
      zone = 'DIRECT_R16';
      zoneLabel = 'Round of 16 (Direct Qualification)';
    } else if (position <= directQualifiers + playoffTeams) {
      zone = 'KNOCKOUT_PLAYOFF';
      zoneLabel = 'Knockout Play-offs';
    }

    return {
      position,
      clubId: s.clubId,
      clubName: s.clubName,
      shortName: clubsMap.get(s.clubId)?.shortName || s.clubName,
      logoUrl: s.badgeUrl,
      form: [],
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
}

export function calculateEuropeanStandingsFromSqlite(
  competitionId: string,
  seasonId = 'season-2026-27'
): EuropeanStandingsRow[] | null {
  try {
    const compRow = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    let formatConfig: any = null;
    if (compRow && compRow.format_config) {
      try {
        formatConfig = typeof compRow.format_config === 'string' ? JSON.parse(compRow.format_config) : compRow.format_config;
      } catch {}
    }
    if (!formatConfig) {
      const seedComp = SEED_COMPETITIONS.find((c) => c.id === competitionId);
      formatConfig = seedComp?.formatConfig;
    }
    if (!formatConfig) return null;

    let partRows = queryAll<{ club_id: string }>(
      'SELECT club_id FROM competition_participants WHERE competition_id = ?',
      [competitionId]
    );
    let clubIds = partRows.map((r) => r.club_id);
    if (clubIds.length === 0) {
      const { SEED_COMPETITION_PARTICIPANTS } = require('../db/seed');
      if (SEED_COMPETITION_PARTICIPANTS) {
        clubIds = SEED_COMPETITION_PARTICIPANTS
          .filter((p: any) => p.competitionId === competitionId)
          .map((p: any) => p.clubId);
      }
    }
    if (clubIds.length === 0) return null;

    const fixtures = queryAll<any>(
      `SELECT * FROM fixtures WHERE competition_id = ? AND (season_id = ? OR season_id IS NULL)`,
      [competitionId, seasonId]
    );

    return computeEuropeanStandingsRows(formatConfig, clubIds, fixtures, seasonId);
  } catch {
    return null;
  }
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

  // Track Firestore reads accurately with actual document counts
  trackFirestoreRead(COLLECTIONS.COMPETITIONS, compDoc.exists ? 1 : 0, 'rebuildEuropeanStandings:comp');
  trackFirestoreRead(COLLECTIONS.COMPETITION_PARTICIPANTS, partsSnap.docs.length, 'rebuildEuropeanStandings:participants');
  trackFirestoreRead(COLLECTIONS.FIXTURES, fixSnap.docs.length, 'rebuildEuropeanStandings:fixtures');

  const participants = partsSnap.docs.map((d) => d.data() as FirestoreCompetitionParticipantDoc);
  const fixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);

  let clubIds = participants.map((p) => p.clubId);
  if (clubIds.length === 0) {
    throw new Error('EUROPEAN_PARTICIPANTS_NOT_CONFIGURED');
  }
  const format = compDoc.data()?.formatConfig as any;
  const rows = computeEuropeanStandingsRows(format, clubIds, fixtures, seasonId);

  // Save to Redis Read Model (Fresh + LKG permanent)
  const cacheKey = ReadModelKeys.standings(competitionId, seasonId);
  await redisSetRaw(
    cacheKey,
    {
      data: rows,
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: 'rebuild-european-standings',
      expectedCount: [...new Set(clubIds)].length,
    },
    86400
  );

  const matchesPerTeam = Number(format?.matchesPerTeam);
  if (Number.isInteger(matchesPerTeam) && matchesPerTeam > 0 && rows.length > 0 && rows.every((row) => row.played >= matchesPerTeam)) {
    await notifySmartEuropeanZones({ competitionId, seasonId, rows }).catch((error: any) => {
      console.warn('[SMART_NOTIFY] European zone notification failed:', error?.message || error);
    });
  }

  return rows;
}

/**
 * Reads European standings through tiered read model:
 * Redis Fresh -> Redis LKG -> SQLite local calculation -> Bounded Firestore fallback
 */
export async function getEuropeanStandings(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<{ rows: EuropeanStandingsRow[]; source: string; degraded: boolean }> {
  const cacheKey = ReadModelKeys.standings(competitionId, seasonId);

  // 1. Memory / Redis Fresh
  const fresh = await redisGetFresh<EuropeanStandingsRow[]>(cacheKey);
  if (fresh?.data && Array.isArray(fresh.data) && fresh.data.length > 0) {
    return { rows: fresh.data, source: 'redis-fresh', degraded: false };
  }

  // 2. Redis LKG (Last-Known-Good)
  const lkg = await redisGetLkg<EuropeanStandingsRow[]>(cacheKey);
  if (lkg?.data && Array.isArray(lkg.data) && lkg.data.length > 0) {
    return { rows: lkg.data, source: 'redis-lkg', degraded: true };
  }

  // 3. SQLite calculation from locally available fixtures/participants
  const sqliteRows = calculateEuropeanStandingsFromSqlite(competitionId, seasonId);
  if (sqliteRows && sqliteRows.length > 0) {
    redisSetRaw(cacheKey, {
      data: sqliteRows,
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: 'european-sqlite',
      expectedCount: sqliteRows.length,
    }, 86400).catch(() => {});
    return { rows: sqliteRows, source: 'sqlite', degraded: true };
  }

  // 4. Bounded Firestore fallback only when required
  const rows = await rebuildEuropeanStandings(competitionId, seasonId);
  return { rows, source: 'firestore-rebuild', degraded: false };
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
  // Legacy evaluation is preview-only; applying requires explicit admin review.

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
