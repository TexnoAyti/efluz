export type CardColor = 'YELLOW' | 'RED';
export type DisciplineReason = 'ABUSE' | 'DELAY' | 'NO_SHOW' | 'OTHER';
export interface DisciplineCard {
  id: string; userId: string; seasonId: string; color: CardColor; reason: DisciplineReason;
  note: string; incidentFixtureId: string | null; suspensionFixtureId: string | null;
  status: 'ACTIVE' | 'REVOKED'; createdAt: string; createdBy: string;
  revokedAt?: string; revokedBy?: string; revokeReason?: string;
  suspensionMatch?: { homeClubId:string; awayClubId:string; matchday:number; scheduledAt:string; competitionName?:string; roundName?:string };
  suspensionStatus?: 'PENDING' | 'ASSIGNED' | 'SERVED';
}
export interface DisciplinaryHold { cardId: string; userId: string }
export const disciplineReasons = { ABUSE: 'Haqorat yoki hurmatsizlik', DELAY: 'O‘yinni cho‘zish', NO_SHOW: 'Vaqtida o‘ynamaslik', OTHER: 'Boshqa qoidabuzarlik' };
export function assertNoDisciplinaryHold(fixture: { disciplinaryHolds?: DisciplinaryHold[] }) {
  if (fixture.disciplinaryHolds?.length) throw Object.assign(new Error('Qizil kartochka: bu o‘yinda bir o‘yinlik chetlatish bor. Natijani admin hal qiladi.'), { code: 'DISCIPLINARY_SUSPENSION', statusCode: 409 });
}
