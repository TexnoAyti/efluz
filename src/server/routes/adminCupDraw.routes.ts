import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { DOMESTIC_CUPS, validateDomesticCupId } from '../tournament/domesticCupService';
import { SEED_CLUBS } from '../db/seed';
import { queryRun } from '../db';
import { createAuditLog } from '../services/adminService';
import {
  getCompetitionStandingsFromReadModel,
  invalidateDataset,
  invalidateFixtureReadModels,
} from '../readModel/readModelStore';

export const adminCupDrawRouter = Router();
adminCupDrawRouter.use(requireAdmin);

const LEAGUE_COMPETITION_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'comp-premier-league-2026',
  'league-la-liga': 'comp-la-liga-2026',
  'league-serie-a': 'comp-serie-a-2026',
  'league-bundesliga': 'comp-bundesliga-2026',
  'league-ligue-1': 'comp-ligue-1-2026',
};

type SeededClub = {
  id: string;
  name: string;
  position: number;
};

type DrawMatch = {
  roundNumber: number;
  roundName: string;
  matchIndex: number;
  fixtureId: string;
  homeClubId: string | null;
  homeClubName: string;
  awayClubId: string | null;
  awayClubName: string;
  homeClub: { id: string | null; name: string; position?: number } | null;
  awayClub: { id: string | null; name: string; position?: number } | null;
  sourceFixtureId: string | null;
  sourceWinnerSlot: string | null;
  homeSourceFixtureId: string | null;
  awaySourceFixtureId: string | null;
  homeSourceWinnerSlot: string | null;
  awaySourceWinnerSlot: string | null;
};

function stringHash(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seedText: string): () => number {
  let state = stringHash(seedText) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: string): T[] {
  const out = [...items];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isProtectedFixture(fixture: any): boolean {
  return (
    String(fixture.status || 'SCHEDULED') !== 'SCHEDULED' ||
    fixture.homeScore !== null && fixture.homeScore !== undefined ||
    fixture.awayScore !== null && fixture.awayScore !== undefined ||
    Boolean(fixture.winnerClubId) ||
    Boolean(fixture.resultConfirmedAt)
  );
}

async function loadStandingsSeed(cupId: string, seasonId: string): Promise<SeededClub[]> {
  const cup = validateDomesticCupId(cupId);
  const leagueCompetitionId = LEAGUE_COMPETITION_BY_LEAGUE[cup.leagueId];
  if (!leagueCompetitionId) throw new Error(`No league competition mapping for ${cup.leagueId}`);

  const standingsResult = await getCompetitionStandingsFromReadModel(leagueCompetitionId, seasonId);
  const standings = Array.isArray(standingsResult?.standings) ? standingsResult.standings : [];
  const eligible = new Map(
    SEED_CLUBS.filter((club) => club.leagueId === cup.leagueId).map((club) => [club.id, club])
  );

  const seeded: SeededClub[] = standings
    .filter((row: any) => eligible.has(row.clubId))
    .sort((a: any, b: any) => Number(a.position || 999) - Number(b.position || 999))
    .map((row: any, index: number) => ({
      id: row.clubId,
      name: eligible.get(row.clubId)?.name || row.clubName || row.clubId,
      position: Number(row.position || index + 1),
    }));

  if (seeded.length !== cup.expectedTeams) {
    throw Object.assign(
      new Error(`STANDINGS_INCOMPLETE: expected ${cup.expectedTeams} clubs, got ${seeded.length}`),
      { statusCode: 409 }
    );
  }

  return seeded;
}

function buildDraw(cupId: string, seeded: SeededClub[], drawSeed: string) {
  const cup = validateDomesticCupId(cupId);
  const totalTeams = seeded.length;
  const prelimMatches = totalTeams - 16;
  const playInTeamsCount = prelimMatches * 2;
  const byeTeamsCount = totalTeams - playInTeamsCount;
  const pureByeMatches = (byeTeamsCount - prelimMatches) / 2;
  const totalRounds = 5;

  const byePool = seeded.slice(0, byeTeamsCount);
  const playInPool = seeded.slice(byeTeamsCount);
  const shuffledByes = shuffled(byePool, `${drawSeed}:bye`);
  const shuffledPlayIn = shuffled(playInPool, `${drawSeed}:playin`);

  const previewMatches: DrawMatch[] = [];
  const rounds: any[] = [];

  const r1Matches: DrawMatch[] = [];
  for (let i = 0; i < prelimMatches; i++) {
    const home = shuffledPlayIn[i * 2];
    const away = shuffledPlayIn[i * 2 + 1];
    const match: DrawMatch = {
      roundNumber: 1,
      roundName: 'Preliminary Round',
      matchIndex: i,
      fixtureId: `fix-${cupId}-r1-m${i}`,
      homeClubId: home?.id || null,
      homeClubName: home?.name || 'TBD',
      awayClubId: away?.id || null,
      awayClubName: away?.name || 'TBD',
      homeClub: home ? { id: home.id, name: home.name, position: home.position } : null,
      awayClub: away ? { id: away.id, name: away.name, position: away.position } : null,
      sourceFixtureId: null,
      sourceWinnerSlot: null,
      homeSourceFixtureId: null,
      awaySourceFixtureId: null,
      homeSourceWinnerSlot: null,
      awaySourceWinnerSlot: null,
    };
    r1Matches.push(match);
    previewMatches.push(match);
  }
  rounds.push({
    roundNumber: 1,
    roundName: 'Preliminary Round',
    matchesCount: r1Matches.length,
    totalMatches: r1Matches.length,
    pairings: r1Matches.map((m) => ({ homeClub: m.homeClub, awayClub: m.awayClub, fixtureId: m.fixtureId })),
    matches: r1Matches,
  });

  const r2Matches: DrawMatch[] = [];
  let byeCursor = 0;
  for (let i = 0; i < 8; i++) {
    if (i < pureByeMatches) {
      const home = shuffledByes[byeCursor++];
      const away = shuffledByes[byeCursor++];
      const match: DrawMatch = {
        roundNumber: 2,
        roundName: 'Round of 16',
        matchIndex: i,
        fixtureId: `fix-${cupId}-r2-m${i}`,
        homeClubId: home?.id || null,
        homeClubName: home?.name || 'TBD',
        awayClubId: away?.id || null,
        awayClubName: away?.name || 'TBD',
        homeClub: home ? { id: home.id, name: home.name, position: home.position } : null,
        awayClub: away ? { id: away.id, name: away.name, position: away.position } : null,
        sourceFixtureId: null,
        sourceWinnerSlot: null,
        homeSourceFixtureId: null,
        awaySourceFixtureId: null,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: null,
      };
      r2Matches.push(match);
      previewMatches.push(match);
    } else {
      const k = i - pureByeMatches;
      const bye = shuffledByes[byeCursor++];
      const sourceId = `fix-${cupId}-r1-m${k}`;
      const match: DrawMatch = {
        roundNumber: 2,
        roundName: 'Round of 16',
        matchIndex: i,
        fixtureId: `fix-${cupId}-r2-m${i}`,
        homeClubId: bye?.id || null,
        homeClubName: bye?.name || 'TBD',
        awayClubId: null,
        awayClubName: `Winner Play-in M${k + 1}`,
        homeClub: bye ? { id: bye.id, name: bye.name, position: bye.position } : null,
        awayClub: null,
        sourceFixtureId: sourceId,
        sourceWinnerSlot: 'away',
        homeSourceFixtureId: null,
        awaySourceFixtureId: sourceId,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: 'away',
      };
      r2Matches.push(match);
      previewMatches.push(match);
    }
  }
  rounds.push({
    roundNumber: 2,
    roundName: 'Round of 16',
    matchesCount: 8,
    totalMatches: 8,
    pairings: r2Matches.map((m) => ({
      homeClub: m.homeClub || { id: null, name: m.homeClubName },
      awayClub: m.awayClub || { id: null, name: m.awayClubName },
      fixtureId: m.fixtureId,
    })),
    matches: r2Matches,
  });

  const downstream = [
    { roundNumber: 3, roundName: 'Quarter-Finals', token: 'r3', count: 4, sourceRound: 2, sourceLabel: 'R16' },
    { roundNumber: 4, roundName: 'Semi-Finals', token: 'r4', count: 2, sourceRound: 3, sourceLabel: 'QF' },
    { roundNumber: 5, roundName: 'Final', token: 'r5', count: 1, sourceRound: 4, sourceLabel: 'SF' },
  ];

  for (const round of downstream) {
    const matches: DrawMatch[] = [];
    for (let i = 0; i < round.count; i++) {
      const homeSource = `fix-${cupId}-r${round.sourceRound}-m${i * 2}`;
      const awaySource = `fix-${cupId}-r${round.sourceRound}-m${i * 2 + 1}`;
      const match: DrawMatch = {
        roundNumber: round.roundNumber,
        roundName: round.roundName,
        matchIndex: i,
        fixtureId: `fix-${cupId}-${round.token}-m${i}`,
        homeClubId: null,
        homeClubName: `Winner ${round.sourceLabel} M${i * 2 + 1}`,
        awayClubId: null,
        awayClubName: `Winner ${round.sourceLabel} M${i * 2 + 2}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      };
      matches.push(match);
      previewMatches.push(match);
    }
    rounds.push({
      roundNumber: round.roundNumber,
      roundName: round.roundName,
      matchesCount: round.count,
      totalMatches: round.count,
      pairings: matches.map((m) => ({
        homeClub: { id: null, name: m.homeClubName },
        awayClub: { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches,
    });
  }

  return {
    competitionId: cupId,
    competitionName: cup.name,
    totalTeams,
    totalParticipants: totalTeams,
    prelimMatches,
    byeTeamsCount,
    totalRounds,
    roundsCount: totalRounds,
    drawSeed,
    seedingPolicy: totalTeams === 20 ? 'POSITIONS_1_12_BYE__13_20_PLAYIN' : 'POSITIONS_1_14_BYE__15_18_PLAYIN',
    byeTeams: byePool,
    playInTeams: playInPool,
    previewMatches,
    rounds,
  };
}

async function getExistingFixtureState(cupId: string) {
  const db = getFirestoreDb();
  const snapshot = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', cupId).get();
  const fixtures = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const protectedFixtures = fixtures.filter(isProtectedFixture);
  return {
    fixtures,
    existingCount: fixtures.length,
    protectedFixtures,
    canRedraw: fixtures.length > 0 && protectedFixtures.length === 0,
  };
}

async function createPreview(cupId: string, seasonId: string, requestedSeed?: string) {
  const standingsSeed = await loadStandingsSeed(cupId, seasonId);
  const stableStandingsFingerprint = standingsSeed.map((club) => `${club.position}:${club.id}`).join('|');
  const drawSeed = requestedSeed || `${cupId}:${stringHash(stableStandingsFingerprint).toString(16)}`;
  const draw = buildDraw(cupId, standingsSeed, drawSeed);
  const existing = await getExistingFixtureState(cupId);

  const canGenerate = existing.existingCount === 0 || existing.canRedraw;
  const blockReason = canGenerate
    ? undefined
    : `Redraw blocked: ${existing.protectedFixtures.length} fixture(s) already contain match activity/results. Reopen or resolve those fixtures before changing the draw.`;

  return {
    ...draw,
    existingFixturesCount: existing.existingCount,
    protectedFixturesCount: existing.protectedFixtures.length,
    canGenerate,
    canRedraw: existing.canRedraw,
    mode: existing.existingCount === 0 ? 'CREATE' : 'REDRAW',
    blockReason,
  };
}

adminCupDrawRouter.post('/:cupId/bracket/preview', async (req: Request, res: Response) => {
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  const requestedSeed = typeof req.body?.drawSeed === 'string' && req.body.drawSeed.trim()
    ? req.body.drawSeed.trim()
    : req.body?.newDraw === true
      ? `${req.params.cupId}:${randomBytes(12).toString('hex')}`
      : undefined;

  try {
    const preview = await createPreview(req.params.cupId, seasonId, requestedSeed);
    res.json(preview);
  } catch (err: any) {
    res.status(err?.statusCode || 400).json({ error: err?.message || 'CUP_DRAW_PREVIEW_FAILED' });
  }
});

adminCupDrawRouter.post('/:cupId/bracket/generate', async (req: Request, res: Response) => {
  const cupId = req.params.cupId;
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  const confirmation = Boolean(req.body?.confirmation);
  const drawSeed = typeof req.body?.drawSeed === 'string' ? req.body.drawSeed.trim() : '';

  if (!confirmation) {
    res.status(400).json({ error: 'Explicit admin confirmation is required.' });
    return;
  }
  if (!drawSeed) {
    res.status(400).json({ error: 'DRAW_SEED_REQUIRED: preview the draw before confirming it.' });
    return;
  }

  try {
    const cup = validateDomesticCupId(cupId);
    const preview = await createPreview(cupId, seasonId, drawSeed);
    if (!preview.canGenerate) {
      res.status(409).json({ error: preview.blockReason || 'CUP_REDRAW_BLOCKED' });
      return;
    }

    const db = getFirestoreDb();
    const existingSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', cupId).get();
    const existingFixtures = existingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const protectedExisting = existingFixtures.filter(isProtectedFixture);
    if (protectedExisting.length > 0) {
      res.status(409).json({ error: 'CUP_REDRAW_RACE_BLOCKED: match activity appeared after preview.' });
      return;
    }

    const now = new Date().toISOString();
    const batch = db.batch();
    for (const doc of existingSnap.docs) batch.delete(doc.ref);

    for (const match of preview.previewMatches) {
      const ref = db.collection(COLLECTIONS.FIXTURES).doc(match.fixtureId);
      batch.create(ref, {
        id: match.fixtureId,
        seasonId,
        competitionId: cupId,
        competitionName: cup.name,
        matchday: match.roundNumber,
        roundName: match.roundName,
        homeClubId: match.homeClubId ?? null,
        awayClubId: match.awayClubId ?? null,
        scheduledAt: now,
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        sourceFixtureId: match.sourceFixtureId ?? null,
        sourceWinnerSlot: match.sourceWinnerSlot ?? null,
        homeSourceFixtureId: match.homeSourceFixtureId ?? null,
        awaySourceFixtureId: match.awaySourceFixtureId ?? null,
        homeSourceWinnerSlot: match.homeSourceWinnerSlot ?? null,
        awaySourceWinnerSlot: match.awaySourceWinnerSlot ?? null,
        drawSeed,
        createdAt: now,
        updatedAt: now,
      });
    }

    batch.set(db.collection(COLLECTIONS.COMPETITIONS).doc(cupId), {
      status: 'active',
      hasFixtures: true,
      fixtureCount: preview.previewMatches.length,
      fixturesCount: preview.previewMatches.length,
      generationStatus: 'generated',
      drawSeed,
      drawPolicy: preview.seedingPolicy,
      drawUpdatedAt: now,
      updatedAt: now,
    }, { merge: true });

    await batch.commit();

    try {
      queryRun('DELETE FROM fixtures WHERE competition_id = ?', [cupId]);
      for (const match of preview.previewMatches) {
        queryRun(
          `INSERT OR REPLACE INTO fixtures (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, status, scheduled_at, source_fixture_id, source_winner_slot, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
          [
            match.fixtureId,
            seasonId,
            cupId,
            match.roundNumber,
            match.roundName,
            match.homeClubId ?? null,
            match.awayClubId ?? null,
            now,
            match.sourceFixtureId ?? null,
            match.sourceWinnerSlot ?? null,
            now,
            now,
          ]
        );
      }
    } catch (mirrorError: any) {
      console.warn('[CUP_DRAW_SQLITE_MIRROR_WARNING]', mirrorError?.message || mirrorError);
    }

    await invalidateDataset(`cup:bracket:${cupId}:${seasonId}`);
    await invalidateFixtureReadModels(cupId, seasonId);

    const action = existingFixtures.length > 0 ? 'CUP_BRACKET_REDRAWN' : 'CUP_BRACKET_GENERATED';
    await createAuditLog(
      req.user!.id,
      action,
      'COMPETITION',
      cupId,
      undefined,
      {
        competitionId: cupId,
        competitionName: cup.name,
        drawSeed,
        seedingPolicy: preview.seedingPolicy,
        byePositions: preview.byeTeams.map((club: SeededClub) => club.position),
        playInPositions: preview.playInTeams.map((club: SeededClub) => club.position),
        replacedFixtures: existingFixtures.length,
        generatedFixtures: preview.previewMatches.length,
        timestamp: now,
      },
      undefined,
      req.user?.username || 'admin',
      `${existingFixtures.length > 0 ? 'Redrew' : 'Generated'} standings-seeded ${cup.name} bracket.`
    );

    res.json({
      success: true,
      generated: preview.previewMatches.length,
      rounds: preview.totalRounds,
      drawSeed,
      mode: existingFixtures.length > 0 ? 'REDRAW' : 'CREATE',
      message: `${cup.name} draw saved: positions ${cup.expectedTeams === 20 ? '1-12' : '1-14'} received byes; positions ${cup.expectedTeams === 20 ? '13-20' : '15-18'} entered the play-in.`,
    });
  } catch (err: any) {
    res.status(err?.statusCode || 400).json({ error: err?.message || 'CUP_DRAW_CONFIRM_FAILED' });
  }
});

adminCupDrawRouter.patch('/:cupId/bracket/fixture/:fixtureId', async (req: Request, res: Response) => {
  const cupId = req.params.cupId;
  const fixtureId = req.params.fixtureId;
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  const cup = validateDomesticCupId(cupId);
  const requestedHome = req.body?.homeClubId === undefined ? undefined : (req.body.homeClubId || null);
  const requestedAway = req.body?.awayClubId === undefined ? undefined : (req.body.awayClubId || null);

  try {
    const db = getFirestoreDb();
    const ref = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }

    const fixture: any = doc.data();
    if (fixture.competitionId !== cupId) {
      res.status(409).json({ error: 'Fixture does not belong to this cup.' });
      return;
    }
    if (isProtectedFixture(fixture)) {
      res.status(409).json({ error: 'Manual pairing is locked after match activity starts.' });
      return;
    }

    const eligibleIds = new Set(SEED_CLUBS.filter((club) => club.leagueId === cup.leagueId).map((club) => club.id));
    if (requestedHome && !eligibleIds.has(requestedHome)) {
      res.status(400).json({ error: 'Invalid home club for this cup.' });
      return;
    }
    if (requestedAway && !eligibleIds.has(requestedAway)) {
      res.status(400).json({ error: 'Invalid away club for this cup.' });
      return;
    }
    if (requestedHome && requestedAway && requestedHome === requestedAway) {
      res.status(400).json({ error: 'A club cannot play itself.' });
      return;
    }
    if (requestedHome !== undefined && fixture.homeSourceFixtureId) {
      res.status(409).json({ error: 'Home slot is source-bound to a previous-round winner.' });
      return;
    }
    if (requestedAway !== undefined && fixture.awaySourceFixtureId) {
      res.status(409).json({ error: 'Away slot is source-bound to a previous-round winner.' });
      return;
    }

    const roundSnap = await db.collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', cupId)
      .where('matchday', '==', fixture.matchday)
      .get();
    const occupiedByOther = new Set<string>();
    for (const roundDoc of roundSnap.docs) {
      if (roundDoc.id === fixtureId) continue;
      const row: any = roundDoc.data();
      if (row.homeClubId) occupiedByOther.add(row.homeClubId);
      if (row.awayClubId) occupiedByOther.add(row.awayClubId);
    }
    if ((requestedHome && occupiedByOther.has(requestedHome)) || (requestedAway && occupiedByOther.has(requestedAway))) {
      res.status(409).json({ error: 'Selected club is already assigned to another match in this round.' });
      return;
    }

    const update: any = { updatedAt: new Date().toISOString() };
    if (requestedHome !== undefined) update.homeClubId = requestedHome;
    if (requestedAway !== undefined) update.awayClubId = requestedAway;
    await ref.update(update);

    await invalidateDataset(`cup:bracket:${cupId}:${seasonId}`);
    await invalidateFixtureReadModels(cupId, seasonId);

    await createAuditLog(
      req.user!.id,
      'CUP_PAIRING_MANUAL_EDIT',
      'FIXTURE',
      fixtureId,
      { homeClubId: fixture.homeClubId ?? null, awayClubId: fixture.awayClubId ?? null },
      { homeClubId: update.homeClubId ?? fixture.homeClubId ?? null, awayClubId: update.awayClubId ?? fixture.awayClubId ?? null },
      undefined,
      req.user?.username || 'admin',
      `Manually edited ${cup.name} pairing ${fixtureId}.`
    );

    res.json({ success: true, fixtureId, ...update });
  } catch (err: any) {
    res.status(err?.statusCode || 400).json({ error: err?.message || 'CUP_PAIRING_EDIT_FAILED' });
  }
});
