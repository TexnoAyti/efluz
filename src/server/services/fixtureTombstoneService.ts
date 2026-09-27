import { Fixture, StandingsRow } from '../../types';
import {
  ReadModelKeys,
  redisGetFresh,
  redisGetLkg,
  redisSetRaw,
} from '../readModel/readModelStore';

export interface FixtureTombstone {
  fixtureId: string;
  seasonId: string;
  competitionId?: string;
  deletedAt: string;
  deletedBy?: string;
  reason?: string;
}

function tombstoneKey(seasonId: string): string {
  return `efluz:v1:season:${seasonId}:fixture-tombstones`;
}

export async function getFixtureTombstones(seasonId = 'season-2026-27'): Promise<FixtureTombstone[]> {
  const key = tombstoneKey(seasonId);
  const snap = (await redisGetFresh<FixtureTombstone[]>(key)) || (await redisGetLkg<FixtureTombstone[]>(key));
  return Array.isArray(snap?.data) ? snap!.data : [];
}

export async function addFixtureTombstone(input: FixtureTombstone): Promise<void> {
  const existing = await getFixtureTombstones(input.seasonId);
  const next = [...existing.filter((row) => row.fixtureId !== input.fixtureId), input];
  await redisSetRaw(tombstoneKey(input.seasonId), {
    sourceVersion: 'fixture-delete-tombstones',
    expectedCount: next.length,
    data: next,
  }, 31536000);
}

export async function filterTombstonedFixtures<T extends { id: string }>(fixtures: T[], seasonId = 'season-2026-27'): Promise<T[]> {
  if (!fixtures.length) return fixtures;
  const tombstones = await getFixtureTombstones(seasonId);
  if (!tombstones.length) return fixtures;
  const ids = new Set(tombstones.map((row) => row.fixtureId));
  return fixtures.filter((fixture) => !ids.has(fixture.id));
}

export async function isFixtureTombstoned(fixtureId: string, seasonId = 'season-2026-27'): Promise<boolean> {
  const tombstones = await getFixtureTombstones(seasonId);
  return tombstones.some((row) => row.fixtureId === fixtureId);
}

async function patchFixtureSnapshot(key: string, fixtureId: string): Promise<Fixture[] | null> {
  const snap = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
  if (!Array.isArray(snap?.data)) return null;
  const next = snap!.data.filter((fixture) => fixture.id !== fixtureId);
  if (next.length === snap!.data.length) return next;
  await redisSetRaw(key, {
    sourceVersion: 'fixture-delete-filtered',
    expectedCount: next.length,
    data: next,
  }, 86400);
  return next;
}

export async function removeFixtureFromDurableSnapshots(
  fixtureId: string,
  competitionId: string | undefined,
  seasonId = 'season-2026-27'
): Promise<Fixture[]> {
  await patchFixtureSnapshot(ReadModelKeys.adminFixtures(seasonId), fixtureId);
  if (!competitionId) return [];
  return (await patchFixtureSnapshot(ReadModelKeys.competitionFixtures(competitionId, seasonId), fixtureId)) || [];
}

export async function rebuildStandingsSnapshotFromFixtures(
  competitionId: string,
  seasonId: string,
  fixtures: Fixture[]
): Promise<StandingsRow[] | null> {
  const standingsKey = ReadModelKeys.standings(competitionId, seasonId);
  const current = (await redisGetFresh<StandingsRow[]>(standingsKey)) || (await redisGetLkg<StandingsRow[]>(standingsKey));
  if (!Array.isArray(current?.data) || current!.data.length === 0) return null;

  const byClub = new Map<string, StandingsRow>();
  for (const old of current!.data) {
    byClub.set(old.clubId, {
      ...old,
      position: 0,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
    });
  }

  const confirmed = fixtures
    .filter((fixture) => fixture.competitionId === competitionId && fixture.status === 'CONFIRMED' && fixture.homeClubId && fixture.awayClubId && fixture.homeScore != null && fixture.awayScore != null)
    .sort((a, b) => Number(a.matchday || 0) - Number(b.matchday || 0) || String(a.resultConfirmedAt || '').localeCompare(String(b.resultConfirmedAt || '')) || a.id.localeCompare(b.id));

  for (const fixture of confirmed) {
    const home = byClub.get(fixture.homeClubId!);
    const away = byClub.get(fixture.awayClubId!);
    const hs = Number(fixture.homeScore);
    const as = Number(fixture.awayScore);
    if (home) {
      home.played++; home.goalsFor += hs; home.goalsAgainst += as;
      if (hs > as) { home.won++; home.points += 3; home.form.push('W'); }
      else if (hs === as) { home.drawn++; home.points += 1; home.form.push('D'); }
      else { home.lost++; home.form.push('L'); }
    }
    if (away) {
      away.played++; away.goalsFor += as; away.goalsAgainst += hs;
      if (as > hs) { away.won++; away.points += 3; away.form.push('W'); }
      else if (as === hs) { away.drawn++; away.points += 1; away.form.push('D'); }
      else { away.lost++; away.form.push('L'); }
    }
  }

  const rows = Array.from(byClub.values()).map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst, form: row.form.slice(-5) }));
  rows.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.clubName.localeCompare(b.clubName));
  rows.forEach((row, index) => { row.position = index + 1; });

  await redisSetRaw(standingsKey, {
    sourceVersion: 'fixture-delete-recomputed',
    expectedCount: rows.length,
    data: rows,
  }, 86400);
  return rows;
}
