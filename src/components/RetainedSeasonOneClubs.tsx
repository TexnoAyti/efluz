import React from 'react';
import { ClubCrest } from './ClubCrest';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

interface Props {
  onNavigateTab: (tab: any) => void;
}

/**
 * Season 1 European and Super Cup participants retain their actual verified
 * ownership while browsing Season 2 league admissions.
 * This is display-only: Season 2 eligibility still uses season-scoped ownedClubs.
 */
export const RetainedSeasonOneClubs: React.FC<Props> = ({ onNavigateTab }) => {
  const { activeSeasonId, retainedSeasonOneClubs } = useAuth();
  const { language } = useI18n();
  if (activeSeasonId !== 'season-2027-28' || retainedSeasonOneClubs.length === 0) return null;

  const copy = {
    uz: { heading: '1-mavsumdagi faol kubok klublarim', note: 'Yevrokuboklar va Superkuboklar uchun egalik saqlanadi. 2-mavsumda alohida bitta klub tanlanadi.', euro: 'Yevrokuboklar', superCup: 'Superkuboklar' },
    ru: { heading: 'Мои клубы в кубках 1-го сезона', note: 'Владение для еврокубков и суперкубков сохраняется отдельно от выбора клуба во 2-м сезоне.', euro: 'Еврокубки', superCup: 'Суперкубки' },
    en: { heading: 'My Season 1 cup clubs', note: 'European and Super Cup ownership remains separate from your one Season 2 club.', euro: 'European cups', superCup: 'Super Cups' },
  }[language];

  return (
    <section data-testid="retained-season-one-clubs" className="preview-surface rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface)] p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-[var(--efl-text)]">{copy.heading}</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--efl-text-2)]">{copy.note}</p>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {retainedSeasonOneClubs.map(club => (
          <li key={club.id} className="flex items-center gap-3 rounded-xl border border-[var(--efl-border)] p-2.5">
            <ClubCrest clubId={club.id} logoUrl={club.logoUrl} name={club.name} shortName={club.shortName} size="sm" />
            <span className="min-w-0 truncate text-xs font-semibold text-[var(--efl-text)]">{club.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-[var(--efl-text-2)]">2026/27</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onNavigateTab('champions-league')} className="rounded-xl bg-[var(--efl-primary)] px-3 py-2 text-xs font-bold text-white">{copy.euro}</button>
        <button type="button" onClick={() => onNavigateTab('cups')} className="rounded-xl border border-[var(--efl-border)] px-3 py-2 text-xs font-bold text-[var(--efl-text)]">{copy.superCup}</button>
      </div>
    </section>
  );
};
