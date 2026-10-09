import { useEffect, useId, useState } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';
import { useI18n, type Language } from '../i18n';
import { seasonLabel, type PlayerTrophyCabinet as CabinetData, type PlayerTrophy } from '../types/trophies';

const copy = {
  uz: { title: 'Sovrinlar', description: 'Musobaqa va mavsum bo‘yicha chempionliklar', all: 'Barcha mavsumlar', season: 'Mavsum', champion: 'Chempion', empty: 'Hali sovrin yo‘q. Musobaqada g‘olib bo‘lsangiz, sovrin shu yerda ko‘rinadi.', loading: 'Sovrinlar yuklanmoqda…', error: 'Sovrinlarni hozir yuklab bo‘lmadi.', retry: 'Qayta urinish', stale: 'Oxirgi saqlangan sovrinlar ko‘rsatilmoqda.' },
  ru: { title: 'Трофеи', description: 'Чемпионские титулы по турнирам и сезонам', all: 'Все сезоны', season: 'Сезон', champion: 'Чемпион', empty: 'Трофеев пока нет. Победа в турнире появится здесь.', loading: 'Загрузка трофеев…', error: 'Не удалось загрузить трофеи.', retry: 'Повторить', stale: 'Показаны последние сохранённые трофеи.' },
  en: { title: 'Trophies', description: 'Championships by competition and season', all: 'All seasons', season: 'Season', champion: 'Champion', empty: 'No trophies yet. Your competition wins will appear here.', loading: 'Loading trophies…', error: 'Trophies are temporarily unavailable.', retry: 'Retry', stale: 'Showing the last saved trophies.' },
};

function leagueEmblem(competitionId: string): string | null {
  for (const league of ['premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1']) {
    if (new RegExp(`^comp-${league}-\\d{4}$`).test(competitionId)) return `/export-emblems/${league}.svg`;
  }
  return null;
}

export function TrophyCabinetView({ trophies, language, stale = false }: { trophies: PlayerTrophy[]; language: Language; stale?: boolean }) {
  const text = copy[language];
  const [selectedSeason, setSelectedSeason] = useState('ALL');
  const filterId = useId();
  const seasons = [...new Set(trophies.map(trophy => trophy.seasonId))].sort().reverse();
  const filter = seasons.includes(selectedSeason) ? selectedSeason : 'ALL';
  const visible = filter === 'ALL' ? trophies : trophies.filter(trophy => trophy.seasonId === filter);
  return (
    <section aria-label={text.title} className="rounded-3xl border border-[var(--efl-border,rgba(255,255,255,0.1))] bg-[var(--efl-surface,#111722)] p-4 sm:p-5 text-left space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black text-[var(--efl-text,#f8fafc)]">
            <Trophy aria-hidden="true" className="h-4 w-4 text-amber-500" />{text.title}
            <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-xs text-[var(--efl-text,#f8fafc)]">{trophies.length}</span>
          </h2>
          <p className="mt-1 text-xs text-[var(--efl-text-2,#94a3b8)]">{text.description}</p>
        </div>
        {seasons.length > 1 && (
          <div>
            <label htmlFor={filterId} className="sr-only">{text.season}</label>
            <select id={filterId} value={filter} onChange={event => setSelectedSeason(event.target.value)} className="min-h-11 max-w-full rounded-xl border border-[var(--efl-border,rgba(255,255,255,0.1))] bg-[var(--efl-surface-2,#171e2c)] px-3 text-xs font-bold text-[var(--efl-text,#f8fafc)]">
              <option value="ALL">{text.all}</option>
              {seasons.map(season => <option key={season} value={season}>{seasonLabel(season)}</option>)}
            </select>
          </div>
        )}
      </div>
      {stale && <p role="status" className="text-xs text-[var(--efl-text-2,#94a3b8)]">{text.stale}</p>}
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--efl-border,rgba(255,255,255,0.1))] p-5 text-xs leading-5 text-[var(--efl-text-2,#94a3b8)]">{text.empty}</p>
      ) : (
        <ul className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {visible.map(trophy => {
            const emblem = leagueEmblem(trophy.competitionId);
            return (
              <li key={trophy.id} className="min-w-0 rounded-2xl border border-[var(--efl-border,rgba(255,255,255,0.1))] bg-[var(--efl-surface-2,#171e2c)] p-3">
                <div className="flex h-16 items-center justify-center gap-3 rounded-xl bg-amber-500/5">
                  <Trophy aria-hidden="true" className="h-10 w-10 shrink-0 text-amber-500" strokeWidth={1.5} />
                  {emblem && <img src={emblem} alt="" width="28" height="28" loading="lazy" className="h-7 w-7 rounded-md bg-white/95 p-0.5 object-contain" />}
                </div>
                <p className="mt-3 break-words text-xs font-black leading-5 text-[var(--efl-text,#f8fafc)]">{trophy.competitionName}</p>
                <p className="mt-1 text-xs font-bold text-[var(--efl-text,#f8fafc)]">{seasonLabel(trophy.seasonId)} · {text.champion}</p>
                <p className="mt-1 break-words text-[11px] text-[var(--efl-text-2,#94a3b8)]">{trophy.clubName}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Public; independent of Premium and the player's currently selected club. */
export function PlayerTrophyCabinet({ userId, seasonId = 'season-2026-27' }: { userId: string; seasonId?: string }) {
  const { language } = useI18n();
  const text = copy[language];
  const [state, setState] = useState<{ userId: string; seasonId: string; data?: CabinetData; error?: boolean }>({ userId, seasonId });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ userId, seasonId });
    void fetch(`/api/insights/player/${encodeURIComponent(userId)}/trophies?seasonId=${encodeURIComponent(seasonId)}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error('TROPHIES_UNAVAILABLE');
        const data: CabinetData = await response.json();
        if (!Array.isArray(data.trophies)) throw new Error('INVALID_TROPHIES');
        if (!controller.signal.aborted) setState({ userId, seasonId, data });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ userId, seasonId, error: true }); });
    return () => controller.abort();
  }, [userId, seasonId, retry]);
  const current = state.userId === userId && state.seasonId === seasonId;
  if (current && state.data) return <TrophyCabinetView key={userId} trophies={state.data.trophies} language={language} stale={state.data.stale} />;
  return (
    <section aria-label={text.title} className="rounded-3xl border border-[var(--efl-border,rgba(255,255,255,0.1))] bg-[var(--efl-surface,#111722)] p-5 text-xs text-[var(--efl-text-2,#94a3b8)]">
      {current && state.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
          <span>{text.error}</span>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold text-[var(--efl-primary,#60a5fa)]"><RefreshCw aria-hidden="true" className="h-4 w-4" />{text.retry}</button>
        </div>
      ) : <p role="status">{text.loading}</p>}
    </section>
  );
}
