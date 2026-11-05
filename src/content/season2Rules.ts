import { SEASON_TWO_ROSTERS } from './season2Rosters';

/** Real-world rule references for the isolated second-season preparation workbench. */
export type TieMetric = 'points'|'goalDifference'|'goalsFor'|'won'|'awayGoals'|'awayWins'|'h2hPoints'|'h2hGoalDifference'|'h2hGoalsFor'|'h2hAwayGoals'|'h2hForfeits'|'discipline'|'forfeits'|'previousPosition';
export interface PreparedTieRule {
  criteria: TieMetric[];
  interimCriteria?: TieMetric[];
  multiTeamCriteria?: TieMetric[];
  reapplyHeadToHead?: boolean;
  resolution: 'PLAYOFF'|'DRAW'|'PLAYOFF_OR_YOUTH_TABLE'|'OFFICIAL_DECISION';
  verification: 'VERIFIED'|'REVIEW_REQUIRED';
  source: string;
  notes: string;
}
export const PREPARED_TIE_RULES: Record<string,PreparedTieRule> = {
  'league-premier-league': { criteria:['points','goalDifference','goalsFor','h2hPoints','h2hAwayGoals'], interimCriteria:['points','goalDifference','goalsFor'],resolution:'PLAYOFF',verification:'VERIFIED',source:'https://www.premierleague.com/en/news/58905',notes:'O‘zaro natijalar titul, Yevropa yo‘llanmasi yoki tushib ketishni ajratish zarur bo‘lganda; qolgan teng o‘rinlar teng qoladi.' },
  'league-la-liga': { criteria:['points','h2hGoalDifference','goalDifference','goalsFor','discipline'],multiTeamCriteria:['points','h2hPoints','h2hGoalDifference','goalDifference','goalsFor','discipline'], reapplyHeadToHead:true,resolution:'OFFICIAL_DECISION',verification:'VERIFIED',source:'https://rfef.es/sites/default/files/2025-11/TABLA_DE_CORRESPONDENCIA_PARA_PUBLICAR.pdf',notes:'Ikki va ko‘p klub uchun alohida tartib; yakuniy intizom yoki rasmiy hal qiluvchi qaror avtomatik uydirilmaydi.' },
  'league-serie-a': { criteria:['points','h2hPoints','h2hGoalDifference','goalDifference','goalsFor'],resolution:'DRAW',verification:'VERIFIED',source:'https://files.figc.it/version/c%3AZmUzYzk0MzUtMzU0Zi00%3AYTk3YzZiZGEtYmExYi00/244%20-%20Deroga%20art.%2051%20NOIF%20-%20Determinazione%20classifica%20Campionato%20Serie%20A%20ss%202026%20-%202027.pdf',notes:'FIGC 244/A: titul uchun bitta, 17–18-o‘rin uchun ikkita pley-off o‘yini; qatnashchilardan biri UEFA finalchisi bo‘lsa mini-jadval qo‘llanadi.' },
  'league-bundesliga': { criteria:['points','goalDifference','goalsFor','h2hGoalDifference','h2hAwayGoals','awayGoals'],resolution:'PLAYOFF',verification:'VERIFIED',source:'https://www.bundesliga.com/de/bundesliga/news/dfl-informationen-saisonfinale-2025-26-meisterehrungen-37369',notes:'Umumiy to‘plar farqi, urilgan gol, o‘zaro umumiy hisob, o‘zaro safar goli va barcha safar gollari.' },
  'league-ligue-1': { criteria:['points','goalDifference','h2hPoints','h2hGoalDifference','goalsFor','won','awayWins','discipline'],resolution:'DRAW',verification:'VERIFIED',source:'https://ligue1.com/en/articles/l1_article_2830-',notes:'2025/26 dan yangilangan mezonlar: eski o‘zaro safar goli qoidasi ishlatilmaydi.' },
  'league-uzbekistan-superliga': { criteria:['points','h2hForfeits','h2hPoints','h2hGoalDifference','goalDifference','goalsFor','won'],resolution:'PLAYOFF_OR_YOUTH_TABLE',verification:'VERIFIED',source:'https://cdn.pfl.uz/match/c5574713-d7df-49c5-9df1-2f9af1f72d6c-d2d68ce4-4914-4bdf-937f-312761843a85.pdf',notes:'Tasdiqlangan 2026 reglament 7-bob: o‘zaro texnik mag‘lubiyat istisnosi; to‘liq tenglikda U19 yoki titul/xalqaro yo‘llanma uchun oltin o‘yin.' },
  'league-saudi-pro-league': { criteria:['points','h2hPoints','h2hGoalDifference','h2hGoalsFor','goalDifference','goalsFor','discipline'],interimCriteria:['points','goalDifference','goalsFor','previousPosition'],reapplyHeadToHead:true,resolution:'PLAYOFF',verification:'VERIFIED',source:'https://images.spl.com.sa/image/private/fl_attachment/prd/yn2olap5ftvbexvoarxu.pdf',notes:'2026/27 Handbook 9-modda. Yakuniy turdagi o‘zaro so‘nggi o‘yin maxsus holati qo‘lda rasmiylashtiriladi.' },
  'league-j1': { criteria:['points','goalDifference','goalsFor','h2hPoints','h2hGoalDifference','h2hGoalsFor'],resolution:'DRAW',verification:'VERIFIED',source:'https://www.jleague.jp/en/outline/j1/',notes:'Yakuniy tenglik zarur bo‘lsa rasmiy qur’a orqali hal qilinadi.' },
  'league-turkey-super-lig': { criteria:['points','h2hPoints','h2hGoalDifference','goalDifference','goalsFor','forfeits'],multiTeamCriteria:['points','h2hPoints','h2hGoalDifference','h2hGoalsFor','goalDifference','goalsFor','forfeits'],resolution:'PLAYOFF',verification:'VERIFIED',source:'https://www.tff.org/Resources/TFF/Documents/TALIMATLAR/Futbol-Musabaka-Talimati.pdf',notes:'FMT 9-modda: mini-jadval qaytadan hisoblanmaydi, o‘zaro safar goli ustunligi yo‘q; o‘zaro uchrashuvlar tugaguncha umumiy mezonlar.' },
};

/** EFL custom cups: league clubs only, seeded play-in followed by a single-leg last 16. */
export const PREPARED_DOMESTIC_CUPS = [
  {id:'comp-fa-cup-2027',leagueId:'league-premier-league',name:'FA Cup'},
  {id:'comp-copa-del-rey-2027',leagueId:'league-la-liga',name:'Copa del Rey'},
  {id:'comp-coppa-italia-2027',leagueId:'league-serie-a',name:'Coppa Italia'},
  {id:'comp-dfb-pokal-2027',leagueId:'league-bundesliga',name:'DFB-Pokal'},
  {id:'comp-coupe-de-france-2027',leagueId:'league-ligue-1',name:'Coupe de France'},
  {id:'comp-uzbekistan-cup-2027',leagueId:'league-uzbekistan-superliga',name:'O‘zbekiston kubogi'},
  {id:'comp-king-cup-2027',leagueId:'league-saudi-pro-league',name:'King Cup'},
  {id:'comp-emperors-cup-2027',leagueId:'league-j1',name:'Emperor’s Cup'},
  {id:'comp-turkey-cup-2027',leagueId:'league-turkey-super-lig',name:'Türkiye Kupası'},
].map(cup=>{
  const clubs=SEASON_TWO_ROSTERS[cup.leagueId].clubs;
  const total=clubs.length;
  if(![16,18,20].includes(total))throw new Error('UNSUPPORTED_EFL_CUP_SIZE');
  const preliminaryMatches=total-16;
  return {
    ...cup,format:'EFL_CUSTOM' as const,expectedEntrants:total,
    verification:'VERIFIED' as const,participantStatus:'READY' as const,
    participantClubIds:clubs.map(club=>club.id),
    source:'https://github.com/TexnoAyti/efluz/blob/main/src/server/routes/adminCupDraw.routes.ts',
    seeding:'LEAGUE_STANDINGS' as const,seedingStatus:'AWAITING_SEASON_TWO_STANDINGS' as const,
    preliminaryMatches,playInTeams:preliminaryMatches*2,byeTeams:32-total,
    totalRounds:preliminaryMatches?5:4,totalFixtures:total-1,
    legsPerTie:1,roundOf16Teams:16,
    // Positions 1–12 (20 teams) or 1–14 (18 teams) skip the play-in.
    byeThroughPosition:32-total,playInFromPosition:preliminaryMatches?33-total:null,
  };
});

export const PREPARED_UEFA_COMPETITIONS = [
  {id:'comp-champions-league-2027',code:'UCL',name:'UEFA Champions League',matchesPerTeam:8,pots:4,source:'https://www.uefa.com/uefachampionsleague/news/02a6-20d57cfcd03e-407c22a7f465-1000--2026-27-champions-league-teams-draws-format-final/'},
  {id:'comp-europa-league-2027',code:'UEL',name:'UEFA Europa League',matchesPerTeam:8,pots:4,source:'https://documents.uefa.com/r/Regulations-of-the-UEFA-Europa-League-2026/27/Article-17-Match-system-league-phase-Online'},
  {id:'comp-conference-league-2027',code:'UECL',name:'UEFA Conference League',matchesPerTeam:6,pots:6,source:'https://documents.uefa.com/r/Regulations-of-the-UEFA-Conference-League-2026/27/Article-17-Match-system-league-phase-Online'},
].map(comp=>({...comp,totalTeams:36,homeMatches:comp.matchesPerTeam/2,awayMatches:comp.matchesPerTeam/2,totalFixtures:36*comp.matchesPerTeam/2,directQualifiers:8,playoffPlaces:[9,24],eliminatedPlaces:[25,36],qualificationMode:'UEFA_ACCESS_LIST',qualificationSlots:null,participantClubIds:[] as string[],requiresExternalAssociations:true,noSameAssociation:true,maxOpponentsPerOtherAssociation:2}));
