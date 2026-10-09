import { z } from 'zod';
import { ReadModelKeys, type OwnerNeutralClub } from '../readModel/readModelStore';
import { createAiSnapshotReader } from './telegramAiSnapshotReader';
import { filterRetiredFixtures } from './retiredFixtureService';
import { sortSeasonFixtures } from '../../lib/fixtureOrder';
import type { Competition, Fixture, StandingsRow } from '../../types';
import { normalizeAiEntity, containsAiEntity, resolveAiClubs } from './telegramAiEntities';
import { detectAiCupStage, fixtureMatchesAiCupStage } from './telegramAiCupStage';

export const tournamentQuerySchema = z.object({
  dataset: z.enum(['competitions', 'clubs', 'fixtures', 'standings', 'statistics']),
  competition: z.string().max(100).optional(), club: z.string().max(100).optional(),
  opponent: z.string().max(100).optional(), ownerUsername: z.string().max(40).optional(),
  fixtureId: z.string().max(180).optional(), stage: z.string().max(50).optional(),
  matchday: z.number().int().min(1).max(100).optional(), status: z.string().max(40).optional(),
  matchdayTo: z.number().int().min(1).max(100).optional(),
  fixtureState: z.enum(['unplayed', 'awaiting_confirmation', 'disputed', 'unfinished', 'confirmed']).optional(),
  offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(30).optional(),
}).strict();
export type TournamentQuery = z.infer<typeof tournamentQuerySchema>;
const aliases: Record<string, string[]> = {
  'premier-league': ['apl', 'angliya ligasi'], 'la-liga': ['laliga', 'ispaniya ligasi'],
  'serie-a': ['italiya ligasi'], 'bundesliga': ['germaniya ligasi'], 'ligue-1': ['liga 1', 'fransiya ligasi'],
  'fa-cup': ['angliya kubogi'], 'copa-del-rey': ['ispaniya kubogi'], 'coppa-italia': ['italiya kubogi'],
  'dfb-pokal': ['germaniya kubogi'], 'coupe-de-france': ['fransiya kubogi'],
  'community-shield': ['angliya superkubogi'], 'supercopa-espana': ['ispaniya superkubogi'],
  'supercoppa-italiana': ['italiya superkubogi'], 'dfl-supercup': ['germaniya superkubogi'],
  'champions-league': ['ucl', 'yechl', 'chempionlar ligasi'], 'europa-league': ['uel', 'yevropa ligasi'],
  'conference-league': ['uecl', 'konferensiyalar ligasi'], 'uefa-super-cup': ['uefa superkubogi'],
};
export function matchesAiCompetition(query: string, c: Competition): boolean {
  const q = normalizeAiEntity(query);
  return q === normalizeAiEntity(c.id) || containsAiEntity(q, c.name) ||
    Object.entries(aliases).some(([id, words]) => c.id.startsWith(`comp-${id}-`) && words.some(w => containsAiEntity(q, w)));
}
function project<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(k => Object.hasOwn(row, k)).map(k => [k, (row as any)[k]]));
}
const validScore = (f: Fixture) => f.status === 'CONFIRMED' && Number.isInteger(f.homeScore) && Number.isInteger(f.awayScore) && f.homeScore! >= 0 && f.awayScore! >= 0;

/** All active-season datasets are searchable; only explicit public fields leave this boundary.
 * Lazy, request-local batched Redis reads; never scans Firestore or trusts model-supplied keys. */
export function createAiTournamentReader(signal?: AbortSignal) {
  const reader = createAiSnapshotReader(signal);
  const season = 'season-2026-27';
  let catalog: Promise<{ competitions: Competition[]; clubs: OwnerNeutralClub[]; stale: boolean }> | undefined;
  const fixtureLoads = new Map<string, Promise<Fixture[]>>();
  const fixtureCoverage = new Map<string, boolean>();
  let stale = false;
  const loadCatalog = () => catalog ||= (async () => {
    await reader.load([ReadModelKeys.competitions(season), ReadModelKeys.clubsWithOwners(season)]);
    const comps = await reader.read<Competition>(ReadModelKeys.competitions(season));
    const clubs = await reader.read<OwnerNeutralClub>(ReadModelKeys.clubsWithOwners(season));
    stale ||= comps.stale || clubs.stale;
    return { competitions: comps.data.filter(c => c.seasonId === season), clubs: clubs.data.filter(c => !(c as any).seasonId || (c as any).seasonId === season), stale };
  })();
  const loadFixtures = async (selected?: Competition[]) => {
    const competitions = selected || (await loadCatalog()).competitions;
    const scope = competitions.map(c => c.id).sort().join('|');
    if (!fixtureLoads.has(scope)) fixtureLoads.set(scope, (async () => {
    const tombstone = `efluz:v1:season:${season}:fixture-tombstones`;
    await reader.load([ReadModelKeys.adminFixtures(season), tombstone, ...competitions.map(c => ReadModelKeys.competitionFixtures(c.id, season))]);
    const admin = await reader.read<Fixture>(ReadModelKeys.adminFixtures(season));
    let games = admin.data;
    let complete = true;
    for (const c of competitions) {
      const snapshot = await reader.read<Fixture>(ReadModelKeys.competitionFixtures(c.id, season));
      const use = snapshot.available && (!games.some(f => f.competitionId === c.id) || Date.parse(snapshot.snapshotAt) >= Date.parse(admin.snapshotAt || '1970-01-01'));
      if (use) { games = [...games.filter(f => f.competitionId !== c.id), ...snapshot.data.filter(f => f.competitionId === c.id)]; stale ||= snapshot.stale; }
      else if (admin.available) stale ||= admin.stale;
      if (!snapshot.available && !admin.available) complete = false;
    }
    const deleted = await reader.read<{ fixtureId: string; restoredAt?: string }>(tombstone);
    // Tombstones are created on the first deletion, so absence is not missing fixtures.
    if (deleted.available) stale ||= deleted.stale;
    if (reader.failedKeys().includes(tombstone)) complete = false;
    fixtureCoverage.set(scope, complete);
    const ids = new Set(deleted.data.filter(t => !t.restoredAt).map(t => t.fixtureId));
    return filterRetiredFixtures([...new Map(games.filter(f => f.seasonId === season && f.status !== 'CANCELLED' && !ids.has(f.id)).map(f => [f.id, f])).values()], season);
    })());
    return fixtureLoads.get(scope)!;
  };
  const read = async (raw: unknown) => {
    const parsed = tournamentQuerySchema.safeParse(raw);
    if (!parsed.success) return { error: 'INVALID_QUERY', details: parsed.error.issues.map(i => i.path.join('.')) };
    const q = parsed.data;
    const { competitions, clubs } = await loadCatalog();
    const selectedComps = q.competition ? competitions.filter(c => matchesAiCompetition(q.competition!, c)) : competitions;
    let clarification: string | undefined;
    const findClubs = (value: string) => { const exact = clubs.filter(c => c.id === value); if (exact.length) return exact; const resolved=resolveAiClubs(value,clubs); clarification ||= resolved.clarification; const ids = new Set(resolved.clubs.map(c => c.id)); return clubs.filter(c => ids.has(c.id)); };
    const selectedClubs = q.club ? findClubs(q.club) : clubs;
    const opponents = q.opponent ? findClubs(q.opponent) : [];
    if(clarification)return {error:'ENTITY_CLARIFICATION',message:clarification,data:[]};
    if(q.competition && selectedComps.length>1)return {error:'AMBIGUOUS_COMPETITION',choices:selectedComps.map(c=>({id:c.id,name:c.name})),data:[]};
    if ((q.competition && !selectedComps.length && reader.missingKeys().includes(ReadModelKeys.competitions(season))) || ((q.club || q.opponent) && !clubs.length && reader.missingKeys().includes(ReadModelKeys.clubsWithOwners(season))))
      return {error:'DATA_UNAVAILABLE',message:'Kerakli snapshot o‘qilmadi. Bu jamoa yoki turnir mavjud emas degani emas.',missingDatasets:reader.missingKeys(),data:[]};
    if (q.competition && !selectedComps.length || q.club && !selectedClubs.length || q.opponent && !opponents.length)
      return { error: 'ENTITY_NOT_FOUND', message: 'Filter topilmadi; boshqa turnir yoki jamoaga o‘tib ketmang.' };
    if (q.club && selectedClubs.length > 1 || q.opponent && opponents.length > 1)
      return { error: 'AMBIGUOUS_CLUB', choices: [...(q.club?selectedClubs:[]), ...opponents].map(c => ({ id: c.id, name: c.name })) };
    let rows: Record<string, unknown>[] = [];
    const compIds = new Set(selectedComps.map(c => c.id));
    const clubIds = new Set(selectedClubs.map(c => c.id));
    const name = (id: string | null) => clubs.find(c => c.id === id)?.name || 'Raqib aniqlanmagan';
    if (q.dataset === 'competitions') rows = selectedComps.map(c => project(c, ['id', 'name', 'type', 'status', 'seasonId', 'leagueId', 'formatConfig', 'currentMatchday', 'totalMatchdays', 'isMatchdayOpen', 'matchdayOpenedAt', 'matchdayDurationHours', 'nextMatchdayOpenAt', 'adminOverrideStatus']));
    if (q.dataset === 'clubs') {
      const fixtureClubIds = new Set<string>();
      if (q.competition && selectedComps.some(c => c.type !== 'LEAGUE')) {
        for (const f of await loadFixtures(selectedComps)) if (compIds.has(f.competitionId)) {
          if (f.homeClubId) fixtureClubIds.add(f.homeClubId); if (f.awayClubId) fixtureClubIds.add(f.awayClubId);
        }
      }
      rows = selectedClubs.filter(c => (!q.competition || selectedComps.some(x => x.type === 'LEAGUE' && x.leagueId === c.leagueId) || fixtureClubIds.has(c.id)) && (!q.ownerUsername || (c.ownerUsername || '').replace(/^@/, '').toLowerCase() === q.ownerUsername.replace(/^@/, '').toLowerCase())).map(c => ({ ...project(c, ['id', 'name', 'leagueId', 'ownerUsername']), ownershipKnown: Object.hasOwn(c, 'ownerUserId'), occupied: Object.hasOwn(c, 'ownerUserId') ? Boolean(c.ownerUserId) : null }));
    }
    if (q.dataset === 'standings') {
      const tables = selectedComps.filter(c => ['LEAGUE', 'EUROPEAN_LEAGUE_PHASE'].includes(c.type));
      await reader.load(tables.map(c => ReadModelKeys.standings(c.id, season)));
      for (const c of tables) {
        const table = await reader.read<StandingsRow>(ReadModelKeys.standings(c.id, season)); stale ||= table.stale;
        rows.push(...table.data.filter(r => !q.club || clubIds.has(r.clubId)).sort((a, b) => a.position - b.position).map(r => ({ competition: c.name, ...project(r, ['clubId', 'clubName', 'position', 'points', 'played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst', 'goalDifference']) })));
      }
    }
    if (q.dataset === 'fixtures' || q.dataset === 'statistics') {
      const stage = q.stage ? detectAiCupStage(q.stage) : null;
      if (q.stage && !stage) return { error: 'UNKNOWN_STAGE' };
      const involves = (f: Fixture, ids: Set<string>) => ids.has(f.homeClubId || '') || ids.has(f.awayClubId || '');
      const stateMatches = (f: Fixture) => !q.fixtureState || ({
        unplayed: ['SCHEDULED', 'POSTPONED'].includes(f.status),
        awaiting_confirmation: f.status === 'PENDING_CONFIRMATION', disputed: f.status === 'DISPUTED',
        unfinished: !['CONFIRMED', 'CANCELLED'].includes(f.status), confirmed: f.status === 'CONFIRMED',
      })[q.fixtureState];
      const games = sortSeasonFixtures((await loadFixtures(selectedComps)).filter(f => compIds.has(f.competitionId) && (!q.club || involves(f, clubIds)) && (!q.opponent || involves(f, new Set(opponents.map(c => c.id)))) && (!q.fixtureId || f.id === q.fixtureId) && (!q.matchday || f.matchday === q.matchday) && (!q.matchdayTo || f.matchday <= q.matchdayTo) && stateMatches(f) && (!q.status || f.status === q.status) && (!stage || fixtureMatchesAiCupStage(f, stage))));
      if (q.dataset === 'fixtures') rows = games.map(f => ({ ...project(f, ['id', 'competitionId', 'matchday', 'roundName', 'homeClubId', 'awayClubId', 'status', 'scheduledAt', 'resultConfirmedAt', 'winnerClubId']), home: name(f.homeClubId), away: name(f.awayClubId), competition: competitions.find(c => c.id === f.competitionId)?.name, homeScore: validScore(f) ? f.homeScore : null, awayScore: validScore(f) ? f.awayScore : null }));
      else rows = selectedComps.map(c => {
        const scope = games.filter(f => f.competitionId === c.id); const confirmed = scope.filter(validScore);
        const club = q.club && selectedClubs.length === 1 ? selectedClubs[0] : null;
        const margin = (f: Fixture) => f.homeClubId === club?.id ? f.homeScore! - f.awayScore! : f.awayScore! - f.homeScore!;
        return { competition: c.name, total: scope.length, confirmed: confirmed.length, unfinished: scope.length - confirmed.length,
          ...(club ? { club: club.name, won: confirmed.filter(f => margin(f) > 0).length, drawn: confirmed.filter(f => margin(f) === 0).length, lost: confirmed.filter(f => margin(f) < 0).length, goalsFor: confirmed.reduce((sum, f) => sum + (f.homeClubId === club.id ? f.homeScore! : f.awayScore!), 0), goalsAgainst: confirmed.reduce((sum, f) => sum + (f.homeClubId === club.id ? f.awayScore! : f.homeScore!), 0) } : {}) };
      });
    }
    const offset = q.offset || 0, limit = q.limit || 20;
    const fixturesDataset = q.dataset === 'fixtures' || q.dataset === 'statistics';
    const catalogComplete = !reader.missingKeys().some(k => [ReadModelKeys.competitions(season), ReadModelKeys.clubsWithOwners(season)].includes(k));
    const catalogKey = q.dataset === 'competitions' ? ReadModelKeys.competitions(season) : q.dataset === 'clubs' ? ReadModelKeys.clubsWithOwners(season) : null;
    const complete = catalogKey ? !reader.missingKeys().includes(catalogKey) && !reader.failedKeys().includes(catalogKey) : fixturesDataset ? catalogComplete && fixtureCoverage.get(selectedComps.map(c => c.id).sort().join('|')) === true : reader.missingKeys().length===0&&reader.failedKeys().length===0;
    return { season, stale, complete, snapshots:reader.snapshotStatus(), total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null, data: rows.slice(offset, offset + limit), missingDatasets: reader.missingKeys(), failedDatasets: reader.failedKeys(), note: 'complete tanlangan so‘rov manbalarining mavjudligini bildiradi. stale bo‘lsa joriy holat tasdiqlanmagan. Davom uchun nextOffset ishlating.' };
  };
  return { read };
}
