import {getFirestoreDb} from '../firebase/admin';
import {isSeasonCompetitionEnabled} from '../../lib/seasonParticipationPolicy';
import {isEuropeanFixtureCompetition,europeanDrawPublished} from './europeanFixtureGate';

/** Explicit reached-round watermark, independent of a selected round/timer.
 * Expiry does not erase an unfinished game. Explicit admin holds still win. */
export function backlogResultAllowed(f: any, c: any, lock?: any): boolean {
  if (isEuropeanFixtureCompetition(f.competitionId) && (!europeanDrawPublished(c) || f.europeanDrawId !== c.europeanDrawId)) return false;
  if (!c || c.seasonId !== f.seasonId || !isSeasonCompetitionEnabled(f.competitionId,f.seasonId) ||
      !['SCHEDULED','PENDING_CONFIRMATION'].includes(f.status) ||
      ['completed','archived','cancelled','draft','inactive'].includes(String(c.status).toLowerCase()) ||
      ['PAUSED','FORCE_LOCKED'].includes(c.adminOverrideStatus) ||
      ['PAUSED','FORCE_LOCKED'].includes(lock?.overrideStatus) || lock?.isLocked || lock?.isOpen === false ||
      !f.homeClubId || !f.awayClubId || [f.homeClubId,f.awayClubId].includes('TBD')) return false;
  // Season 1 Super Cups have a single active final / current bracket round.
  // Expiring round timers must not silently disable unplayed match reporting.
  // Honor explicit admin holds and never unlock upcoming or finished tournaments.
  if (f.seasonId === 'season-2026-27' && c.type === 'SUPER_CUP' &&
      String(c.status).toLowerCase() === 'active' &&
      Number(f.matchday) === Number(c.currentMatchday || 1)) return true;
  const configured=c.resultEntryThroughMatchday;
  if(!Number.isInteger(configured))return false;
  const through=Math.max(configured,Number.isInteger(c.currentMatchday)?c.currentMatchday:0);
  return Number.isInteger(through) && through>0 && through<=100 && Number.isInteger(Number(f.matchday)) &&
    Number(f.matchday)>0 && Number(f.matchday)<=through;
}

/** Also usable inside the result transaction: no stale cache authorizes a write. */
export async function readBacklogResultAccess(f: any, reader?: {get(ref:any):Promise<any>}): Promise<boolean> {
  const db=getFirestoreDb(), get=reader ? (ref:any)=>reader.get(ref) : (ref:any)=>ref.get();
  const [c,l]=await Promise.all([
    get(db.collection('competitions').doc(f.competitionId)),
    get(db.collection('matchday_locks').doc(`${f.seasonId}:${f.competitionId}:${f.matchday}`)),
  ]);
  return backlogResultAllowed(f,c.data(),l.data());
}
