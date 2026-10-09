import type { Fixture } from '../types';
export function getScopedAdminFixturePage(fixtures: Fixture[], filters: { competitionId?: string; status?: string; clubId?: string; matchday?: string; search?: string; page?: number; limit?: number }) {
  const query = (filters.search || '').trim().toLowerCase();
  const rows = fixtures.filter(fixture =>
    (!filters.competitionId || filters.competitionId === 'ALL' || fixture.competitionId === filters.competitionId) &&
    (!filters.status || filters.status === 'ALL' || fixture.status === filters.status) &&
    (!filters.clubId || filters.clubId === 'ALL' || fixture.homeClubId === filters.clubId || fixture.awayClubId === filters.clubId) &&
    (!filters.matchday || filters.matchday === 'ALL' || fixture.matchday === Number(filters.matchday)) &&
    (!query || [fixture.id, fixture.homeClubId, fixture.awayClubId, fixture.homeClub?.name, fixture.awayClub?.name, fixture.homeClub?.shortName, fixture.awayClub?.shortName].some(value => String(value || '').toLowerCase().includes(query)))
  ).sort((a, b) => Number(a.matchday || 0) - Number(b.matchday || 0) || a.id.localeCompare(b.id));
  const limit = Math.min(100, Math.max(1, filters.limit || 25));
  const page = Math.max(1, filters.page || 1);
  return { fixtures: rows.slice((page - 1) * limit, page * limit), total: rows.length, hasMore: page * limit < rows.length, nextCursor: undefined as string | undefined };
}
