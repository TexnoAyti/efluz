import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, Loader2, MapPin, RefreshCw, Shield, Trophy, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { clubStadium } from '../constants/clubStadiums';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { nextSeasonFixture, sortSeasonFixtures } from '../lib/fixtureOrder';
import type { Club, Competition, Fixture, StandingsRow } from '../types';
import { ClubCrest } from './ClubCrest';
import { CompetitionMark } from './CompetitionMark';
import './public-club.css';

const labels = {
  uz: { back: 'Orqaga', club: 'Klub profili', retry: 'Qayta urinish', loadError: 'Klub ma’lumotlarini yuklab bo‘lmadi.', matchesError: 'Ayrim ma’lumotlar yuklanmadi. Qayta urinib ko‘ring.', available: 'Klub bo‘sh', owner: 'Klub egasi', stadium: 'Stadion belgilanmagan', league: 'Liga', position: 'O‘rin', played: 'O‘yin', won: 'G‘alaba', drawn: 'Durang', lost: 'Mag‘lubiyat', points: 'Ochko', goals: 'Gollar', difference: 'To‘plar farqi', matches: 'Uchrashuvlar', empty: 'Bu tanlov bo‘yicha o‘yinlar yo‘q.', noTable: 'Liga jadvali hali shakllanmagan.', unscheduled: 'Vaqt belgilanmagan', confirmed: 'Yakunlangan', cancelled: 'Bekor qilingan', pending: 'Tasdiq kutilmoqda', upcoming: 'Kelgusi', disputed: 'Bahsli natija', all: 'Barchasi', results: 'Natijalar', next: 'Navbatdagi uchrashuv', season: 'Mavsum', home: 'Uyda', away: 'Safarda', form: 'So‘nggi natijalar', tournaments: 'Musobaqalar', round: 'tur', extra: 'Qo‘shimcha vaqt', penalties: 'Penaltilar', saved: 'Oxirgi saqlangan ma’lumotlar ko‘rsatilmoqda.', ready: 'O‘yinga tayyor', playing: 'Davom etmoqda', awaiting: 'Natija kutilmoqda', postponed: 'Qoldirilgan', overdue: 'Muddat o‘tgan' },
  ru: { back: 'Назад', club: 'Профиль клуба', retry: 'Повторить', loadError: 'Не удалось загрузить клуб.', matchesError: 'Часть данных не загрузилась. Повторите попытку.', available: 'Клуб свободен', owner: 'Владелец клуба', stadium: 'Стадион не указан', league: 'Лига', position: 'Место', played: 'Матчи', won: 'Победы', drawn: 'Ничьи', lost: 'Поражения', points: 'Очки', goals: 'Голы', difference: 'Разница мячей', matches: 'Матчи', empty: 'Матчей по этому фильтру нет.', noTable: 'Таблица ещё не сформирована.', unscheduled: 'Время не назначено', confirmed: 'Завершён', cancelled: 'Отменён', pending: 'Ожидает подтверждения', upcoming: 'Предстоящий', disputed: 'Спорный результат', all: 'Все', results: 'Результаты', next: 'Следующий матч', season: 'Сезон', home: 'Дома', away: 'В гостях', form: 'Последние результаты', tournaments: 'Турниры', round: 'тур', extra: 'Доп. время', penalties: 'Пенальти', saved: 'Показаны последние сохранённые данные.', ready: 'Готов к игре', playing: 'Идёт матч', awaiting: 'Ожидается результат', postponed: 'Перенесён', overdue: 'Просрочен' },
  en: { back: 'Back', club: 'Club profile', retry: 'Retry', loadError: 'Could not load club details.', matchesError: 'Some data could not be loaded. Please retry.', available: 'Club available', owner: 'Club owner', stadium: 'Venue not set', league: 'League', position: 'Position', played: 'Played', won: 'Won', drawn: 'Drawn', lost: 'Lost', points: 'Points', goals: 'Goals', difference: 'Goal difference', matches: 'Matches', empty: 'No matches for this selection.', noTable: 'The league table is not available yet.', unscheduled: 'Time not set', confirmed: 'Completed', cancelled: 'Cancelled', pending: 'Awaiting confirmation', upcoming: 'Upcoming', disputed: 'Disputed result', all: 'All', results: 'Results', next: 'Next match', season: 'Season', home: 'Home', away: 'Away', form: 'Recent form', tournaments: 'Competitions', round: 'MD', extra: 'Extra time', penalties: 'Penalties', saved: 'Showing the last saved data.', ready: 'Ready to play', playing: 'In progress', awaiting: 'Awaiting result', postponed: 'Postponed', overdue: 'Overdue' },
};
type Language = keyof typeof labels;
type ProfileData = { club: Club; fixtures: Fixture[]; competitions: Competition[]; standing: StandingsRow | null; leagueTable: StandingsRow[]; seasonId: string };

function clubOutcome(f: Fixture, clubId: string): 'win' | 'draw' | 'loss' | '' {
  if (f.status !== 'CONFIRMED' || f.homeScore == null || f.awayScore == null) return '';
  let home = f.homeExtraTimeScore ?? f.homeScore, away = f.awayExtraTimeScore ?? f.awayScore;
  if (home === away && f.homePenaltyScore != null && f.awayPenaltyScore != null) {
    home = f.homePenaltyScore; away = f.awayPenaltyScore;
  }
  const mine = f.homeClubId === clubId ? home : away, theirs = f.homeClubId === clubId ? away : home;
  return mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
}

function fixtureTime(value: string, language: Language) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return null;
  const locale = language === 'ru' ? 'ru-RU' : language === 'en' ? 'en-GB' : 'uz-UZ';
  return {
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }).format(date),
  };
}

export function ClubProfileMatch({ fixture: f, competition, clubId, leagueTable, language, featured = false }: {
  fixture: Fixture; competition?: Competition; clubId: string; leagueTable: StandingsRow[]; language: Language; featured?: boolean;
}) {
  const t = labels[language];
  const time = fixtureTime(f.scheduledAt, language);
  const finished = f.status === 'CONFIRMED';
  const status = { CONFIRMED: t.confirmed, CANCELLED: t.cancelled, DISPUTED: t.disputed, PENDING_CONFIRMATION: t.pending, SCHEDULED: t.upcoming, READY: t.ready, PLAYING: t.playing, AWAITING_RESULT: t.awaiting, POSTPONED: t.postponed, OVERDUE: t.overdue }[f.status] || t.upcoming;
  const home = f.homeClubId === clubId;
  const score = finished && f.homeScore != null && f.awayScore != null ? `${f.homeScore} – ${f.awayScore}` : null;
  const outcome = clubOutcome(f, clubId);
  const rank = (id: string | null) => leagueTable.find(row => row.clubId === id)?.position;
  const team = (club: Club | null | undefined, id: string | null, side: string) => <div className={`club-match-team club-match-team-${side}`}>
    <ClubCrest clubId={id || undefined} logoUrl={club?.logoUrl} name={club?.name} shortName={club?.shortName} size={featured ? 'xl' : 'lg'} className="club-profile-crest" />
    <div><h3>{club?.name || 'TBD'}</h3><p>{rank(id) ? `${rank(id)} · ${t.position.toLowerCase()}` : '—'}</p></div>
  </div>;
  return <article className={`club-match-card ${featured ? 'club-match-featured' : ''}`} data-outcome={outcome}>
    <div className="club-match-heading"><div className="club-competition-label"><CompetitionMark competition={competition} className="h-5 w-5" /><span>{competition?.name || f.competitionName || f.competitionId}</span></div><span className={`club-status ${finished ? 'is-complete' : ''}`}>{finished && <Check size={11} />}{status}</span></div>
    <div className="club-match-round"><span>{f.roundName || `${f.matchday}-${t.round}`}</span><span className="club-venue-tag">{home ? t.home : t.away}</span>{time && <span>{time.date}</span>}</div>
    <div className="club-match-scoreboard">
      {team(f.homeClub, f.homeClubId, 'home')}
      <div className="club-match-center">{score ? <strong>{score}</strong> : <><strong>{time?.time || '—'}</strong><span>{time ? 'VS' : t.unscheduled}</span></>}{finished && <span>FT</span>}</div>
      {team(f.awayClub, f.awayClubId, 'away')}
    </div>
    {finished && f.homePenaltyScore != null && f.awayPenaltyScore != null && <p className="club-match-detail">{t.penalties} · {f.homePenaltyScore} – {f.awayPenaltyScore}</p>}
    {finished && f.homeExtraTimeScore != null && f.awayExtraTimeScore != null && <p className="club-match-detail">{t.extra} · {f.homeExtraTimeScore} – {f.awayExtraTimeScore}</p>}
    {featured && <p className="club-feature-venue"><MapPin size={12} />{f.venue || clubStadium(f.homeClubId, f.homeClub?.stadium) || t.stadium}</p>}
  </article>;
}

/** Shared presentation used for the live page and visual regression review. */
export function PublicClubProfile({ data, language = 'uz', onBack, onOwner, loading = false, partial = false, stale = false, onRetry }: {
  data: ProfileData; language?: Language; onBack: () => void; onOwner: (id: string) => void;
  loading?: boolean; partial?: boolean; stale?: boolean; onRetry: () => void;
}) {
  const { club, fixtures, competitions, standing, leagueTable, seasonId } = data;
  const t = labels[language];
  const [tab, setTab] = useState<'all' | 'upcoming' | 'results'>('all');
  const [competitionFilter, setCompetitionFilter] = useState('ALL');
  const league = competitions.find(c => c.type === 'LEAGUE' && c.leagueId === club.leagueId);
  const owner = getClubOwnerDisplay(club, undefined, undefined, t.available);
  const relevant = competitions.filter(c => fixtures.some(f => f.competitionId === c.id));
  const next = nextSeasonFixture(fixtures.filter(f => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED'));
  const list = useMemo(() => {
    const filtered = fixtures.filter(f => (competitionFilter === 'ALL' || f.competitionId === competitionFilter) &&
      (tab === 'all' || (tab === 'results' ? f.status === 'CONFIRMED' : f.status !== 'CONFIRMED' && f.status !== 'CANCELLED')));
    return tab === 'results' ? filtered.slice().reverse() : filtered;
  }, [fixtures, competitionFilter, tab]);
  const form = fixtures.filter(f => f.status === 'CONFIRMED' && f.homeScore != null && f.awayScore != null).slice(-5);
  const seasonName = seasonId.replace('season-', '').replace('-', '/');
  return <div className="efl-club-profile">
    <nav className="club-breadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={15} />{t.back}</button><ChevronRight size={12} /><span>{t.club}</span><span className="club-season-label">{seasonName}</span></nav>
    <header className="club-profile-hero">
      <div className="club-hero-watermark" aria-hidden="true">{club.shortName}</div>
      <div className="club-hero-identity"><ClubCrest clubId={club.id} logoUrl={club.logoUrl} name={club.name} shortName={club.shortName} size="custom" className="club-hero-crest" />
        <div className="club-hero-copy"><div className="club-hero-eyebrow"><CompetitionMark competition={league} className="h-5 w-5" />{league?.name || club.leagueName || t.league}<span>· {club.country}</span></div><h1>{club.name}</h1><p><MapPin size={13} />{clubStadium(club.id, club.stadium) || t.stadium}</p></div>
      </div>
      <div className="club-hero-footer"><div><UserRound size={15} /><span>{t.owner}</span>{owner.userId ? <button type="button" onClick={() => onOwner(owner.userId!)}>{owner.displayText}<ArrowUpRight size={14} /></button> : <strong>{owner.displayText}</strong>}</div><span><span className="club-season-dot" />{seasonName} · {t.season}</span></div>
    </header>
    {(partial || stale) && <div role="status" className="club-data-notice"><span>{partial ? t.matchesError : t.saved}</span><button type="button" onClick={onRetry}><RefreshCw size={13} />{t.retry}</button></div>}
    {standing && <section className="club-mobile-summary" aria-label={t.league}>{[[t.position, `#${standing.position}`], [t.points, standing.points], [t.played, standing.played], [t.goals, `${standing.goalsFor}:${standing.goalsAgainst}`]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</section>}
    <div className="club-profile-layout">
      <main className="club-profile-matches">
        {next && <section className="club-next-section"><div className="club-section-title"><span><CalendarDays size={15} />{t.next}</span><span className="club-section-line" /></div><ClubProfileMatch fixture={next} competition={competitions.find(c => c.id === next.competitionId)} clubId={club.id} leagueTable={leagueTable} language={language} featured /></section>}
        <section className="club-fixture-section"><div className="club-fixtures-top"><h2>{t.matches}<span>{fixtures.length}</span></h2><div className="club-match-tabs" role="tablist" aria-label={t.matches}>{([['all', t.all], ['upcoming', t.upcoming], ['results', t.results]] as const).map(([id, text]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{text}</button>)}</div></div>
          <div className="club-competition-filters" aria-label={t.tournaments}><button type="button" aria-pressed={competitionFilter === 'ALL'} onClick={() => setCompetitionFilter('ALL')}><Shield size={14} />{t.all}</button>{relevant.map(c => <button key={c.id} type="button" aria-pressed={competitionFilter === c.id} onClick={() => setCompetitionFilter(c.id)}><CompetitionMark competition={c} className="h-4 w-4" />{c.name}</button>)}</div>
          {loading && <div role="status" className="club-loading"><Loader2 className="animate-spin" size={20} /></div>}
          {!loading && !list.length && <div className="club-empty"><CalendarDays size={28} /><p>{t.empty}</p></div>}
          <div className="club-match-list">{list.map(f => <ClubProfileMatch key={f.id} fixture={f} competition={competitions.find(c => c.id === f.competitionId)} clubId={club.id} leagueTable={leagueTable} language={language} />)}</div>
        </section>
      </main>
      <aside className="club-profile-sidebar">
        <section className="club-league-panel"><div className="club-sidebar-heading"><CompetitionMark competition={league} className="h-7 w-7" /><div><span>{t.league}</span><h2>{league?.name || club.leagueName || t.league}</h2></div><Trophy size={17} /></div>
          {standing ? <><div className="club-position-block"><div><strong>{standing.position}<small>/{leagueTable.length || '—'}</small></strong><span>{t.position}</span></div><div><strong>{standing.points}</strong><span>{t.points}</span></div></div><div className="club-stat-rail">{[[t.played, standing.played], [t.won, standing.won], [t.drawn, standing.drawn], [t.lost, standing.lost]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><dl className="club-goal-stats"><div><dt>{t.goals}</dt><dd>{standing.goalsFor}<span>:</span>{standing.goalsAgainst}</dd></div><div><dt>{t.difference}</dt><dd>{standing.goalDifference > 0 ? '+' : ''}{standing.goalDifference}</dd></div></dl></> : <p className="club-panel-empty">{loading ? '…' : t.noTable}</p>}
        </section>
        <section className="club-form-panel"><h2>{t.form}</h2><div className="club-form-strip">{form.length ? form.map(f => { const result = clubOutcome(f, club.id); return <span key={f.id} data-result={result} title={`${f.homeClub?.name} ${f.homeScore} – ${f.awayScore} ${f.awayClub?.name}`}>{result === 'win' ? (language === 'uz' ? 'G‘' : 'W') : result === 'loss' ? (language === 'uz' ? 'M' : 'L') : 'D'}</span>; }) : <span className="club-form-placeholder">—</span>}</div><p>{form.length ? `${form.length} ${t.matches.toLowerCase()}` : t.noTable}</p></section>
        <section className="club-tournaments-panel"><h2>{t.tournaments}</h2>{relevant.map(c => <button key={c.id} type="button" onClick={() => { setCompetitionFilter(c.id); setTab('all'); }}><CompetitionMark competition={c} className="h-6 w-6" /><span>{c.name}<small>{fixtures.filter(f => f.competitionId === c.id).length} {t.matches.toLowerCase()}</small></span><ChevronRight size={14} /></button>)}</section>
      </aside>
    </div>
  </div>;
}

export function PublicClubView({ clubId, onBack }: { clubId: string; onBack: () => void }) {
  const { activeSeasonId } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { language } = useI18n();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [partial, setPartial] = useState(false);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(null); setLoading(true); setError(false); setPartial(false); setStale(false);
    async function load() {
      try {
        const { club } = await api.getClub(clubId, activeSeasonId, attempt > 0);
        if (cancelled) return;
        const initial: ProfileData = { club, fixtures: [], competitions: [], standing: null, leagueTable: [], seasonId: activeSeasonId };
        setData(initial);
        const [catalog, matches] = await Promise.allSettled([api.getCompetitions(activeSeasonId, attempt > 0), api.getClubFixtures(clubId, activeSeasonId, attempt > 0)]);
        if (cancelled) return;
        const competitions = catalog.status === 'fulfilled' ? catalog.value.competitions.filter(c => c.seasonId === activeSeasonId) : [];
        const fixtures = matches.status === 'fulfilled' ? sortSeasonFixtures(matches.value.fixtures.filter(f => f.seasonId === activeSeasonId && (f.homeClubId === clubId || f.awayClubId === clubId))) : [];
        let failed = catalog.status === 'rejected' || matches.status === 'rejected';
        if (matches.status === 'fulfilled') setStale(matches.value.stale || matches.value.degraded);
        setData({ ...initial, competitions, fixtures });
        const league = competitions.find(c => c.type === 'LEAGUE' && c.leagueId === club.leagueId);
        if (league) {
          try {
            const table = await api.getCompetitionStandings(league.id, attempt > 0, activeSeasonId);
            if (cancelled) return;
            setData({ ...initial, competitions, fixtures, leagueTable: table.standings, standing: table.standings.find(r => r.clubId === clubId) || null });
          } catch { failed = true; }
        }
        if (!cancelled) setPartial(failed);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [clubId, activeSeasonId, attempt]);
  const retry = () => setAttempt(n => n + 1);
  if (data) return <PublicClubProfile key={`${clubId}:${activeSeasonId}`} data={data} language={language} onBack={onBack} onOwner={openUserProfile} loading={loading} partial={partial} stale={stale} onRetry={retry} />;
  return <div className="efl-club-profile"><nav className="club-breadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={15} />{labels[language].back}</button></nav>{error ? <div role="alert" className="club-empty"><p>{labels[language].loadError}</p><button type="button" onClick={retry}>{labels[language].retry}</button></div> : <div role="status" className="club-loading"><Loader2 className="animate-spin" /></div>}</div>;
}
