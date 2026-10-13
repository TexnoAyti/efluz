import type {CustomTournament, CustomTournamentAuditLog, CustomTournamentFixture} from '../types/customTournament';
export const tournamentStatusLabel: Record<CustomTournament['status'], string> = {
  DRAFT:'Eski qoralama', STARTING:'Taqvim tayyorlanmoqda', REGISTRATION_OPEN:'Qabul ochiq', IN_PROGRESS:'Davom etmoqda', COMPLETED:'Yakunlangan', CANCELLED:'Bekor qilingan',
};
export const tournamentFormatLabel: Record<CustomTournament['format'], string> = {LEAGUE:'Liga',PLAYOFF:'Pley-off',LEAGUE_AND_PLAYOFF:'Liga + pley-off'};
export const fixtureStatusLabel: Record<CustomTournamentFixture['status'], string> = {SCHEDULED:'Kutilmoqda',PENDING_CONFIRMATION:'Tasdiq kutilmoqda',CONFIRMED:'Tasdiqlangan',DISPUTED:'Nizoli',BYE_AUTO_ADVANCED:'O‘yinsiz o‘tgan'};
export const auditActionLabel: Record<CustomTournamentAuditLog['action'], string> = {
  TOURNAMENT_CREATED:'Turnir yaratildi',TOURNAMENT_PUBLISHED:'Qabul ochildi',TOURNAMENT_STARTED:'Turnir boshlandi',TOURNAMENT_CANCELLED:'Turnir bekor qilindi',
  SETTINGS_UPDATED:'Sozlamalar yangilandi',PARTICIPANT_REMOVED:'Qatnashchi chiqarildi',PARTICIPANT_APPROVED:'Ariza tasdiqlandi',PARTICIPANT_REJECTED:'Ariza rad etildi',
  PARTICIPANT_JOINED:'Qatnashchi qo‘shildi',PARTICIPANT_LEFT:'Qatnashchi chiqdi',PARTICIPANT_DISQUALIFIED:'Qatnashchi chetlatildi',ASSISTANT_ADDED:'Yordamchi tayinlandi',ASSISTANT_REMOVED:'Yordamchi olib tashlandi',RESULT_OVERRIDDEN:'Rasmiy natija kiritildi',DISPUTE_RESOLVED:'Natija tuzatildi',
};
export function tournamentStartBlocker(t:CustomTournament, participants:Array<{status:string}>): string | null {
  if (participants.some(p=>p.status==='PENDING_APPROVAL')) return 'Avval kutilayotgan arizalarni ko‘rib chiqing.';
  const count=participants.filter(p=>p.status==='REGISTERED').length;
  if (count<4) return 'Boshlash uchun kamida 4 ta qatnashchi kerak.';
  if (t.format==='LEAGUE_AND_PLAYOFF' && (count<(t.rules.playoffQualifiersCount||4) || (t.rules.groupStageMode==='GROUPS' && count<(t.rules.groupsCount||2)*2))) return 'Qatnashchilar soni guruh yoki pley-off reglamentiga yetmaydi.';
  return null;
}
