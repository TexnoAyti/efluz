/** Verified current real-world club membership, isolated from the running EFL season. */
export interface PreparedClubRoster {
  realSeason: string;
  verifiedAt: string;
  expectedClubCount: number;
  sources: ReadonlyArray<{ url: string; publisher: string }>;
  clubs: ReadonlyArray<{ id: string; name: string }>;
}
export const SEASON_TWO_ROSTERS: Readonly<Record<string, PreparedClubRoster>> = {
  "league-premier-league": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 20,
    "sources": [
      {
        "url": "https://www.premierleague.com/en/news/4365156",
        "publisher": "Premier League"
      }
    ],
    "clubs": [
      {
        "id": "club-arsenal",
        "name": "Arsenal"
      },
      {
        "id": "club-aston-villa",
        "name": "Aston Villa"
      },
      {
        "id": "club-bournemouth",
        "name": "AFC Bournemouth"
      },
      {
        "id": "club-brentford",
        "name": "Brentford"
      },
      {
        "id": "club-brighton",
        "name": "Brighton & Hove Albion"
      },
      {
        "id": "club-chelsea",
        "name": "Chelsea"
      },
      {
        "id": "club-coventry",
        "name": "Coventry City"
      },
      {
        "id": "club-crystal-palace",
        "name": "Crystal Palace"
      },
      {
        "id": "club-everton",
        "name": "Everton"
      },
      {
        "id": "club-fulham",
        "name": "Fulham"
      },
      {
        "id": "club-hull",
        "name": "Hull City"
      },
      {
        "id": "club-ipswich",
        "name": "Ipswich Town"
      },
      {
        "id": "club-leeds",
        "name": "Leeds United"
      },
      {
        "id": "club-liverpool",
        "name": "Liverpool"
      },
      {
        "id": "club-man-city",
        "name": "Manchester City"
      },
      {
        "id": "club-man-utd",
        "name": "Manchester United"
      },
      {
        "id": "club-newcastle",
        "name": "Newcastle United"
      },
      {
        "id": "club-nottm-forest",
        "name": "Nottingham Forest"
      },
      {
        "id": "club-sunderland",
        "name": "Sunderland"
      },
      {
        "id": "club-tottenham",
        "name": "Tottenham Hotspur"
      }
    ]
  },
  "league-la-liga": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 20,
    "sources": [
      {
        "url": "https://www.laliga.com/en-US/laliga-easports/standing",
        "publisher": "LALIGA"
      }
    ],
    "clubs": [
      {
        "id": "club-alaves",
        "name": "Deportivo Alavés"
      },
      {
        "id": "club-athletic-club",
        "name": "Athletic Club"
      },
      {
        "id": "club-atletico-madrid",
        "name": "Atlético de Madrid"
      },
      {
        "id": "club-barcelona",
        "name": "FC Barcelona"
      },
      {
        "id": "club-celta-vigo",
        "name": "RC Celta"
      },
      {
        "id": "club-deportivo-la-coruna",
        "name": "RC Deportivo"
      },
      {
        "id": "club-elche",
        "name": "Elche CF"
      },
      {
        "id": "club-espanyol",
        "name": "RCD Espanyol"
      },
      {
        "id": "club-getafe",
        "name": "Getafe CF"
      },
      {
        "id": "club-levante",
        "name": "Levante UD"
      },
      {
        "id": "club-malaga",
        "name": "Málaga CF"
      },
      {
        "id": "club-osasuna",
        "name": "CA Osasuna"
      },
      {
        "id": "club-racing-santander",
        "name": "Racing Santander"
      },
      {
        "id": "club-rayo-vallecano",
        "name": "Rayo Vallecano"
      },
      {
        "id": "club-real-betis",
        "name": "Real Betis"
      },
      {
        "id": "club-real-madrid",
        "name": "Real Madrid"
      },
      {
        "id": "club-real-sociedad",
        "name": "Real Sociedad"
      },
      {
        "id": "club-sevilla",
        "name": "Sevilla FC"
      },
      {
        "id": "club-valencia",
        "name": "Valencia CF"
      },
      {
        "id": "club-villarreal",
        "name": "Villarreal CF"
      }
    ]
  },
  "league-serie-a": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 20,
    "sources": [
      {
        "url": "https://www.legaseriea.it/serie-a/classifica?lang=en",
        "publisher": "Lega Serie A"
      }
    ],
    "clubs": [
      {
        "id": "club-atalanta",
        "name": "Atalanta"
      },
      {
        "id": "club-bologna",
        "name": "Bologna"
      },
      {
        "id": "club-cagliari",
        "name": "Cagliari"
      },
      {
        "id": "club-como",
        "name": "Como"
      },
      {
        "id": "club-fiorentina",
        "name": "Fiorentina"
      },
      {
        "id": "club-frosinone",
        "name": "Frosinone"
      },
      {
        "id": "club-genoa",
        "name": "Genoa"
      },
      {
        "id": "club-inter",
        "name": "Inter"
      },
      {
        "id": "club-juventus",
        "name": "Juventus"
      },
      {
        "id": "club-lazio",
        "name": "Lazio"
      },
      {
        "id": "club-lecce",
        "name": "Lecce"
      },
      {
        "id": "club-milan",
        "name": "Milan"
      },
      {
        "id": "club-monza",
        "name": "Monza"
      },
      {
        "id": "club-napoli",
        "name": "Napoli"
      },
      {
        "id": "club-parma",
        "name": "Parma"
      },
      {
        "id": "club-roma",
        "name": "Roma"
      },
      {
        "id": "club-sassuolo",
        "name": "Sassuolo"
      },
      {
        "id": "club-torino",
        "name": "Torino"
      },
      {
        "id": "club-udinese",
        "name": "Udinese"
      },
      {
        "id": "club-venezia",
        "name": "Venezia"
      }
    ]
  },
  "league-bundesliga": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 18,
    "sources": [
      {
        "url": "https://www.bundesliga.com/en/bundesliga/table",
        "publisher": "Bundesliga"
      }
    ],
    "clubs": [
      {
        "id": "club-augsburg",
        "name": "FC Augsburg"
      },
      {
        "id": "club-bayern",
        "name": "FC Bayern München"
      },
      {
        "id": "club-dortmund",
        "name": "Borussia Dortmund"
      },
      {
        "id": "club-eintracht-frankfurt",
        "name": "Eintracht Frankfurt"
      },
      {
        "id": "club-elversberg",
        "name": "SV Elversberg"
      },
      {
        "id": "club-freiburg",
        "name": "SC Freiburg"
      },
      {
        "id": "club-gladbach",
        "name": "Borussia Mönchengladbach"
      },
      {
        "id": "club-hamburger-sv",
        "name": "Hamburger SV"
      },
      {
        "id": "club-hoffenheim",
        "name": "TSG Hoffenheim"
      },
      {
        "id": "club-koln",
        "name": "1. FC Köln"
      },
      {
        "id": "club-leipzig",
        "name": "RB Leipzig"
      },
      {
        "id": "club-leverkusen",
        "name": "Bayer 04 Leverkusen"
      },
      {
        "id": "club-mainz",
        "name": "1. FSV Mainz 05"
      },
      {
        "id": "club-paderborn",
        "name": "SC Paderborn 07"
      },
      {
        "id": "club-schalke",
        "name": "FC Schalke 04"
      },
      {
        "id": "club-stuttgart",
        "name": "VfB Stuttgart"
      },
      {
        "id": "club-union-berlin",
        "name": "1. FC Union Berlin"
      },
      {
        "id": "club-werder-bremen",
        "name": "SV Werder Bremen"
      }
    ]
  },
  "league-ligue-1": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 18,
    "sources": [
      {
        "url": "https://www.psg.fr/en/mens-football/standings/season/2026-2027?competition=Ligue_1",
        "publisher": "Paris Saint-Germain (official club standings)"
      }
    ],
    "clubs": [
      {
        "id": "club-angers",
        "name": "Angers SCO"
      },
      {
        "id": "club-auxerre",
        "name": "AJ Auxerre"
      },
      {
        "id": "club-brest",
        "name": "Stade Brestois 29"
      },
      {
        "id": "club-le-havre",
        "name": "Le Havre AC"
      },
      {
        "id": "club-le-mans",
        "name": "Le Mans FC"
      },
      {
        "id": "club-lens",
        "name": "RC Lens"
      },
      {
        "id": "club-lille",
        "name": "LOSC Lille"
      },
      {
        "id": "club-lorient",
        "name": "FC Lorient"
      },
      {
        "id": "club-lyon",
        "name": "Olympique Lyonnais"
      },
      {
        "id": "club-marseille",
        "name": "Olympique de Marseille"
      },
      {
        "id": "club-monaco",
        "name": "AS Monaco"
      },
      {
        "id": "club-nice",
        "name": "OGC Nice"
      },
      {
        "id": "club-paris-fc",
        "name": "Paris FC"
      },
      {
        "id": "club-psg",
        "name": "Paris Saint-Germain"
      },
      {
        "id": "club-rennes",
        "name": "Stade Rennais FC"
      },
      {
        "id": "club-strasbourg",
        "name": "RC Strasbourg Alsace"
      },
      {
        "id": "club-toulouse",
        "name": "Toulouse FC"
      },
      {
        "id": "club-troyes",
        "name": "ESTAC Troyes"
      }
    ]
  },
  "league-uzbekistan-superliga": {
    "realSeason": "2026",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 16,
    "sources": [
      {
        "url": "https://fcneftchi.uz/uz/matches/standings",
        "publisher": "PFK Neftchi (official club standings)"
      }
    ],
    "clubs": [
      {
        "id": "club-andijon",
        "name": "Andijon"
      },
      {
        "id": "club-bunyodkor",
        "name": "Bunyodkor"
      },
      {
        "id": "club-buxoro",
        "name": "Buxoro"
      },
      {
        "id": "club-dinamo-samarqand",
        "name": "Dinamo Samarqand"
      },
      {
        "id": "club-lokomotiv-tashkent",
        "name": "Lokomotiv Toshkent"
      },
      {
        "id": "club-mashal",
        "name": "Mash’al"
      },
      {
        "id": "club-nasaf",
        "name": "Nasaf"
      },
      {
        "id": "club-navbahor",
        "name": "Navbahor"
      },
      {
        "id": "club-neftchi",
        "name": "Neftchi"
      },
      {
        "id": "club-okmk",
        "name": "OKMK"
      },
      {
        "id": "club-paxtakor",
        "name": "Paxtakor"
      },
      {
        "id": "club-qizilqum",
        "name": "Qizilqum"
      },
      {
        "id": "club-qoqon-1912",
        "name": "Qo‘qon-1912"
      },
      {
        "id": "club-sogdiyona",
        "name": "So‘g‘diyona"
      },
      {
        "id": "club-surxon",
        "name": "Surxon"
      },
      {
        "id": "club-xorazm",
        "name": "Xorazm"
      }
    ]
  },
  "league-saudi-pro-league": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 18,
    "sources": [
      {
        "url": "https://www.spl.com.sa/en/news/spl-announces-2026-27-rsl-fixture-schedule",
        "publisher": "Saudi Pro League"
      }
    ],
    "clubs": [
      {
        "id": "club-abha",
        "name": "Abha"
      },
      {
        "id": "club-al-ahli",
        "name": "Al Ahli"
      },
      {
        "id": "club-al-ettifaq",
        "name": "Al Ettifaq"
      },
      {
        "id": "club-al-faisaly",
        "name": "Al Faisaly"
      },
      {
        "id": "club-al-fateh",
        "name": "Al Fateh"
      },
      {
        "id": "club-al-fayha",
        "name": "Al Fayha"
      },
      {
        "id": "club-al-hazem",
        "name": "Al Hazem"
      },
      {
        "id": "club-al-hilal",
        "name": "Al Hilal"
      },
      {
        "id": "club-al-ittihad",
        "name": "Al Ittihad"
      },
      {
        "id": "club-al-khaleej",
        "name": "Al Khaleej"
      },
      {
        "id": "club-al-kholood",
        "name": "Al Kholood"
      },
      {
        "id": "club-al-nassr",
        "name": "Al Nassr"
      },
      {
        "id": "club-al-qadsiah",
        "name": "Al Qadsiah"
      },
      {
        "id": "club-al-riyadh",
        "name": "Al Riyadh"
      },
      {
        "id": "club-al-shabab",
        "name": "Al Shabab"
      },
      {
        "id": "club-al-taawoun",
        "name": "Al Taawoun"
      },
      {
        "id": "club-diriyah",
        "name": "Diriyah FC"
      },
      {
        "id": "club-neom",
        "name": "NEOM Sports Club"
      }
    ]
  },
  "league-j1": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 20,
    "sources": [
      {
        "url": "https://www.jleague.jp/en/j1/club/",
        "publisher": "J.LEAGUE"
      }
    ],
    "clubs": [
      {
        "id": "club-avispa-fukuoka",
        "name": "Avispa Fukuoka"
      },
      {
        "id": "club-cerezo-osaka",
        "name": "Cerezo Osaka"
      },
      {
        "id": "club-fagiano-okayama",
        "name": "Fagiano Okayama"
      },
      {
        "id": "club-fc-tokyo",
        "name": "FC Tokyo"
      },
      {
        "id": "club-gamba-osaka",
        "name": "Gamba Osaka"
      },
      {
        "id": "club-jef-united-chiba",
        "name": "JEF United Chiba"
      },
      {
        "id": "club-kashima-antlers",
        "name": "Kashima Antlers"
      },
      {
        "id": "club-kashiwa-reysol",
        "name": "Kashiwa Reysol"
      },
      {
        "id": "club-kawasaki-frontale",
        "name": "Kawasaki Frontale"
      },
      {
        "id": "club-kyoto-sanga",
        "name": "Kyoto Sanga F.C."
      },
      {
        "id": "club-machida-zelvia",
        "name": "FC Machida Zelvia"
      },
      {
        "id": "club-mito-hollyhock",
        "name": "Mito Hollyhock"
      },
      {
        "id": "club-nagoya-grampus",
        "name": "Nagoya Grampus"
      },
      {
        "id": "club-sanfrecce-hiroshima",
        "name": "Sanfrecce Hiroshima"
      },
      {
        "id": "club-shimizu-s-pulse",
        "name": "Shimizu S-Pulse"
      },
      {
        "id": "club-tokyo-verdy",
        "name": "Tokyo Verdy"
      },
      {
        "id": "club-urawa-reds",
        "name": "Urawa Reds"
      },
      {
        "id": "club-v-varen-nagasaki",
        "name": "V-Varen Nagasaki"
      },
      {
        "id": "club-vissel-kobe",
        "name": "Vissel Kobe"
      },
      {
        "id": "club-yokohama-f-marinos",
        "name": "Yokohama F. Marinos"
      }
    ]
  },
  "league-turkey-super-lig": {
    "realSeason": "2026/27",
    "verifiedAt": "2026-11-05",
    "expectedClubCount": 18,
    "sources": [
      {
        "url": "https://www.tff.org/Default.aspx?pageId=198",
        "publisher": "Turkish Football Federation"
      }
    ],
    "clubs": [
      {
        "id": "club-alanyaspor",
        "name": "Alanyaspor"
      },
      {
        "id": "club-amed",
        "name": "Amed Sportif Faaliyetler"
      },
      {
        "id": "club-basaksehir",
        "name": "İstanbul Başakşehir"
      },
      {
        "id": "club-besiktas",
        "name": "Beşiktaş"
      },
      {
        "id": "club-caykur-rizespor",
        "name": "Çaykur Rizespor"
      },
      {
        "id": "club-corum",
        "name": "Çorum FK"
      },
      {
        "id": "club-erzurumspor",
        "name": "Erzurumspor FK"
      },
      {
        "id": "club-eyupspor",
        "name": "Eyüpspor"
      },
      {
        "id": "club-fenerbahce",
        "name": "Fenerbahçe"
      },
      {
        "id": "club-galatasaray",
        "name": "Galatasaray"
      },
      {
        "id": "club-gaziantep",
        "name": "Gaziantep FK"
      },
      {
        "id": "club-genclerbirligi",
        "name": "Gençlerbirliği"
      },
      {
        "id": "club-goztepe",
        "name": "Göztepe"
      },
      {
        "id": "club-kasimpasa",
        "name": "Kasımpaşa"
      },
      {
        "id": "club-kocaelispor",
        "name": "Kocaelispor"
      },
      {
        "id": "club-konyaspor",
        "name": "Konyaspor"
      },
      {
        "id": "club-samsunspor",
        "name": "Samsunspor"
      },
      {
        "id": "club-trabzonspor",
        "name": "Trabzonspor"
      }
    ]
  }
};
