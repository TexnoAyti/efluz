import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { createAuditLog } from '../services/adminService';
import { invalidateDataset, invalidateFixtureReadModels, refreshChangedFixtureReadModel } from '../readModel/readModelStore';
import { DOMESTIC_CUPS, validateDomesticCupId } from './domesticCupService';

const PROTECTED_STATUSES = new Set([
  'PLAYING',
  'IN_PROGRESS',
  'AWAITING_RESULT',
  'PENDING_CONFIRMATION',
  'DISPUTED',
  'CONFIRMED',
]);

type CupFixture = Record<string, any> & {
  id: string;
  competitionId: string;
  seasonId?: string;
  matchday?: number;
  roundName?: string;
  status?: string;
  homeClubId?: string | null;
  awayClubId?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  winnerClubId?: string | null;
  resultConfirmedAt?: string | null;
  homeSourceFixtureId?: string | null;
  awaySourceFixtureId?: string | null;
};

export interface CupHealthIssue {
  code: 'MISSING_SOURCE' | 'STALE_WINNER' | 'MISSING_ADVANCEMENT' | 'DUPLICATE_CLUB' | 'LOCKED_TARGET_MISMATCH';
  severity: 'warning' | 'error';
  fixtureId: string;
  slot?: 'home' | 'away';
  message: string;
}

export interface CupBracketHealth {
  competitionId: string;
  healthy: boolean;
  issues: CupHealthIssue[];
  fixtures: number;
  confirmed: number;
  currentRound: number;
  rounds: Array<{
    roundNumber: number;
    roundName: string;
    matches: number;
    confirmed: number;
    readyToAdvance: boolean;
  }>;
}

function isProtected(fixture: CupFixture): boolean {
  return PROTECTED_STATUSES.has(String(fixture.status || 'SCHEDULED')) ||
    fixture.homeScore != null || fixture.awayScore != null || Boolean(fixture.resultConfirmedAt);
}

async function loadCupFixtures(competitionId: string): Promise<CupFixture[]> {
  validateDomesticCupId(competitionId);
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as CupFixture));
}

function buildHealth(competitionId: string, fixtures: CupFixture[], currentRound: number): CupBracketHealth {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const issues: CupHealthIssue[] = [];

  for (const target of fixtures) {
    const sourceSlots: Array<{ slot: 'home' | 'away'; sourceId?: string | null; occupant?: string | null }> = [
      { slot: 'home', sourceId: target.homeSourceFixtureId, occupant: target.homeClubId },
      { slot: 'away', sourceId: target.awaySourceFixtureId, occupant: target.awayClubId },
    ];

    for (const link of sourceSlots) {
      if (!link.sourceId) continue;
      const source = byId.get(link.sourceId);
      if (!source) {
        issues.push({
          code: 'MISSING_SOURCE', severity: 'error', fixtureId: target.id, slot: link.slot,
          message: `${target.id} ${link.slot} slot references missing source ${link.sourceId}.`,
        });
        continue;
      }

      const expectedWinner = source.status === 'CONFIRMED' ? source.winnerClubId || null : null;
      if (expectedWinner && !link.occupant) {
        issues.push({
          code: 'MISSING_ADVANCEMENT', severity: 'warning', fixtureId: target.id, slot: link.slot,
          message: `${source.id} is confirmed but its winner has not advanced into ${target.id}.`,
        });
      } else if (expectedWinner && link.occupant && link.occupant !== expectedWinner) {
        issues.push({
          code: isProtected(target) ? 'LOCKED_TARGET_MISMATCH' : 'STALE_WINNER',
          severity: 'error', fixtureId: target.id, slot: link.slot,
          message: `${target.id} ${link.slot} slot contains ${link.occupant}, expected ${expectedWinner} from ${source.id}.`,
        });
      } else if (!expectedWinner && link.occupant) {
        issues.push({
          code: isProtected(target) ? 'LOCKED_TARGET_MISMATCH' : 'STALE_WINNER',
          severity: isProtected(target) ? 'error' : 'warning', fixtureId: target.id, slot: link.slot,
          message: `${target.id} ${link.slot} slot still contains ${link.occupant}, but source ${source.id} is not confirmed.`,
        });
      }
    }
  }

  const roundMap = new Map<number, CupFixture[]>();
  for (const fixture of fixtures) {
    const round = Number(fixture.matchday || 1);
    const list = roundMap.get(round) || [];
    list.push(fixture);
    roundMap.set(round, list);
  }

  for (const [round, roundFixtures] of roundMap) {
    const seen = new Map<string, string>();
    for (const fixture of roundFixtures) {
      for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
        if (!clubId) continue;
        const previous = seen.get(clubId);
        if (previous) {
          issues.push({
            code: 'DUPLICATE_CLUB', severity: 'error', fixtureId: fixture.id,
            message: `${clubId} appears more than once in round ${round} (${previous}, ${fixture.id}).`,
          });
        } else {
          seen.set(clubId, fixture.id);
        }
      }
    }
  }

  const rounds = Array.from(roundMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, roundFixtures]) => ({
      roundNumber,
      roundName: roundFixtures[0]?.roundName || `Round ${roundNumber}`,
      matches: roundFixtures.length,
      confirmed: roundFixtures.filter((fixture) => fixture.status === 'CONFIRMED').length,
      readyToAdvance: roundFixtures.length > 0 && roundFixtures.every((fixture) => fixture.status === 'CONFIRMED'),
    }));

  return {
    competitionId,
    healthy: issues.length === 0,
    issues,
    fixtures: fixtures.length,
    confirmed: fixtures.filter((fixture) => fixture.status === 'CONFIRMED').length,
    currentRound,
    rounds,
  };
}

export async function getDomesticCupBracketHealth(competitionId: string): Promise<CupBracketHealth> {
  validateDomesticCupId(competitionId);
  const db = getFirestoreDb();
  const [fixtures, compDoc] = await Promise.all([
    loadCupFixtures(competitionId),
    db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get(),
  ]);
  const currentRound = Number(compDoc.data()?.currentMatchday || 1);
  return buildHealth(competitionId, fixtures, currentRound);
}

export async function reconcileDomesticCupBracketSafe(
  competitionId: string,
  options: { adminUserId: string; adminUsername?: string; reason?: string }
): Promise<{ success: true; changed: number; blocked: number; health: CupBracketHealth }> {
  validateDomesticCupId(competitionId);
  const db = getFirestoreDb();
  const fixtures = await loadCupFixtures(competitionId);
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const batch = db.batch();
  let changed = 0;
  let blocked = 0;
  const changedIds: string[] = [];

  for (const target of fixtures) {
    const updates: Record<string, any> = {};
    for (const slot of ['home', 'away'] as const) {
      const sourceId = slot === 'home' ? target.homeSourceFixtureId : target.awaySourceFixtureId;
      if (!sourceId) continue;
      const source = byId.get(sourceId);
      if (!source) continue;
      const expectedWinner = source.status === 'CONFIRMED' ? source.winnerClubId || null : null;
      const field = slot === 'home' ? 'homeClubId' : 'awayClubId';
      const current = target[field] || null;
      if (current === expectedWinner) continue;
      if (isProtected(target)) {
        blocked += 1;
        continue;
      }
      updates[field] = expectedWinner;
    }
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date().toISOString();
      batch.update(db.collection(COLLECTIONS.FIXTURES).doc(target.id), updates);
      changed += 1;
      changedIds.push(target.id);
    }
  }

  if (changed) await batch.commit();
  const seasonId = fixtures[0]?.seasonId || 'season-2026-27';
  for (const fixtureId of changedIds) {
    await refreshChangedFixtureReadModel(fixtureId).catch(() => {});
  }
  await invalidateDataset(`cup:bracket:${competitionId}:${seasonId}`).catch(() => {});
  await invalidateFixtureReadModels(competitionId, seasonId).catch(() => {});

  await createAuditLog(
    options.adminUserId,
    'CUP_BRACKET_RECONCILED',
    'COMPETITION',
    competitionId,
    undefined,
    { changed, blocked, reason: options.reason || 'manual-health-reconcile' },
    undefined,
    options.adminUsername || 'admin',
    `Reconciled domestic cup bracket: ${changed} fixture(s) updated, ${blocked} protected mismatch(es) left untouched.`
  );

  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  const refreshed = await loadCupFixtures(competitionId);
  return { success: true, changed, blocked, health: buildHealth(competitionId, refreshed, Number(compDoc.data()?.currentMatchday || 1)) };
}

export async function reconcileDomesticCupSourceFixture(
  fixtureId: string,
  options: { actorUserId?: string; actorUsername?: string; reason?: string } = {}
): Promise<{ domesticCup: boolean; changed: number; blocked: number }> {
  const db = getFirestoreDb();
  const sourceDoc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  if (!sourceDoc.exists) return { domesticCup: false, changed: 0, blocked: 0 };
  const source = { id: sourceDoc.id, ...sourceDoc.data() } as CupFixture;
  if (!DOMESTIC_CUPS[source.competitionId]) return { domesticCup: false, changed: 0, blocked: 0 };

  const result = await reconcileDomesticCupBracketSafe(source.competitionId, {
    adminUserId: options.actorUserId || 'system-cup-progression',
    adminUsername: options.actorUsername || 'system',
    reason: options.reason || `source-fixture:${fixtureId}`,
  });
  return { domesticCup: true, changed: result.changed, blocked: result.blocked };
}

export async function setDomesticCupRoundStateSafe(
  competitionId: string,
  roundNumber: number,
  action: 'OPEN' | 'LOCK',
  options: { adminUserId: string; adminUsername?: string }
): Promise<{ success: true; competitionId: string; roundNumber: number; isOpen: boolean; roundName: string }> {
  validateDomesticCupId(competitionId);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) throw new Error('Invalid cup round number.');

  const db = getFirestoreDb();
  const fixtures = await loadCupFixtures(competitionId);
  const roundFixtures = fixtures.filter((fixture) => Number(fixture.matchday || 1) === roundNumber);
  if (!roundFixtures.length) throw new Error(`Round ${roundNumber} does not exist for ${competitionId}.`);

  if (action === 'OPEN') {
    const previousRounds = fixtures.filter((fixture) => Number(fixture.matchday || 1) < roundNumber);
    const latestPreviousRound = Math.max(0, ...previousRounds.map((fixture) => Number(fixture.matchday || 1)));
    if (latestPreviousRound > 0) {
      const previous = fixtures.filter((fixture) => Number(fixture.matchday || 1) === latestPreviousRound);
      if (previous.some((fixture) => fixture.status !== 'CONFIRMED')) {
        throw new Error(`Cannot open round ${roundNumber}: round ${latestPreviousRound} is not fully confirmed.`);
      }
      await reconcileDomesticCupBracketSafe(competitionId, {
        adminUserId: options.adminUserId,
        adminUsername: options.adminUsername,
        reason: `open-round-${roundNumber}`,
      });
    }
  }

  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).set({
    currentMatchday: roundNumber,
    isMatchdayOpen: action === 'OPEN',
    adminOverrideStatus: action === 'OPEN' ? 'FORCE_OPEN' : 'FORCE_LOCKED',
    updatedAt: now,
  }, { merge: true });

  await createAuditLog(
    options.adminUserId,
    action === 'OPEN' ? 'CUP_ROUND_OPENED' : 'CUP_ROUND_LOCKED',
    'COMPETITION',
    competitionId,
    undefined,
    { roundNumber, roundName: roundFixtures[0]?.roundName || `Round ${roundNumber}` },
    undefined,
    options.adminUsername || 'admin',
    `${action === 'OPEN' ? 'Opened' : 'Locked'} domestic cup round ${roundNumber}.`
  );

  return {
    success: true,
    competitionId,
    roundNumber,
    isOpen: action === 'OPEN',
    roundName: roundFixtures[0]?.roundName || `Round ${roundNumber}`,
  };
}

export async function advanceDomesticCupRoundSafe(
  competitionId: string,
  options: { adminUserId: string; adminUsername?: string }
): Promise<{ success: true; fromRound: number; toRound: number; roundName: string }> {
  validateDomesticCupId(competitionId);
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  const currentRound = Number(compDoc.data()?.currentMatchday || 1);
  const fixtures = await loadCupFixtures(competitionId);
  const currentFixtures = fixtures.filter((fixture) => Number(fixture.matchday || 1) === currentRound);
  if (!currentFixtures.length) throw new Error(`Current round ${currentRound} has no fixtures.`);
  if (currentFixtures.some((fixture) => fixture.status !== 'CONFIRMED')) {
    throw new Error(`Cannot advance: round ${currentRound} still has unconfirmed fixtures.`);
  }

  await reconcileDomesticCupBracketSafe(competitionId, {
    adminUserId: options.adminUserId,
    adminUsername: options.adminUsername,
    reason: `advance-round-${currentRound}`,
  });

  const nextRound = Math.min(...fixtures.map((fixture) => Number(fixture.matchday || 1)).filter((round) => round > currentRound));
  if (!Number.isFinite(nextRound)) throw new Error('Final round is already complete; there is no next round to open.');

  const result = await setDomesticCupRoundStateSafe(competitionId, nextRound, 'OPEN', options);
  return { success: true, fromRound: currentRound, toRound: nextRound, roundName: result.roundName };
}
