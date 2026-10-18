export function isDomesticCupResult(competitionId: string): boolean {
  return ['comp-fa-cup-2026', 'comp-copa-del-rey-2026', 'comp-coppa-italia-2026', 'comp-dfb-pokal-2026', 'comp-coupe-de-france-2026'].includes(competitionId);
}

export interface CupResultScores {
  homeScore: number;
  awayScore: number;
  // Totals after extra time, excluding the shootout.
  homeExtraTimeScore?: number | null;
  awayExtraTimeScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
}

export function resolveCupResult(
  scores: CupResultScores,
  fixture: { homeClubId: string | null; awayClubId: string | null },
  isCup: boolean,
  status = 'CONFIRMED',
) {
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { code: 'INVALID_CUP_RESULT', statusCode: 400 });
  };
  for (const value of [scores.homeScore, scores.awayScore, scores.homeExtraTimeScore, scores.awayExtraTimeScore, scores.homePenaltyScore, scores.awayPenaltyScore]) {
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 99)) fail('Hisoblar 0–99 oralig‘idagi butun son bo‘lishi kerak.');
  }
  const { homeScore, awayScore } = scores;
  const homeExtraTimeScore = scores.homeExtraTimeScore ?? null;
  const awayExtraTimeScore = scores.awayExtraTimeScore ?? null;
  const homePenaltyScore = scores.homePenaltyScore ?? null;
  const awayPenaltyScore = scores.awayPenaltyScore ?? null;
  const extra = homeExtraTimeScore != null || awayExtraTimeScore != null;
  const penalties = homePenaltyScore != null || awayPenaltyScore != null;
  if (!isCup && (extra || penalties)) fail('Qo‘shimcha vaqt va penaltilar faqat kubok uchun.');
  if (extra && (homeExtraTimeScore == null || awayExtraTimeScore == null || homeScore !== awayScore || homeExtraTimeScore < homeScore || awayExtraTimeScore < awayScore)) fail('Qo‘shimcha vaqtdan keyingi umumiy hisobni ikkala jamoa uchun to‘g‘ri kiriting.');
  const home = homeExtraTimeScore ?? homeScore;
  const away = awayExtraTimeScore ?? awayScore;
  if (penalties && (homePenaltyScore == null || awayPenaltyScore == null || home !== away || homePenaltyScore === awayPenaltyScore)) fail('Penaltilar faqat durangdan keyin kiritiladi va g‘olibni aniqlashi kerak.');
  let winnerClubId: string | null = null;
  if (home > away) winnerClubId = fixture.homeClubId;
  else if (away > home) winnerClubId = fixture.awayClubId;
  else if (penalties) winnerClubId = homePenaltyScore! > awayPenaltyScore! ? fixture.homeClubId : fixture.awayClubId;
  if (isCup && status === 'CONFIRMED' && (!fixture.homeClubId || !fixture.awayClubId || fixture.homeClubId === 'TBD' || fixture.awayClubId === 'TBD')) fail('Ikkala jamoa aniqlanmaguncha kubok natijasini tasdiqlab bo‘lmaydi.');
  if (isCup && status === 'CONFIRMED' && (!winnerClubId || winnerClubId === 'TBD')) fail('Kubokda g‘olib aniqlanishi kerak. Qo‘shimcha vaqt yoki penaltilar hisobini kiriting.');
  if (status !== 'CONFIRMED') winnerClubId = null;
  return { homeExtraTimeScore, awayExtraTimeScore, homePenaltyScore, awayPenaltyScore, winnerClubId };
}

export type CupTieBreakScores = Omit<CupResultScores, 'homeScore' | 'awayScore'>;

export function cupScoreMetadata(scores: CupTieBreakScores = {}) {
  return {
    homeExtraTimeScore: scores.homeExtraTimeScore ?? null,
    awayExtraTimeScore: scores.awayExtraTimeScore ?? null,
    homePenaltyScore: scores.homePenaltyScore ?? null,
    awayPenaltyScore: scores.awayPenaltyScore ?? null,
  };
}

export function sameResultScores(a: CupResultScores, b: CupResultScores): boolean {
  return a.homeScore === b.homeScore && a.awayScore === b.awayScore &&
    (Object.keys(cupScoreMetadata()) as (keyof CupTieBreakScores)[]).every(key => (a[key] ?? null) === (b[key] ?? null));
}
