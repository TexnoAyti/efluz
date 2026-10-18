import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, MapPin, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { clubStadium } from '../constants/clubStadiums';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import type { Club, Fixture, StandingsRow } from '../types';
import { ClubCrest } from './ClubCrest';

const labels = {
  uz: { back: 'Orqaga', retry: 'Qayta urinish', loadError: 'Klub ma’lumotlarini yuklab bo‘lmadi.', matchesError: 'Liga ma’lumotlarini yuklab bo‘lmadi.', available: 'Klub bo‘sh', owner: 'Klub egasi', stadium: 'Stadion belgilanmagan', league: 'Liga', position: 'O‘rin', played: 'O‘yin', won: 'G‘alaba', drawn: 'Durang', lost: 'Mag‘lubiyat', points: 'Ochko', goals: 'Gollar', matches: 'Ligadagi o‘yinlar', empty: 'Hozircha o‘yinlar yo‘q.', noTable: 'Ligadagi ko‘rsatkichlar hali shakllanmagan.', unscheduled: 'Vaqt belgilanmagan', confirmed: 'Yakunlangan', cancelled: 'Bekor qilingan', pending: 'Tasdiq kutilmoqda', upcoming: 'Kelgusi', disputed: 'Bahsli natija' },
  ru: { back: 'Назад', retry: 'Повторить', loadError: 'Не удалось загрузить клуб.', matchesError: 'Не удалось загрузить данные лиги.', available: 'Клуб свободен', owner: 'Владелец клуба', stadium: 'Стадион не указан', league: 'Лига', position: 'Место', played: 'Матчи', won: 'Победы', drawn: 'Ничьи', lost: 'Поражения', points: 'Очки', goals: 'Голы', matches: 'Матчи в лиге', empty: 'Матчей пока нет.', noTable: 'Статистика лиги ещё не сформирована.', unscheduled: 'Время не назначено', confirmed: 'Завершён', cancelled: 'Отменён', pending: 'Ожидает подтверждения', upcoming: 'Предстоящий', disputed: 'Спорный результат' },
  en: { back: 'Back', retry: 'Retry', loadError: 'Could not load club details.', matchesError: 'Could not load league data.', available: 'Club available', owner: 'Club owner', stadium: 'Venue not set', league: 'League', position: 'Position', played: 'Played', won: 'Won', drawn: 'Drawn', lost: 'Lost', points: 'Points', goals: 'Goals', matches: 'League matches', empty: 'No matches yet.', noTable: 'League statistics are not available yet.', unscheduled: 'Time not set', confirmed: 'Completed', cancelled: 'Cancelled', pending: 'Awaiting confirmation', upcoming: 'Upcoming', disputed: 'Disputed result' },
};

export function PublicClubView({ clubId, onBack }: { clubId: string; onBack: () => void }) {
  const { activeSeasonId } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { language } = useI18n();
  const t = labels[language] || labels.uz;
  const [club, setClub] = useState<Club | null>(null);
  const [standing, setStanding] = useState<StandingsRow | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [leagueName, setLeagueName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [leagueError, setLeagueError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setClub(null); setStanding(null); setFixtures([]); setLeagueName('');
    setLoading(true); setError(false); setLeagueError(false);
    async function load() {
      let loaded: Club;
      try {
        const result = await api.getClub(clubId, activeSeasonId, attempt > 0);
        if (cancelled) return;
        loaded = result.club;
        setClub(loaded);
      } catch { if (!cancelled) { setError(true); setLoading(false); } return; }
      try {
        const result = await api.getCompetitions(activeSeasonId, attempt > 0);
        const competition = result.competitions.find(c => c.type === 'LEAGUE' && c.leagueId === loaded.leagueId && c.seasonId === activeSeasonId);
        if (!competition || cancelled) return;
        setLeagueName(competition.name);
        const [table, matches] = await Promise.allSettled([
          api.getCompetitionStandings(competition.id, attempt > 0),
          api.getCompetitionFixtures(competition.id, undefined, undefined, attempt > 0),
        ]);
        if (cancelled) return;
        if (table.status === 'fulfilled') setStanding(table.value.standings.find(row => row.clubId === clubId) || null);
        if (matches.status === 'fulfilled') setFixtures(matches.value.fixtures.filter(f => f.seasonId === activeSeasonId && (f.homeClubId === clubId || f.awayClubId === clubId)).sort((a, b) => a.matchday - b.matchday || a.id.localeCompare(b.id)));
        setLeagueError(table.status === 'rejected' || matches.status === 'rejected');
      } catch { if (!cancelled) setLeagueError(true); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [clubId, activeSeasonId, attempt]);

  const owner = getClubOwnerDisplay(club, undefined, undefined, t.available);
  const surface = 'rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface)] p-4 sm:p-5';
  const dateLabel = (value: string) => {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return t.unscheduled;
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'en' ? 'en-GB' : 'uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }).format(date) + ' · UTC+5';
  };
  return <article className="space-y-4 pb-16 text-[var(--efl-text)]" aria-label={club?.name || 'Klub'}>
    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--efl-text-2)]"><ArrowLeft className="h-4 w-4" />{t.back}</button>
    {error && <div role="alert" className={surface}><p>{t.loadError}</p><button type="button" className="mt-3 min-h-11 font-bold text-[var(--efl-primary)]" onClick={() => setAttempt(n => n + 1)}>{t.retry}</button></div>}
    {club && <>
      <header className={`${surface} flex flex-wrap items-center gap-4`}>
        <ClubCrest clubId={club.id} logoUrl={club.logoUrl} name={club.name} shortName={club.shortName} size="2xl" />
        <div className="min-w-0 flex-1"><p className="text-xs text-[var(--efl-muted)]">{leagueName || club.leagueName || t.league} · {activeSeasonId.replace('season-', '').replace('-', '/')}</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{club.name}</h1><p className="mt-2 flex items-center gap-2 text-xs text-[var(--efl-text-2)]"><MapPin className="h-4 w-4 shrink-0" />{clubStadium(club.id, club.stadium) || t.stadium}</p></div>
        <div className="w-full border-t border-[var(--efl-border)] pt-3 text-sm"><p className="mb-1 text-xs text-[var(--efl-muted)]">{t.owner}</p>{owner.userId ? <button type="button" onClick={() => openUserProfile(owner.userId!)} className="inline-flex min-h-11 items-center gap-2 font-bold text-[var(--efl-primary)]"><UserRound className="h-4 w-4" />{owner.displayText}</button> : <span>{owner.displayText}</span>}</div>
      </header>
      {standing ? <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t.league}>{[[t.position, standing.position], [t.points, standing.points], [t.played, standing.played], [t.goals, `${standing.goalsFor}:${standing.goalsAgainst}`], [t.won, standing.won], [t.drawn, standing.drawn], [t.lost, standing.lost]].map(([name, value]) => <div key={name} className={surface}><p className="text-xs text-[var(--efl-muted)]">{name}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}</section> : !loading && !leagueError && <p className="text-sm text-[var(--efl-muted)]">{t.noTable}</p>}
      {leagueError && <div role="alert" className={surface}>{t.matchesError}<button type="button" className="ml-3 min-h-11 font-bold text-[var(--efl-primary)]" onClick={() => setAttempt(n => n + 1)}>{t.retry}</button></div>}
      <section className={surface}><h2 className="mb-4 font-black">{t.matches}</h2>{!loading && !leagueError && !fixtures.length && <p className="text-sm text-[var(--efl-muted)]">{t.empty}</p>}<ul className="divide-y divide-[var(--efl-border)]">{fixtures.map(f => <li key={f.id} className="py-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-[11px] text-[var(--efl-muted)]"><span>{f.roundName || `${f.matchday}`}</span><span>{dateLabel(f.scheduledAt)}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs sm:text-sm"><span className="flex items-center gap-2"><ClubCrest clubId={f.homeClubId || undefined} logoUrl={f.homeClub?.logoUrl} name={f.homeClub?.name} size="sm" />{f.homeClub?.name || 'TBD'}</span><strong className="rounded-lg bg-[var(--efl-surface-2)] px-3 py-2 tabular-nums">{f.status === 'CONFIRMED' && f.homeScore != null && f.awayScore != null ? `${f.homeScore} : ${f.awayScore}` : '—'}</strong><span className="flex items-center justify-end gap-2 text-right">{f.awayClub?.name || 'TBD'}<ClubCrest clubId={f.awayClubId || undefined} logoUrl={f.awayClub?.logoUrl} name={f.awayClub?.name} size="sm" /></span></div><p className="mt-2 text-center text-[10px] text-[var(--efl-muted)]">{f.status === 'CONFIRMED' ? t.confirmed : f.status === 'CANCELLED' ? t.cancelled : f.status === 'DISPUTED' ? t.disputed : f.status === 'PENDING_CONFIRMATION' ? t.pending : t.upcoming}</p></li>)}</ul></section>
    </>}
    {loading && <p role="status" className="flex justify-center p-6"><Loader2 aria-label="Loading" className="h-6 w-6 animate-spin text-[var(--efl-primary)]" /></p>}
  </article>;
}
