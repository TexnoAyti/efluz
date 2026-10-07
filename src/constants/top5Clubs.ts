export interface Top5League {
  id: string;
  name: string;
  country: string;
  tier: number;
  logoUrl: string;
}

export interface Top5Club {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string;
  logoUrl: string;
}

export const TOP5_LEAGUES: Top5League[] = [
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

export const TOP5_CLUBS: Top5Club[] = [
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
