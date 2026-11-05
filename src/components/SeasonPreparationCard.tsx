import React from 'react';
import { useI18n } from '../i18n';
import { EFL_SECOND_SEASON } from '../lib/seasonPreparation';
import './season-preparation.css';

const copy = {
  uz: { title: 'EFL · 2-mavsum', status: 'Tayyorgarlik', europe: 'Yevropa ligalari', asia: 'Osiyo ligalari', opening: 'Ochiladi', note: '1-mavsum davom etmoqda. 2-mavsum uchun klub tanlash hali ochilmagan.', pending: 'Klub tarkiblari, liga qoidalari va EFL kubok rejasi tayyor. UEFA saralashi va mavsumni ishga tushirish hali tayyorlanmoqda.', details: 'Ligalar rejasini ko‘rish' },
  ru: { title: 'EFL · Сезон 2', status: 'Подготовка', europe: 'Европейские лиги', asia: 'Азиатские лиги', opening: 'Откроется', note: 'Сезон 1 продолжается. Выбор клуба на сезон 2 ещё не открыт.', pending: 'Составы, правила лиг и план кубков EFL готовы. Отбор УЕФА и запуск сезона ещё готовятся.', details: 'Посмотреть план лиг' },
  en: { title: 'EFL · Season 2', status: 'In preparation', europe: 'European leagues', asia: 'Asian leagues', opening: 'Opening', note: 'Season 1 is ongoing. Club selection for season 2 is not open yet.', pending: 'Club rosters, league rules and the EFL cup plan are ready. UEFA qualification and season activation are still being prepared.', details: 'View league plan' },
};

const internationalCopy = {
  uz: { title: 'Xalqaro turnir', name: 'Osiyo Chempionlar ligasi', qualification: 'Har bir ligadan 8 tadan klub', teams: 'klub', places: 'yo‘llanma', pending: 'Har liganing 2-mavsumdagi 1–8-o‘rinlari qatnashadi.', format: 'Yevropa UCL kabi: umumiy liga bosqichi, har klubga 8 ta o‘yin. 1–8: 1/8 final; 9–24: o‘tish pley-offi; 25–32: turnirdan chiqadi.' },
  ru: { title: 'Международный турнир', name: 'Лига чемпионов Азии', qualification: 'По 8 клубов из каждой лиги', teams: 'клуба', places: 'мест', pending: 'Участвуют места 1–8 каждой лиги по итогам сезона 2.', format: 'Как в европейской ЛЧ: общая лига, по 8 матчей. Места 1–8: 1/8 финала; 9–24: стыковые матчи; 25–32: выбывают.' },
  en: { title: 'International tournament', name: 'Asian Champions League', qualification: '8 clubs from each league', teams: 'clubs', places: 'places', pending: 'Places 1–8 from each league qualify based on season 2 results.', format: 'Like the European UCL: one league phase, 8 matches per club. Places 1–8: round of 16; 9–24: knockout play-offs; 25–32: eliminated.' },
};

export function SeasonPreparationCard({ compact = false }: { compact?: boolean }) {
  const { language } = useI18n();
  const c = copy[language];
  const intl = internationalCopy[language];
  const labels = {
    uz: { clubs: 'klub', rounds: 'tur', matches: 'o‘yin', season: 'Real mavsum', verified: 'Tekshirilgan', source: 'Rasmiy manba', format: 'Ikki davra · uy va safar', ranking:'Teng ochkoda', review:'Yakuniy tekshiruv kerak', cups:'Milliy kuboklar', europe:'UEFA turnirlari', missing:'Qatnashchilar tekshirilmoqda', entries:'qatnashchi', perClub:'Har klubga', slots:'Saralash yo‘llari rasmiy UEFA ro‘yxati bo‘yicha tayyorlanmoqda.' },
    ru: { clubs: 'клубов', rounds: 'туров', matches: 'матчей', season: 'Реальный сезон', verified: 'Проверено', source: 'Официальный источник', format: 'Два круга · дома и в гостях',ranking:'При равенстве очков',review:'Нужна финальная проверка',cups:'Национальные кубки',europe:'Турниры УЕФА',missing:'Участники проверяются',entries:'участников',perClub:'На клуб',slots:'Пути квалификации готовятся по официальному списку УЕФА.' },
    en: { clubs: 'clubs', rounds: 'rounds', matches: 'matches', season: 'Real season', verified: 'Verified', source: 'Official source', format: 'Two legs · home and away',ranking:'Level on points',review:'Final review required',cups:'Domestic cups',europe:'UEFA competitions',missing:'Entrants under review',entries:'entrants',perClub:'Per club',slots:'Qualification paths are being prepared from the official UEFA access list.' },
  }[language];
  const cupCopy = {
    uz:{custom:'EFL formati',source:'EFL kubok qoidasi',single:'Har juftlikda 1 o‘yin',playIn:'Saralash',bye:'1/8 finalga bevosita',direct:'Barcha 16 klub 1/8 finaldan',pending:'Qur’a 2-mavsum liga jadvali asosida tuziladi.'},
    ru:{custom:'Формат EFL',source:'Правило кубков EFL',single:'Один матч в паре',playIn:'Предварительный раунд',bye:'Напрямую в 1/8',direct:'Все 16 клубов начинают с 1/8',pending:'Посев по таблице лиги сезона 2.'},
    en:{custom:'EFL format',source:'EFL cup rules',single:'One match per tie',playIn:'Play-in',bye:'Direct to last 16',direct:'All 16 clubs start in the last 16',pending:'Draw seeding uses the season 2 league standings.'},
  }[language];
  const metrics:Record<string,string> = {
    uz:{goalDifference:'gollar farqi',goalsFor:'urilgan gollar',won:'g‘alabalar',awayGoals:'safardagi gollar',awayWins:'safardagi g‘alabalar',h2hForfeits:'o‘zaro texnik mag‘lubiyatlar',h2hPoints:'o‘zaro ochkolar',h2hGoalDifference:'o‘zaro gollar farqi',h2hGoalsFor:'o‘zaro urilgan gollar',h2hAwayGoals:'o‘zaro safar gollari',discipline:'intizom',forfeits:'texnik mag‘lubiyatlar'},
    ru:{goalDifference:'разница голов',goalsFor:'забитые голы',won:'победы',awayGoals:'гостевые голы',awayWins:'гостевые победы',h2hForfeits:'технические поражения в личных встречах',h2hPoints:'очки в личных встречах',h2hGoalDifference:'разница личных встреч',h2hGoalsFor:'голы в личных встречах',h2hAwayGoals:'гостевые голы личных встреч',discipline:'дисциплина',forfeits:'технические поражения'},
    en:{goalDifference:'goal difference',goalsFor:'goals scored',won:'wins',awayGoals:'away goals',awayWins:'away wins',h2hForfeits:'head-to-head forfeits',h2hPoints:'head-to-head points',h2hGoalDifference:'head-to-head goal difference',h2hGoalsFor:'head-to-head goals',h2hAwayGoals:'head-to-head away goals',discipline:'discipline',forfeits:'forfeits'},
  }[language];
  const asianChampionsLeague = EFL_SECOND_SEASON.internationalCompetitions[0];
  const sourceLeagues = EFL_SECOND_SEASON.leagues.filter(league =>
    asianChampionsLeague.qualification.sourceLeagueIds.some(id => id === league.id));
  const content = <>
    {(['EUROPE', 'ASIA'] as const).map(group => <div key={group} className="season-preparation-group">
      <h4>{group === 'EUROPE' ? c.europe : c.asia}</h4>
      <ul>{EFL_SECOND_SEASON.leagues.filter(league => league.group === group).map(league => <li key={league.id}>
        <details className="season-preparation-roster">
          <summary>
            <span aria-hidden="true">{league.flag}</span><span className="season-preparation-name">{league.name}</span>
            <span className="season-preparation-count">{`${league.roster.clubs.length} ${labels.clubs}`}</span>
          </summary>
          <p className="season-preparation-note">{`${labels.season}: ${league.roster.realSeason} · ${labels.verified}: ${league.roster.verifiedAt}`}</p>
          <p className="season-preparation-note">{`${labels.format} · ${league.format.totalMatchdays} ${labels.rounds} · ${league.format.totalFixtures} ${labels.matches}`}</p>
          <p className="season-preparation-note">{labels.ranking}: {league.rankingRule.criteria.filter(metric=>metric!=='points').map(metric=>metrics[metric]).join(' → ')}.</p>
          {league.rankingRule.verification!=='VERIFIED'&&<p className="season-preparation-note">{labels.review}</p>}
          <ul className="season-preparation-clubs">{league.roster.clubs.map(club => <li key={club.id}>{club.name}</li>)}</ul>
          <a className="season-preparation-source" href={league.roster.sources[0].url} target="_blank" rel="noopener noreferrer">{labels.source}</a>
        </details>
      </li>)}</ul>
    </div>)}
    <div className="season-preparation-international">
      <h4>{intl.title}</h4>
      <div className="season-preparation-header"><h3>{intl.name}</h3><span>{`${asianChampionsLeague.qualification.totalTeams} ${intl.teams}`}</span></div>
      <p className="season-preparation-note">{intl.qualification}:</p>
      <ul className="season-preparation-sources">{sourceLeagues.map(league => <li key={league.id}>
        <span aria-hidden="true">{league.flag}</span> {league.name} · {asianChampionsLeague.qualification.slotsByLeague[league.id as keyof typeof asianChampionsLeague.qualification.slotsByLeague]} {intl.places}
      </li>)}</ul>
      <p className="season-preparation-note">{intl.pending}</p>
      <p className="season-preparation-note">{intl.format}</p>
    </div>
    <details className="season-preparation-regulations"><summary>{labels.europe}</summary>
      <p className="season-preparation-note">{labels.slots}</p>
      <ul>{EFL_SECOND_SEASON.europeanCompetitions.map(comp=><li key={comp.id} className="season-preparation-rule-entry"><strong>{comp.name}</strong><span>{`${comp.totalTeams} ${labels.clubs} · ${labels.perClub} ${comp.matchesPerTeam} ${labels.matches}`}</span><span>{labels.missing}</span><a href={comp.source} target="_blank" rel="noopener noreferrer">{labels.source}</a></li>)}</ul>
    </details>
    <details className="season-preparation-regulations"><summary>{labels.cups}</summary>
      <ul>{EFL_SECOND_SEASON.domesticCups.map(cup=><li key={cup.id} className="season-preparation-rule-entry"><strong>{cup.name}</strong><span>{`${cupCopy.custom} · ${cup.expectedEntrants} ${labels.entries} · ${cup.totalFixtures} ${labels.matches}`}</span><span>{cupCopy.single}</span><span>{cup.preliminaryMatches?`${cupCopy.bye}: 1–${cup.byeThroughPosition}; ${cupCopy.playIn}: ${cup.playInFromPosition}–${cup.expectedEntrants} (${cup.preliminaryMatches} ${labels.matches})`:cupCopy.direct}</span><span>{cupCopy.pending}</span><a href={cup.source} target="_blank" rel="noopener noreferrer">{cupCopy.source}</a></li>)}</ul>
    </details>
    <details className="season-preparation-regulations"><summary>{language==='uz'?'Superkuboklar':language==='ru'?'Суперкубки':'Super cups'} · {EFL_SECOND_SEASON.superCups.length}</summary>
      <p className="season-preparation-note">{language==='uz'?'Mavsum oxirida: kubok g‘olibi va finalchisi, liga yetakchilari. Bir klub takrorlansa, keyingi liga o‘rni olinadi. 4 klub, ikki yarim final va final.':language==='ru'?'В конце сезона: финалисты кубка и лидеры лиги. При совпадении — следующий клуб по таблице. Четыре клуба, два полуфинала и финал.':'At season end: cup finalists and league leaders. Duplicates pass to the next league position. Four clubs, two semi-finals and a final.'}</p>
      <ul>{EFL_SECOND_SEASON.superCups.map(cup=><li key={cup.id} className="season-preparation-rule-entry"><strong>{cup.name}</strong><span>{cup.totalTeams} {labels.clubs} · {cup.totalFixtures} {labels.matches}</span></li>)}</ul>
    </details>
    <p className="season-preparation-pending">{c.pending}</p>
  </>;

  return <section className="season-preparation" aria-label={c.title}>
    <div className="season-preparation-header"><h3>{c.title}</h3><span>{c.status}</span></div>
    <p className="season-preparation-note">{c.note}</p>
    {compact ? <details><summary>{c.details}</summary><div className="season-preparation-groups">{content}</div></details> : <div className="season-preparation-groups">{content}</div>}
  </section>;
}
