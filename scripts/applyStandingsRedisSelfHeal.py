from pathlib import Path

path = Path('src/server/readModel/readModelStore.ts')
text = path.read_text()

if 'publishStandingsFromFixtureReadModel' in text:
    raise SystemExit('standings self-heal already present')

marker = "export async function getCompetitionStandingsFromReadModel(\n"
helper = r'''function calculateDomesticStandingsFromFixtureSnapshot(
  competitionId: string,
  seasonId: string,
  fixtures: Fixture[]
): StandingsRow[] | null {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  if (!config) return null;

  const clubs = SEED_CLUBS.filter((club) => club.leagueId === config.leagueId);
  if (clubs.length !== config.expectedCount) return null;

  const confirmed = fixtures
    .filter((fixture) =>
      fixture.competitionId === competitionId &&
      fixture.status === 'CONFIRMED' &&
      fixture.homeClubId &&
      fixture.awayClubId &&
      Number.isFinite(Number(fixture.homeScore)) &&
      Number.isFinite(Number(fixture.awayScore))
    )
    .sort((a, b) => {
      const md = Number(a.matchday || 0) - Number(b.matchday || 0);
      if (md !== 0) return md;
      const time = (Date.parse(a.resultConfirmedAt || a.updatedAt || a.scheduledAt || '') || 0) -
        (Date.parse(b.resultConfirmedAt || b.updatedAt || b.scheduledAt || '') || 0);
      return time !== 0 ? time : a.id.localeCompare(b.id);
    });

  const rowsByClub = new Map<string, StandingsRow>();
  for (const club of clubs) {
    rowsByClub.set(club.id, {
      position: 0,
      clubId: club.id,
      clubName: club.name,
      shortName: club.shortName,
      logoUrl: club.logoUrl,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
      competitionId,
      seasonId,
    });
  }

  for (const fixture of confirmed) {
    const home = rowsByClub.get(fixture.homeClubId!);
    const away = rowsByClub.get(fixture.awayClubId!);
    if (!home || !away) continue;
    const homeScore = Number(fixture.homeScore);
    const awayScore = Number(fixture.awayScore);

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
      home.form = [...(home.form || []), 'W'].slice(-5);
      away.form = [...(away.form || []), 'L'].slice(-5);
    } else if (awayScore > homeScore) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
      away.form = [...(away.form || []), 'W'].slice(-5);
      home.form = [...(home.form || []), 'L'].slice(-5);
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
      home.form = [...(home.form || []), 'D'].slice(-5);
      away.form = [...(away.form || []), 'D'].slice(-5);
    }
  }

  const rows = Array.from(rowsByClub.values());
  for (const row of rows) row.goalDifference = row.goalsFor - row.goalsAgainst;

  const h2hPoints = (clubAId: string, clubBId: string) => {
    let points = 0;
    for (const fixture of confirmed) {
      const homeScore = Number(fixture.homeScore);
      const awayScore = Number(fixture.awayScore);
      if (fixture.homeClubId === clubAId && fixture.awayClubId === clubBId) {
        points += homeScore > awayScore ? 3 : homeScore === awayScore ? 1 : 0;
      } else if (fixture.homeClubId === clubBId && fixture.awayClubId === clubAId) {
        points += awayScore > homeScore ? 3 : awayScore === homeScore ? 1 : 0;
      }
    }
    return points;
  };

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    const aH2h = h2hPoints(a.clubId, b.clubId);
    const bH2h = h2hPoints(b.clubId, a.clubId);
    if (bH2h !== aH2h) return bH2h - aH2h;
    return a.clubName.localeCompare(b.clubName);
  });

  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

/**
 * Rebuilds a domestic standings Fresh + LKG snapshot exclusively from the durable
 * competition fixture read model. This is intentionally Firestore-independent so a
 * confirmed result can update POS/PTS/W-D-L/GD even while Firestore quota is exhausted.
 */
export async function publishStandingsFromFixtureReadModel(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<boolean> {
  if (!DOMESTIC_LEAGUE_CONFIG[competitionId]) return false;
  const fixtureKey = ReadModelKeys.competitionFixtures(competitionId, seasonId);
  const fixtureSnapshot = (await redisGetFresh<Fixture[]>(fixtureKey)) || (await redisGetLkg<Fixture[]>(fixtureKey));
  if (!fixtureSnapshot || !Array.isArray(fixtureSnapshot.data) || fixtureSnapshot.data.length === 0) return false;

  const rows = calculateDomesticStandingsFromFixtureSnapshot(competitionId, seasonId, fixtureSnapshot.data);
  const expectedCount = DOMESTIC_LEAGUE_CONFIG[competitionId].expectedCount;
  if (!rows || rows.length !== expectedCount) return false;

  const standingsKey = ReadModelKeys.standings(competitionId, seasonId);
  const generatedAt = new Date().toISOString();
  await redisSetRaw(standingsKey, {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sourceVersion: `fixture-read-model-${fixtureSnapshot.sourceVersion || fixtureSnapshot.generatedAt}`,
    expectedCount,
    actualCount: rows.length,
    data: rows,
  }, 86400);
  inProcessMemoryCache.delete(getRawDatasetKey(standingsKey));
  inProcessMemoryCache.delete(standingsKey);
  console.info('[STANDINGS_READMODEL_PUBLISHED]', JSON.stringify({ competitionId, seasonId, rows: rows.length, source: 'fixture-read-model' }));
  return true;
}

'''
if marker not in text:
    raise SystemExit('standings function marker not found')
text = text.replace(marker, helper + marker, 1)

old_result = "  const result = await readThroughReadModel<StandingsRow[]>({\n"
if old_result not in text:
    raise SystemExit('standings result declaration not found')
text = text.replace(old_result, "  let result = await readThroughReadModel<StandingsRow[]>({\n", 1)

needle = "  });\n\n  let clubsResult: any = null;\n"
self_heal = r'''  });

  // If fixtures were patched more recently than standings, self-heal standings from
  // Redis without spending a single Firestore read. This also repairs stale LKG data
  // after a quota outage on the next standings/dashboard request.
  try {
    const fixtureKey = ReadModelKeys.competitionFixtures(competitionId, seasonId);
    const fixtureSnapshot = (await redisGetFresh<Fixture[]>(fixtureKey)) || (await redisGetLkg<Fixture[]>(fixtureKey));
    const fixtureAt = fixtureSnapshot?.generatedAt ? Date.parse(fixtureSnapshot.generatedAt) : 0;
    const standingsAt = result.generatedAt ? Date.parse(result.generatedAt) : 0;
    const dirty = await redisIsDirty(ReadModelKeys.standings(competitionId, seasonId));
    if (fixtureSnapshot && Array.isArray(fixtureSnapshot.data) && fixtureSnapshot.data.length > 0 && (dirty || fixtureAt > standingsAt)) {
      if (await publishStandingsFromFixtureReadModel(competitionId, seasonId)) {
        const healed = await redisGetFresh<StandingsRow[]>(ReadModelKeys.standings(competitionId, seasonId));
        if (healed?.data?.length) result = healed;
      }
    }
  } catch (healErr: any) {
    console.warn('[STANDINGS_READMODEL_SELF_HEAL_FAILED]', healErr?.message || healErr);
  }

  let clubsResult: any = null;
'''
if needle not in text:
    raise SystemExit('standings post-read insertion point not found')
text = text.replace(needle, self_heal, 1)

old_refresh = "  await invalidateDataset(ReadModelKeys.standings(fixture.competitionId, fixture.seasonId));\n}\n\nexport async function invalidateFixtureReadModels("
new_refresh = "  if (!(await publishStandingsFromFixtureReadModel(fixture.competitionId, fixture.seasonId))) {\n    await invalidateDataset(ReadModelKeys.standings(fixture.competitionId, fixture.seasonId));\n  }\n}\n\nexport async function invalidateFixtureReadModels("
if old_refresh not in text:
    raise SystemExit('refreshChangedFixtureReadModel standings invalidation not found')
text = text.replace(old_refresh, new_refresh, 1)

old_invalidate = "export async function invalidateStandingsReadModels(\n  competitionId: string,\n  seasonId = 'season-2026-27'\n): Promise<void> {\n  await invalidateDataset(ReadModelKeys.standings(competitionId, seasonId));\n}\n"
new_invalidate = "export async function invalidateStandingsReadModels(\n  competitionId: string,\n  seasonId = 'season-2026-27'\n): Promise<void> {\n  if (await publishStandingsFromFixtureReadModel(competitionId, seasonId)) return;\n  await invalidateDataset(ReadModelKeys.standings(competitionId, seasonId));\n}\n"
if old_invalidate not in text:
    raise SystemExit('invalidateStandingsReadModels body not found')
text = text.replace(old_invalidate, new_invalidate, 1)

path.write_text(text)
print('Applied quota-independent standings Redis self-heal')
