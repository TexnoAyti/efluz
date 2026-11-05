import React from 'react';
import { useI18n } from '../i18n';
import { EFL_SECOND_SEASON } from '../lib/seasonPreparation';
import './season-preparation.css';

const copy = {
  uz: { title: 'EFL · 2-mavsum', status: 'Tayyorgarlik', europe: 'Yevropa ligalari', asia: 'Osiyo ligalari', opening: 'Ochiladi', note: '1-mavsum davom etmoqda. 2-mavsum uchun klub tanlash hali ochilmagan.', pending: 'Klub tarkiblari va ikki davrali liga formati tayyor. Kuboklar, teng ochko qoidalari, Yevropa saralashi va boshlanish sanasi hali tayyorlanmoqda.', details: 'Ligalar rejasini ko‘rish' },
  ru: { title: 'EFL · Сезон 2', status: 'Подготовка', europe: 'Европейские лиги', asia: 'Азиатские лиги', opening: 'Откроется', note: 'Сезон 1 продолжается. Выбор клуба на сезон 2 ещё не открыт.', pending: 'Составы и двухкруговой формат готовы. Кубки, правила равенства очков, отбор в Европу и дата старта ещё готовятся.', details: 'Посмотреть план лиг' },
  en: { title: 'EFL · Season 2', status: 'In preparation', europe: 'European leagues', asia: 'Asian leagues', opening: 'Opening', note: 'Season 1 is ongoing. Club selection for season 2 is not open yet.', pending: 'Club rosters and the home-and-away league format are ready. Cups, tiebreak rules, European qualification and start date are still being prepared.', details: 'View league plan' },
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
    uz: { clubs: 'klub', rounds: 'tur', matches: 'o‘yin', season: 'Real mavsum', verified: 'Tekshirilgan', source: 'Rasmiy manba', format: 'Ikki davra · uy va safar' },
    ru: { clubs: 'клубов', rounds: 'туров', matches: 'матчей', season: 'Реальный сезон', verified: 'Проверено', source: 'Официальный источник', format: 'Два круга · дома и в гостях' },
    en: { clubs: 'clubs', rounds: 'rounds', matches: 'matches', season: 'Real season', verified: 'Verified', source: 'Official source', format: 'Two legs · home and away' },
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
    <p className="season-preparation-pending">{c.pending}</p>
  </>;

  return <section className="season-preparation" aria-label={c.title}>
    <div className="season-preparation-header"><h3>{c.title}</h3><span>{c.status}</span></div>
    <p className="season-preparation-note">{c.note}</p>
    {compact ? <details><summary>{c.details}</summary><div className="season-preparation-groups">{content}</div></details> : <div className="season-preparation-groups">{content}</div>}
  </section>;
}
