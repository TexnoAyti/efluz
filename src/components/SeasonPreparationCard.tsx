import React from 'react';
import { useI18n } from '../i18n';
import { EFL_SECOND_SEASON } from '../lib/seasonPreparation';
import './season-preparation.css';

const copy = {
  uz: { title: 'EFL · 2-mavsum', status: 'Tayyorgarlik', europe: 'Yevropa ligalari', asia: 'Osiyo ligalari', opening: 'Ochiladi', note: '1-mavsum davom etmoqda. 2-mavsum uchun klub tanlash hali ochilmagan.', pending: 'Klub tarkiblari, jamoalar soni, format, saralash va boshlanish sanasi keyin e’lon qilinadi.', details: 'Ligalar rejasini ko‘rish' },
  ru: { title: 'EFL · Сезон 2', status: 'Подготовка', europe: 'Европейские лиги', asia: 'Азиатские лиги', opening: 'Откроется', note: 'Сезон 1 продолжается. Выбор клуба на сезон 2 ещё не открыт.', pending: 'Составы клубов, число команд, формат, отбор и дата старта будут объявлены позже.', details: 'Посмотреть план лиг' },
  en: { title: 'EFL · Season 2', status: 'In preparation', europe: 'European leagues', asia: 'Asian leagues', opening: 'Opening', note: 'Season 1 is ongoing. Club selection for season 2 is not open yet.', pending: 'Club rosters, team counts, format, qualification and start date will be announced later.', details: 'View league plan' },
};

export function SeasonPreparationCard({ compact = false }: { compact?: boolean }) {
  const { language } = useI18n();
  const c = copy[language];
  const content = <>
    {(['EUROPE', 'ASIA'] as const).map(group => <div key={group} className="season-preparation-group">
      <h4>{group === 'EUROPE' ? c.europe : c.asia}</h4>
      <ul>{EFL_SECOND_SEASON.leagues.filter(league => league.group === group).map(league => <li key={league.id}>
        <span aria-hidden="true">{league.flag}</span><span className="season-preparation-name">{league.name}</span>
        {league.change === 'OPENING' && <span className="season-preparation-opening">{c.opening}</span>}
      </li>)}</ul>
    </div>)}
    <p className="season-preparation-pending">{c.pending}</p>
  </>;

  return <section className="season-preparation" aria-label={c.title}>
    <div className="season-preparation-header"><h3>{c.title}</h3><span>{c.status}</span></div>
    <p className="season-preparation-note">{c.note}</p>
    {compact ? <details><summary>{c.details}</summary><div className="season-preparation-groups">{content}</div></details> : <div className="season-preparation-groups">{content}</div>}
  </section>;
}
