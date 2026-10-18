/** Canonical home venues for the existing EFL roster. Reviewed 2026-10-18.
 * Sources: Premier League stadium guide; LaLiga club profiles; Bundesliga stadium guide;
 * Lega Serie A club/stadium directory; official club and stadium sites.
 * https://www.premierleague.com/en/news/4725666
 * https://www.bundesliga.com/pt/bundesliga/clubes
 * https://www.laliga.com/en-GB/laliga-easports/clubs
 * https://en.legaseriea.it/team
 * https://www.fcbarcelona.com/en/football/first-team/schedule
 * https://parisfc.fr/en/practical-information/
 * https://en.realbetisbalompie.es/club/la-cartuja
 * Fixture-specific venue overrides take priority (e.g. neutral cup finals).
 */
export const CLUB_STADIUMS: Record<string, string> = {
  'club-arsenal': 'Emirates Stadium', 'club-aston-villa': 'Villa Park',
  'club-bournemouth': 'Vitality Stadium', 'club-brentford': 'Gtech Community Stadium',
  'club-brighton': 'American Express Stadium', 'club-chelsea': 'Stamford Bridge',
  'club-coventry': 'Coventry Building Society Arena', 'club-crystal-palace': 'Selhurst Park',
  'club-everton': 'Hill Dickinson Stadium', 'club-fulham': 'Craven Cottage',
  'club-hull': 'MKM Stadium', 'club-ipswich': 'Portman Road', 'club-leeds': 'Elland Road',
  'club-liverpool': 'Anfield', 'club-man-city': 'Etihad Stadium', 'club-man-utd': 'Old Trafford',
  'club-newcastle': "St James' Park", 'club-nottm-forest': 'The City Ground',
  'club-sunderland': 'Stadium of Light', 'club-tottenham': 'Tottenham Hotspur Stadium',
  'club-alaves': 'Mendizorrotza', 'club-athletic-club': 'San Mamés',
  'club-atletico-madrid': 'Riyadh Air Metropolitano', 'club-barcelona': 'Spotify Camp Nou',
  'club-celta-vigo': 'ABANCA Balaídos', 'club-deportivo-la-coruna': 'ABANCA-RIAZOR',
  'club-getafe': 'Coliseum', 'club-girona': 'Estadi Montilivi',
  'club-las-palmas': 'Estadio de Gran Canaria', 'club-malaga': 'La Rosaleda',
  'club-mallorca': 'Estadi Mallorca Son Moix', 'club-osasuna': 'El Sadar',
  'club-racing-santander': 'El Sardinero', 'club-rayo-vallecano': 'Estadio de Vallecas',
  'club-real-betis': 'Estadio La Cartuja', 'club-real-madrid': 'Santiago Bernabéu',
  'club-real-sociedad': 'Reale Arena', 'club-sevilla': 'Ramón Sánchez-Pizjuán',
  'club-valencia': 'Mestalla', 'club-villarreal': 'Estadio de la Cerámica',
  'club-atalanta': 'New Balance Arena', 'club-bologna': "Stadio Renato Dall'Ara",
  'club-cagliari': 'Unipol Domus', 'club-empoli': 'Stadio Carlo Castellani',
  'club-fiorentina': 'Stadio Artemio Franchi', 'club-frosinone': 'Stadio Benito Stirpe',
  'club-genoa': 'Stadio Luigi Ferraris', 'club-inter': 'Stadio Giuseppe Meazza',
  'club-juventus': 'Allianz Stadium', 'club-lazio': 'Stadio Olimpico',
  'club-lecce': 'Stadio Ettore Giardiniero – Via del Mare', 'club-milan': 'Stadio Giuseppe Meazza',
  'club-monza': 'U-Power Stadium', 'club-napoli': 'Stadio Diego Armando Maradona',
  'club-parma': 'Stadio Ennio Tardini', 'club-roma': 'Stadio Olimpico',
  'club-torino': 'Stadio Olimpico Grande Torino', 'club-udinese': 'Bluenergy Stadium',
  'club-venezia': 'Stadio Pier Luigi Penzo', 'club-verona': 'Stadio Marcantonio Bentegodi',
  'club-augsburg': 'WWK Arena', 'club-bayern': 'Allianz Arena',
  'club-bochum': 'Vonovia Ruhrstadion', 'club-dortmund': 'Signal Iduna Park',
  'club-eintracht-frankfurt': 'Deutsche Bank Park', 'club-freiburg': 'Europa-Park Stadion',
  'club-gladbach': 'ista-Borussia-Park', 'club-heidenheim': 'Voith-Arena',
  'club-hoffenheim': 'SNP Arena', 'club-holstein-kiel': 'Holstein-Stadion',
  'club-leipzig': 'Red Bull Arena', 'club-leverkusen': 'BayArena', 'club-mainz': 'MEWA Arena',
  'club-st-pauli': 'Millerntor-Stadion', 'club-stuttgart': 'MHPArena',
  'club-union-berlin': 'Stadion An der Alten Försterei', 'club-werder-bremen': 'Weserstadion',
  'club-wolfsburg': 'Volkswagen Arena',
  'club-auxerre': "Stade de l'Abbé-Deschamps", 'club-brest': 'Stade Francis-Le Blé',
  'club-le-mans': 'Stade Marie-Marvingt', 'club-lens': 'Stade Bollaert-Delelis',
  'club-lille': 'Stade Pierre-Mauroy', 'club-lyon': 'Groupama Stadium',
  'club-marseille': 'Orange Vélodrome', 'club-monaco': 'Stade Louis-II',
  'club-montpellier': 'Stade de la Mosson', 'club-nantes': 'Stade de la Beaujoire',
  'club-nice': 'Allianz Riviera', 'club-paris-fc': 'Stade Jean-Bouin',
  'club-psg': 'Parc des Princes', 'club-reims': 'Stade Auguste-Delaune',
  'club-rennes': 'Roazhon Park', 'club-strasbourg': 'Stade de la Meinau',
  'club-toulouse': 'Stadium de Toulouse', 'club-troyes': "Stade de l'Aube",
};

export function clubStadium(clubId?: string | null, supplied?: string | null): string {
  const value = supplied?.trim();
  if (value && !/^(home ground|home stadium|official stadium)$/i.test(value)) return value;
  return clubId ? CLUB_STADIUMS[clubId] || '' : '';
}
