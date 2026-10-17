/** Main/extra-time/shootout scores stay distinct. No unlabelled second score is guessed. */
export function parseAiMatchScore(text: string) {
  const hits = [...text.matchAll(/\b(\d{1,2})\s*[:–—−-]\s*(\d{1,2})\b/g)];
  const fail = (): never => { throw new Error('CLARIFY:Qaysi hisobni saqlay? Asosiy hisob va penaltilarni aniq ajrating. Masalan: Barcelona 1-1 Real Sociedad, penalti 3-1 natijasini kirit.'); };
  if (!hits.length || hits.length > 3) return fail();
  const first = hits[0];
  const homeScore = Number(first[1]), awayScore = Number(first[2]);
  let homeExtraTimeScore: number | null = null, awayExtraTimeScore: number | null = null;
  let homePenaltyScore: number | null = null, awayPenaltyScore: number | null = null;
  let decidedBy = 'REGULAR_TIME';
  for (let i = 1; i < hits.length; i++) {
    const before = text.slice(hits[i-1].index! + hits[i-1][0].length, hits[i].index).toLowerCase();
    if (/pen(?:alti\w*)?(?:\s+seriya\w*)?\s*[:=(]?\s*$/i.test(before)) {
      if (homePenaltyScore !== null || (homeExtraTimeScore ?? homeScore) !== (awayExtraTimeScore ?? awayScore)) return fail();
      homePenaltyScore = Number(hits[i][1]); awayPenaltyScore = Number(hits[i][2]);
      if (homePenaltyScore === awayPenaltyScore) return fail();
      decidedBy = 'PENALTIES';
    } else if (/(?:extra\s*time|q[o‘’'`ʻʼ]*shimcha\s*(?:vaqt\w*)?)\s*[:=(]?\s*$/i.test(before) && i === 1 && homePenaltyScore === null) {
      const h = Number(hits[i][1]), a = Number(hits[i][2]);
      if (homeScore !== awayScore || h < homeScore || a < awayScore) return fail();
      homeExtraTimeScore = h; awayExtraTimeScore = a; decidedBy = 'EXTRA_TIME';
    } else return fail();
  }
  if (/\b(?:penalti\w*|pen\b)/i.test(text) && homePenaltyScore === null) return fail();
  return { homeScore, awayScore, homeExtraTimeScore, awayExtraTimeScore, homePenaltyScore, awayPenaltyScore, decidedBy };
}

export function aiPenaltySuffix(f: { homeExtraTimeScore?: number | null; awayExtraTimeScore?: number | null; homePenaltyScore?: number | null; awayPenaltyScore?: number | null }): string {
  return (f.homeExtraTimeScore != null && f.awayExtraTimeScore != null ? ` (qo‘shimcha vaqt ${f.homeExtraTimeScore}:${f.awayExtraTimeScore})` : '') + (f.homePenaltyScore != null && f.awayPenaltyScore != null ? ` (penalti ${f.homePenaltyScore}:${f.awayPenaltyScore})` : '');
}
