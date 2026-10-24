import { isSeasonCompetitionEnabled, CURRENT_SEASON_ID } from '../../lib/seasonParticipationPolicy';
import {getFirestoreDb} from '../firebase/admin';
import {SEED_COMPETITIONS, SEED_CLUBS} from '../db/seed';
import {filterRetiredFixtures} from './retiredFixtureService';

export const isEuropeanFixtureCompetition = (id: string) => /(?:champions-league|europa-league|(?:^|-)ucl(?:-|$)|(?:^|-)uel(?:-|$))/.test(id);
export function europeanDrawPublished(comp: any): boolean {
  return Boolean(comp?.europeanQualificationMode === 'final' && comp.europeanQualificationToken &&
    comp.europeanDrawId && comp.europeanDrawQualificationToken === comp.europeanQualificationToken);
}
function blocked(code: string, message: string): never {
  throw Object.assign(new Error(message), {code, status:409, statusCode:409});
}
/** A partial schedule (or one finished league) is not a finished domestic season. */
export function domesticSeasonComplete(competitions: any[], fixtures: any[], seasonId: string): boolean {
  const required = SEED_COMPETITIONS.filter(c => c.type === 'LEAGUE' && c.seasonId === seasonId && isSeasonCompetitionEnabled(c.id,seasonId));
  if (required.length !== (seasonId === CURRENT_SEASON_ID ? 4 : 5)) return false;
  const canonical = filterRetiredFixtures(fixtures, seasonId);
  return required.every(seed => {
    const comp = competitions.find(c => c.id === seed.id && c.seasonId === seasonId);
    if (!comp) return false;
    const clubs = new Set(SEED_CLUBS.filter(c => c.leagueId === seed.leagueId).map(c => c.id));
    const rows = canonical.filter(f => f.competitionId === seed.id && f.seasonId === seasonId);
    const double = comp.formatConfig?.homeAndAway === true;
    const expected = clubs.size * (clubs.size - 1) / (double ? 1 : 2);
    const pairs = new Set(rows.map(f => double ? `${f.homeClubId}:${f.awayClubId}` : [f.homeClubId,f.awayClubId].sort().join(':')));
    return rows.length === expected && pairs.size === expected && rows.every(f =>
      f.status === 'CONFIRMED' && f.homeClubId !== f.awayClubId && clubs.has(f.homeClubId) && clubs.has(f.awayClubId));
  });
}
export async function assertEuropeanDrawReady(comp: any): Promise<void> {
  const db = getFirestoreDb();
  const [comps, fixtures] = await Promise.all([
    db.collection('competitions').where('seasonId','==',comp.seasonId).get(),
    db.collection('fixtures').where('seasonId','==',comp.seasonId).get(),
  ]);
  if (!domesticSeasonComplete(comps.docs.map(d=>({...d.data(),id:d.id})), fixtures.docs.map(d=>({...d.data(),id:d.id})),comp.seasonId))
    blocked('DOMESTIC_LEAGUES_INCOMPLETE','UCL/UEL qur’asi uchun avval barcha ichki liga o‘yinlari yakunlanishi kerak.');
  if (comp.europeanQualificationMode !== 'final' || !comp.europeanQualificationToken)
    blocked('EUROPEAN_QUALIFICATION_NOT_FINAL','Avval yakuniy Yevropa saralashini tasdiqlang, so‘ng qur’a yarating.');
}
export function assertEuropeanDrawPublished(comp: any): void {
  if (!europeanDrawPublished(comp)) blocked('EUROPEAN_DRAW_NOT_PUBLISHED','UCL/UEL o‘yinlari yakuniy saralash va qur’adan keyin ochiladi.');
}
/** Check authoritative publication even when rows come from an old shared snapshot.
 * Each draw tags its fixtures; legacy and previous-draw rows cannot leak through. */
export async function filterPublishedEuropeanFixtures<T extends {competitionId: string; [key:string]:any}>(fixtures:T[]):Promise<T[]> {
  const ids=[...new Set(fixtures.filter(f=>isEuropeanFixtureCompetition(f.competitionId)).map(f=>f.competitionId))];
  if (!ids.length) return fixtures;
  const db=getFirestoreDb();
  const comps=new Map(await Promise.all(ids.map(async id=>[id,(await db.collection('competitions').doc(id).get()).data()] as const)));
  return fixtures.filter(f=> !comps.has(f.competitionId) ||
    (europeanDrawPublished(comps.get(f.competitionId)) && f.europeanDrawId === comps.get(f.competitionId)?.europeanDrawId));
}
