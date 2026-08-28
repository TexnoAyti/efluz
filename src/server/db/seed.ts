import { queryGet, queryAll, queryRun, dbTransaction } from './index';

interface SeedClub {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string;
  logoUrl: string;
}

interface SeedLeague {
  id: string;
  name: string;
  country: string;
  tier: number;
  logoUrl: string;
}

interface SeedCompetition {
  id: string;
  seasonId: string;
  leagueId?: string;
  name: string;
  type: 'LEAGUE' | 'KNOCKOUT' | 'SUPER_CUP' | 'EUROPEAN_LEAGUE_PHASE' | 'EUROPEAN_KNOCKOUT';
  scheduleMode: 'REAL_SCHEDULE' | 'OFFICIAL_IMPORT' | 'GENERATED_SCHEDULE';
  formatConfig: Record<string, any>;
}

export const SEED_SEASON = {
  id: 'season-2026-27',
  name: '2026/27 Season',
  status: 'active',
  startDate: '2026-08-15',
  endDate: '2027-05-30',
};

export const SEED_LEAGUES: SeedLeague[] = [
  {
    id: 'league-premier-league',
    name: 'Premier League',
    country: 'England',
    tier: 1,
    logoUrl: 'https://crests.football-data.org/PL.png',
  },
  {
    id: 'league-la-liga',
    name: 'La Liga',
    country: 'Spain',
    tier: 1,
    logoUrl: 'https://crests.football-data.org/PD.png',
  },
  {
    id: 'league-serie-a',
    name: 'Serie A',
    country: 'Italy',
    tier: 1,
    logoUrl: 'https://crests.football-data.org/SA.png',
  },
  {
    id: 'league-bundesliga',
    name: 'Bundesliga',
    country: 'Germany',
    tier: 1,
    logoUrl: 'https://crests.football-data.org/BL1.png',
  },
  {
    id: 'league-ligue-1',
    name: 'Ligue 1',
    country: 'France',
    tier: 1,
    logoUrl: 'https://crests.football-data.org/FL1.png',
  },
];

export const SEED_CLUBS: SeedClub[] = [
  // --- PREMIER LEAGUE (20 CLUBS - 2026/27) ---
  { id: 'club-arsenal', name: 'Arsenal', shortName: 'ARS', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t3.svg' },
  { id: 'club-aston-villa', name: 'Aston Villa', shortName: 'AVL', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t7.svg' },
  { id: 'club-bournemouth', name: 'AFC Bournemouth', shortName: 'BOU', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t91.svg' },
  { id: 'club-brentford', name: 'Brentford', shortName: 'BRE', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t94.svg' },
  { id: 'club-brighton', name: 'Brighton & Hove Albion', shortName: 'BHA', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t36.svg' },
  { id: 'club-chelsea', name: 'Chelsea', shortName: 'CHE', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t8.svg' },
  { id: 'club-coventry', name: 'Coventry City', shortName: 'COV', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://crests.football-data.org/1076.png' },
  { id: 'club-crystal-palace', name: 'Crystal Palace', shortName: 'CRY', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t31.svg' },
  { id: 'club-everton', name: 'Everton', shortName: 'EVE', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t11.svg' },
  { id: 'club-fulham', name: 'Fulham', shortName: 'FUL', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t54.svg' },
  { id: 'club-hull', name: 'Hull City', shortName: 'HUL', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t88.svg' },
  { id: 'club-ipswich', name: 'Ipswich Town', shortName: 'IPS', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t40.svg' },
  { id: 'club-leeds', name: 'Leeds United', shortName: 'LEE', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t2.svg' },
  { id: 'club-liverpool', name: 'Liverpool', shortName: 'LIV', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t14.svg' },
  { id: 'club-man-city', name: 'Manchester City', shortName: 'MCI', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t43.svg' },
  { id: 'club-man-utd', name: 'Manchester United', shortName: 'MUN', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t1.svg' },
  { id: 'club-newcastle', name: 'Newcastle United', shortName: 'NEW', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t4.svg' },
  { id: 'club-nottm-forest', name: 'Nottingham Forest', shortName: 'NFO', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t17.svg' },
  { id: 'club-sunderland', name: 'Sunderland', shortName: 'SUN', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t56.svg' },
  { id: 'club-tottenham', name: 'Tottenham Hotspur', shortName: 'TOT', country: 'England', leagueId: 'league-premier-league', logoUrl: 'https://resources.premierleague.com/premierleague/badges/t6.svg' },

  // --- LA LIGA (20 CLUBS - 2026/27) ---
  { id: 'club-alaves', name: 'Deportivo Alavés', shortName: 'ALA', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/263.png' },
  { id: 'club-athletic-club', name: 'Athletic Club', shortName: 'ATH', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/77.png' },
  { id: 'club-atletico-madrid', name: 'Atlético de Madrid', shortName: 'ATM', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/78.png' },
  { id: 'club-barcelona', name: 'FC Barcelona', shortName: 'BAR', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/81.png' },
  { id: 'club-celta-vigo', name: 'RC Celta', shortName: 'CEL', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/558.png' },
  { id: 'club-deportivo-la-coruna', name: 'Deportivo La Coruña', shortName: 'DEP', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/560.png' },
  { id: 'club-getafe', name: 'Getafe CF', shortName: 'GET', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/82.png' },
  { id: 'club-girona', name: 'Girona FC', shortName: 'GIR', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/298.png' },
  { id: 'club-las-palmas', name: 'UD Las Palmas', shortName: 'LPA', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/275.png' },
  { id: 'club-malaga', name: 'Málaga CF', shortName: 'MCF', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/84.png' },
  { id: 'club-mallorca', name: 'RCD Mallorca', shortName: 'MLL', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/89.png' },
  { id: 'club-osasuna', name: 'CA Osasuna', shortName: 'OSA', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/79.png' },
  { id: 'club-racing-santander', name: 'Racing Santander', shortName: 'RAC', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/742.png' },
  { id: 'club-rayo-vallecano', name: 'Rayo Vallecano', shortName: 'RAY', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/87.png' },
  { id: 'club-real-betis', name: 'Real Betis', shortName: 'BET', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/90.png' },
  { id: 'club-real-madrid', name: 'Real Madrid', shortName: 'RMA', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/86.png' },
  { id: 'club-real-sociedad', name: 'Real Sociedad', shortName: 'RSO', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/92.png' },
  { id: 'club-sevilla', name: 'Sevilla FC', shortName: 'SEV', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/559.png' },
  { id: 'club-valencia', name: 'Valencia CF', shortName: 'VAL', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/95.png' },
  { id: 'club-villarreal', name: 'Villarreal CF', shortName: 'VIL', country: 'Spain', leagueId: 'league-la-liga', logoUrl: 'https://crests.football-data.org/94.png' },

  // --- SERIE A (20 CLUBS - 2026/27) ---
  { id: 'club-atalanta', name: 'Atalanta', shortName: 'ATA', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/102.png' },
  { id: 'club-bologna', name: 'Bologna FC', shortName: 'BOL', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/103.png' },
  { id: 'club-cagliari', name: 'Cagliari Calcio', shortName: 'CAG', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/104.png' },
  { id: 'club-empoli', name: 'Empoli FC', shortName: 'EMP', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/445.png' },
  { id: 'club-fiorentina', name: 'ACF Fiorentina', shortName: 'FIO', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/99.png' },
  { id: 'club-frosinone', name: 'Frosinone', shortName: 'FRO', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/470.png' },
  { id: 'club-genoa', name: 'Genoa CFC', shortName: 'GEN', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/107.png' },
  { id: 'club-inter', name: 'Inter Milan', shortName: 'INT', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/108.png' },
  { id: 'club-juventus', name: 'Juventus', shortName: 'JUV', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/109.png' },
  { id: 'club-lazio', name: 'SS Lazio', shortName: 'LAZ', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/110.png' },
  { id: 'club-lecce', name: 'US Lecce', shortName: 'LEC', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/5890.png' },
  { id: 'club-milan', name: 'AC Milan', shortName: 'MIL', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/98.png' },
  { id: 'club-monza', name: 'Monza', shortName: 'MON', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/5911.png' },
  { id: 'club-napoli', name: 'SSC Napoli', shortName: 'NAP', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/113.png' },
  { id: 'club-parma', name: 'Parma Calcio', shortName: 'PAR', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/112.png' },
  { id: 'club-roma', name: 'AS Roma', shortName: 'ROM', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/100.png' },
  { id: 'club-torino', name: 'Torino FC', shortName: 'TOR', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/586.png' },
  { id: 'club-udinese', name: 'Udinese Calcio', shortName: 'UDI', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/115.png' },
  { id: 'club-venezia', name: 'Venezia', shortName: 'VEN', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/454.png' },
  { id: 'club-verona', name: 'Hellas Verona', shortName: 'VER', country: 'Italy', leagueId: 'league-serie-a', logoUrl: 'https://crests.football-data.org/450.png' },

  // --- BUNDESLIGA (18 CLUBS - 2026/27) ---
  { id: 'club-augsburg', name: 'FC Augsburg', shortName: 'FCA', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/16.png' },
  { id: 'club-bayern', name: 'FC Bayern München', shortName: 'FCB', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/5.png' },
  { id: 'club-bochum', name: 'VfL Bochum', shortName: 'BOC', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/36.png' },
  { id: 'club-dortmund', name: 'Borussia Dortmund', shortName: 'BVB', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/4.png' },
  { id: 'club-eintracht-frankfurt', name: 'Eintracht Frankfurt', shortName: 'SGE', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/19.png' },
  { id: 'club-freiburg', name: 'SC Freiburg', shortName: 'SCF', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/17.png' },
  { id: 'club-gladbach', name: 'Borussia Mönchengladbach', shortName: 'BMG', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/18.png' },
  { id: 'club-heidenheim', name: '1. FC Heidenheim', shortName: 'HDH', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/44.png' },
  { id: 'club-hoffenheim', name: 'TSG Hoffenheim', shortName: 'TSG', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/2.png' },
  { id: 'club-holstein-kiel', name: 'Holstein Kiel', shortName: 'KSV', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/720.png' },
  { id: 'club-leipzig', name: 'RB Leipzig', shortName: 'RBL', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/721.png' },
  { id: 'club-leverkusen', name: 'Bayer 04 Leverkusen', shortName: 'B04', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/3.png' },
  { id: 'club-mainz', name: '1. FSV Mainz 05', shortName: 'M05', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/15.png' },
  { id: 'club-st-pauli', name: 'FC St. Pauli', shortName: 'STP', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/37.png' },
  { id: 'club-stuttgart', name: 'VfB Stuttgart', shortName: 'VFB', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/10.png' },
  { id: 'club-union-berlin', name: '1. FC Union Berlin', shortName: 'FCU', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/28.png' },
  { id: 'club-werder-bremen', name: 'SV Werder Bremen', shortName: 'SVW', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/12.png' },
  { id: 'club-wolfsburg', name: 'VfL Wolfsburg', shortName: 'WOB', country: 'Germany', leagueId: 'league-bundesliga', logoUrl: 'https://crests.football-data.org/11.png' },

  // --- LIGUE 1 (18 CLUBS - 2026/27) ---
  { id: 'club-auxerre', name: 'AJ Auxerre', shortName: 'AJA', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/519.png' },
  { id: 'club-brest', name: 'Stade Brestois 29', shortName: 'SB29', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/512.png' },
  { id: 'club-le-mans', name: 'Le Mans FC', shortName: 'LMFC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/540.png' },
  { id: 'club-lens', name: 'RC Lens', shortName: 'RCL', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/546.png' },
  { id: 'club-lille', name: 'LOSC Lille', shortName: 'LOSC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/521.png' },
  { id: 'club-lyon', name: 'Olympique Lyonnais', shortName: 'OL', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/523.png' },
  { id: 'club-marseille', name: 'Olympique de Marseille', shortName: 'OM', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/516.png' },
  { id: 'club-monaco', name: 'AS Monaco', shortName: 'ASM', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/548.png' },
  { id: 'club-montpellier', name: 'Montpellier HSC', shortName: 'MHSC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/518.png' },
  { id: 'club-nantes', name: 'FC Nantes', shortName: 'FCN', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/543.png' },
  { id: 'club-nice', name: 'OGC Nice', shortName: 'OGCN', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/522.png' },
  { id: 'club-paris-fc', name: 'Paris FC', shortName: 'PFC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/533.png' },
  { id: 'club-psg', name: 'Paris Saint-Germain', shortName: 'PSG', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/524.png' },
  { id: 'club-reims', name: 'Stade de Reims', shortName: 'SDR', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/547.png' },
  { id: 'club-rennes', name: 'Stade Rennais FC', shortName: 'SRFC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/529.png' },
  { id: 'club-strasbourg', name: 'RC Strasbourg Alsace', shortName: 'RCSA', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/576.png' },
  { id: 'club-toulouse', name: 'Toulouse FC', shortName: 'TFC', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/511.png' },
  { id: 'club-troyes', name: 'ESTAC Troyes', shortName: 'TRO', country: 'France', leagueId: 'league-ligue-1', logoUrl: 'https://crests.football-data.org/531.png' },
];

export const SEED_COMPETITIONS: SeedCompetition[] = [
  // --- DOMESTIC LEAGUES ---
  {
    id: 'comp-premier-league-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'Premier League',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 5 },
  },
  {
    id: 'comp-la-liga-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'La Liga',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'headToHead', 'goalDifference', 'goalsFor'], qualificationSpots: 5 },
  },
  {
    id: 'comp-serie-a-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Serie A',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'headToHead', 'goalDifference', 'goalsFor'], qualificationSpots: 5 },
  },
  {
    id: 'comp-bundesliga-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'Bundesliga',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 34, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 5 },
  },
  {
    id: 'comp-ligue-1-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-ligue-1',
    name: 'Ligue 1',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 34, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 4 },
  },

  // --- NATIONAL CUPS ---
  {
    id: 'comp-fa-cup-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'FA Cup',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-efl-cup-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'EFL Cup',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-copa-del-rey-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'Copa del Rey',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-coppa-italia-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Coppa Italia',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-dfb-pokal-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'DFB-Pokal',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-coupe-de-france-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-ligue-1',
    name: 'Coupe de France',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },

  // --- SUPER CUPS ---
  {
    id: 'comp-community-shield-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'FA Community Shield',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true, penalties: true },
  },
  {
    id: 'comp-supercopa-espana-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'Supercopa de España',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 4, format: 'final_four' },
  },
  {
    id: 'comp-supercoppa-italiana-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Supercoppa Italiana',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 4, format: 'final_four' },
  },
  {
    id: 'comp-dfl-supercup-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'DFL-Supercup',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true },
  },

  // --- EUROPEAN COMPETITIONS ---
  {
    id: 'comp-champions-league-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Champions League',
    type: 'EUROPEAN_LEAGUE_PHASE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { leaguePhaseTeams: 24, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 },
  },
  {
    id: 'comp-europa-league-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Europa League',
    type: 'EUROPEAN_LEAGUE_PHASE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { leaguePhaseTeams: 36, matchesPerTeam: 8, knockoutTeams: 16 },
  },
  {
    id: 'comp-conference-league-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Conference League',
    type: 'EUROPEAN_LEAGUE_PHASE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { leaguePhaseTeams: 36, matchesPerTeam: 6, knockoutTeams: 16 },
  },
  {
    id: 'comp-uefa-super-cup-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Super Cup',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true },
  },
];

export function seedDatabase(): {
  seasonsCreated: number;
  leaguesCreated: number;
  clubsCreated: number;
  competitionsCreated: number;
  skipped: number;
} {
  return dbTransaction(() => {
    let seasonsCreated = 0;
    let leaguesCreated = 0;
    let clubsCreated = 0;
    let competitionsCreated = 0;
    let skipped = 0;

    const now = new Date().toISOString();

    // 1. Season
    const existingSeason = queryGet('SELECT id FROM seasons WHERE id = ?', [SEED_SEASON.id]);
    if (!existingSeason) {
      queryRun(
        'INSERT INTO seasons (id, name, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [SEED_SEASON.id, SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, now]
      );
      seasonsCreated++;
    } else {
      queryRun(
        'UPDATE seasons SET name = ?, status = ?, start_date = ?, end_date = ? WHERE id = ?',
        [SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, SEED_SEASON.id]
      );
    }

    // 2. Leagues
    for (const league of SEED_LEAGUES) {
      const existingLeague = queryGet('SELECT id FROM leagues WHERE id = ?', [league.id]);
      if (!existingLeague) {
        queryRun(
          'INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [league.id, league.name, league.country, league.tier, league.logoUrl, now]
        );
        leaguesCreated++;
      } else {
        skipped++;
      }
    }

    // 3. Clubs
    const activeClubIds = new Set(SEED_CLUBS.map((c) => c.id));
    for (const club of SEED_CLUBS) {
      const existingClub = queryGet('SELECT id FROM clubs WHERE id = ?', [club.id]);
      if (!existingClub) {
        queryRun(
          'INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          [club.id, club.name, club.shortName, club.country, club.leagueId, club.logoUrl, now]
        );
        clubsCreated++;
      } else {
        queryRun(
          'UPDATE clubs SET name = ?, short_name = ?, country = ?, league_id = ?, logo_url = ?, active = 1 WHERE id = ?',
          [club.name, club.shortName, club.country, club.leagueId, club.logoUrl, club.id]
        );
      }

      // Ensure membership in season_league_clubs for 2026/27
      const slcId = `slc-${SEED_SEASON.id}-${club.id}`;
      queryRun(
        `INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(season_id, club_id) DO UPDATE SET league_id = excluded.league_id, is_active = 1`,
        [slcId, SEED_SEASON.id, club.leagueId, club.id, now]
      );
    }

    // Deactivate any clubs not in the 2026/27 top flights
    const allDbClubs = queryAll<{ id: string }>('SELECT id FROM clubs');
    for (const c of allDbClubs) {
      if (!activeClubIds.has(c.id)) {
        queryRun('UPDATE clubs SET active = 0 WHERE id = ?', [c.id]);
        queryRun(
          'UPDATE season_league_clubs SET is_active = 0 WHERE club_id = ? AND season_id = ?',
          [c.id, SEED_SEASON.id]
        );
        // Remove from 2026/27 competition participants
        queryRun(
          'DELETE FROM competition_participants WHERE club_id = ? AND season_id = ?',
          [c.id, SEED_SEASON.id]
        );
      }
    }

    // 4. Competitions
    for (const comp of SEED_COMPETITIONS) {
      const existingComp = queryGet<{ id: string }>('SELECT id FROM competitions WHERE id = ?', [comp.id]);
      if (!existingComp) {
        queryRun(
          'INSERT INTO competitions (id, season_id, league_id, name, type, schedule_mode, status, format_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, "upcoming", ?, ?)',
          [
            comp.id,
            comp.seasonId,
            comp.leagueId || null,
            comp.name,
            comp.type,
            comp.scheduleMode,
            JSON.stringify(comp.formatConfig),
            now,
          ]
        );
        competitionsCreated++;
      } else {
        queryRun(
          'UPDATE competitions SET schedule_mode = ?, format_config_json = ? WHERE id = ?',
          [comp.scheduleMode, JSON.stringify(comp.formatConfig), comp.id]
        );
        skipped++;
      }

      // Sync active participants for leagues and domestic cups
      if ((comp.type === 'LEAGUE' || comp.type === 'KNOCKOUT') && comp.leagueId) {
        // Clean out any stale participants not belonging to the active league
        queryRun(
          `DELETE FROM competition_participants 
           WHERE competition_id = ? AND club_id NOT IN (
             SELECT club_id FROM season_league_clubs WHERE league_id = ? AND season_id = ? AND is_active = 1
           )`,
          [comp.id, comp.leagueId, comp.seasonId]
        );

        const leagueClubs = queryAll<{ club_id: string }>(
          `SELECT slc.club_id 
           FROM season_league_clubs slc 
           JOIN clubs c ON slc.club_id = c.id
           WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
           ORDER BY c.name ASC`,
          [comp.leagueId, comp.seasonId]
        );

        for (let i = 0; i < leagueClubs.length; i++) {
          const clubId = leagueClubs[i].club_id;
          const partId = `part-${comp.id}-${clubId}`;
          queryRun(
            `INSERT INTO competition_participants (id, competition_id, club_id, season_id, seed_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(competition_id, club_id) DO UPDATE SET seed_number = excluded.seed_number`,
            [partId, comp.id, clubId, comp.seasonId, i + 1, now]
          );
        }
      }
    }

    console.log(
      ` [SEED] Done: Created ${seasonsCreated} season, ${leaguesCreated} leagues, ${clubsCreated} clubs, ${competitionsCreated} competitions. Skipped ${skipped} existing records.`
    );

    return { seasonsCreated, leaguesCreated, clubsCreated, competitionsCreated, skipped };
  });
}

/**
 * Authoritative 2026/27 Roster Safe Repair Migration
 *
 * It must:
 * 1. Load authoritative 2026/27 roster.
 * 2. Set all existing season-2026-27 season_league_clubs records to inactive / synchronize with active roster.
 * 3. Insert/activate ONLY the correct 2026/27 clubs.
 * 4. Preserve the global clubs table.
 * 5. Preserve users.
 * 6. Preserve Telegram accounts.
 * 7. Preserve historical seasons.
 * 8. Preserve historical ownership.
 * 9. Preserve audit logs.
 */
export function repairSeason202627Roster(): {
  activatedClubs: number;
  deactivatedClubs: number;
  totalActive: number;
} {
  return dbTransaction(() => {
    const seasonId = 'season-2026-27';
    const now = new Date().toISOString();
    const activeClubIds = new Set(SEED_CLUBS.map((c) => c.id));

    // 0. Ensure domestic leagues have official metadata and working crests
    for (const league of SEED_LEAGUES) {
      const existing = queryGet('SELECT id FROM leagues WHERE id = ?', [league.id]);
      if (!existing) {
        queryRun(
          'INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [league.id, league.name, league.country, league.tier, league.logoUrl, now]
        );
      } else {
        queryRun(
          'UPDATE leagues SET name = ?, country = ?, tier = ?, logo_url = ? WHERE id = ?',
          [league.name, league.country, league.tier, league.logoUrl, league.id]
        );
      }
    }

    // 1. Ensure all 2026/27 clubs exist in global clubs table and are active = 1
    let activatedClubs = 0;
    for (const club of SEED_CLUBS) {
      const existing = queryGet('SELECT id FROM clubs WHERE id = ?', [club.id]);
      if (!existing) {
        queryRun(
          'INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          [club.id, club.name, club.shortName, club.country, club.leagueId, club.logoUrl, now]
        );
      } else {
        queryRun(
          'UPDATE clubs SET name = ?, short_name = ?, country = ?, league_id = ?, logo_url = ?, active = 1 WHERE id = ?',
          [club.name, club.shortName, club.country, club.leagueId, club.logoUrl, club.id]
        );
      }

      // 2. Set active in season_league_clubs for 2026/27
      const slcId = `slc-${seasonId}-${club.id}`;
      queryRun(
        `INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(season_id, club_id) DO UPDATE SET league_id = excluded.league_id, is_active = 1`,
        [slcId, seasonId, club.leagueId, club.id, now]
      );
      activatedClubs++;
    }

    // 3. Mark non-2026/27 clubs as inactive in season-2026-27 (DO NOT delete global club entities)
    let deactivatedClubs = 0;
    const allDbClubs = queryAll<{ id: string }>('SELECT id FROM clubs');
    for (const c of allDbClubs) {
      if (!activeClubIds.has(c.id)) {
        queryRun('UPDATE clubs SET active = 0 WHERE id = ?', [c.id]);
        queryRun(
          'UPDATE season_league_clubs SET is_active = 0 WHERE club_id = ? AND season_id = ?',
          [c.id, seasonId]
        );
        queryRun(
          'DELETE FROM competition_participants WHERE club_id = ? AND season_id = ?',
          [c.id, seasonId]
        );
        deactivatedClubs++;
      }
    }

    // 4. Clean and synchronize competition_participants for domestic leagues and cups
    for (const comp of SEED_COMPETITIONS) {
      if ((comp.type === 'LEAGUE' || comp.type === 'KNOCKOUT') && comp.leagueId) {
        queryRun(
          `DELETE FROM competition_participants 
           WHERE competition_id = ? AND club_id NOT IN (
             SELECT club_id FROM season_league_clubs WHERE league_id = ? AND season_id = ? AND is_active = 1
           )`,
          [comp.id, comp.leagueId, comp.seasonId]
        );

        const leagueClubs = queryAll<{ club_id: string }>(
          `SELECT slc.club_id 
           FROM season_league_clubs slc 
           JOIN clubs c ON slc.club_id = c.id
           WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
           ORDER BY c.name ASC`,
          [comp.leagueId, comp.seasonId]
        );

        for (let i = 0; i < leagueClubs.length; i++) {
          const clubId = leagueClubs[i].club_id;
          const partId = `part-${comp.id}-${clubId}`;
          queryRun(
            `INSERT INTO competition_participants (id, competition_id, club_id, season_id, seed_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(competition_id, club_id) DO UPDATE SET seed_number = excluded.seed_number`,
            [partId, comp.id, clubId, comp.seasonId, i + 1, now]
          );
        }
      }
    }

    // 5. Clean up any invalid fixtures containing inactive clubs for season-2026-27
    const invalidFixtures = queryAll<{ id: string; competition_id: string }>(
      `SELECT id, competition_id FROM fixtures 
       WHERE season_id = ? AND (
         home_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
         OR away_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
       )`,
      [seasonId, seasonId, seasonId]
    );

    if (invalidFixtures.length > 0) {
      console.log(` [REPAIR] Found ${invalidFixtures.length} invalid fixtures with inactive clubs. Purging and regenerating domestic schedules...`);
      const compsToReset = new Set(invalidFixtures.map((f) => f.competition_id));
      for (const compId of compsToReset) {
        queryRun('DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)', [compId]);
        queryRun('DELETE FROM fixtures WHERE competition_id = ?', [compId]);
      }
    }

    // 6. Explicitly remove obsolete/unsupported competitions (e.g., Trophee des Champions)
    const validCompIds = new Set(SEED_COMPETITIONS.map((c) => c.id));
    const allDbComps = queryAll<{ id: string }>('SELECT id FROM competitions WHERE season_id = ?', [seasonId]);
    for (const dbComp of allDbComps) {
      if (!validCompIds.has(dbComp.id)) {
        console.log(` [REPAIR] Purging obsolete competition: ${dbComp.id}`);
        queryRun('DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)', [dbComp.id]);
        queryRun('DELETE FROM fixtures WHERE competition_id = ?', [dbComp.id]);
        queryRun('DELETE FROM competition_participants WHERE competition_id = ?', [dbComp.id]);
        queryRun('DELETE FROM competitions WHERE id = ?', [dbComp.id]);
      }
    }

    console.log(
      ` [REPAIR] 2026/27 Roster repaired: ${activatedClubs} clubs activated, ${deactivatedClubs} stale clubs deactivated.`
    );
    return { activatedClubs, deactivatedClubs, totalActive: activatedClubs };
  });
}
