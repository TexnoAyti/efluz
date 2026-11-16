export interface ExpectedTopicFixture { seasonId?: string; competitionId: string; homeClubId: string; awayClubId: string; status: string; updatedAt: string | null; }
export function assertTopicResultCurrent(current: any, expected: ExpectedTopicFixture): void {
  if (!current || current.status === 'CONFIRMED' || !['SCHEDULED','POSTPONED','AWAITING_RESULT','PENDING_CONFIRMATION'].includes(current.status) ||
      (expected.seasonId != null && current.seasonId !== expected.seasonId) ||
      ['competitionId','homeClubId','awayClubId','status','updatedAt'].some(key => (current[key] ?? null) !== (expected as any)[key])) {
    throw Object.assign(new Error('O‘yin taklifdan keyin o‘zgargan yoki natijasi tasdiqlangan. Eski taklif bilan almashtirilmaydi.'), {code:'TOPIC_RESULT_CHANGED'});
  }
}
