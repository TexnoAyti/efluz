import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronRight, CircleHelp, Clock3, Layers3, LockKeyhole, RefreshCw, Search, Swords, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture } from '../types';
import { ClubCrest } from './ClubCrest';

interface Props {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
}

const leagueCards = [
  { id: 'premier-league', name: 'Premier League', country: 'Angliya', clubs: 20, mark: 'PL', tone: 'indigo' },
  { id: 'la-liga', name: 'La Liga', country: 'Ispaniya', clubs: 20, mark: 'LL', tone: 'coral' },
  { id: 'serie-a', name: 'Serie A', country: 'Italiya', clubs: 20, mark: 'SA', tone: 'blue' },
  { id: 'bundesliga', name: 'Bundesliga', country: 'Germaniya', clubs: 18, mark: 'BL', tone: 'red' },
  { id: 'ligue-1', name: 'Ligue 1', country: 'Fransiya', clubs: 18, mark: 'L1', tone: 'teal' },
] as const;

const copy = {
  uz: {
    eyebrow: 'EFOOTBALL · 2026/27', greeting: 'Salom', subtitle: 'O‘yinlaringiz va turnir holati bir joyda.',
    next: 'KEYINGI UCHRASHUV', empty: 'Hozircha o‘yin belgilanmagan', emptyHint: 'Klubingizni tanlang yoki o‘yinlar jadvalini ko‘ring.',
    matchCenter: 'Match Center', submit: 'Natijani kiritish', locked: 'Tur hali ochilmagan',
    pending: 'Tasdiq kutilmoqda', disputed: 'Nizo ko‘rib chiqilmoqda', ready: 'O‘ynashga tayyor',
    matchday: 'tur', myClub: 'Mening klubim', matches: 'O‘yinlar', allMatches: 'Barcha o‘yinlar',
    noMatches: 'Boshqa yaqinlashayotgan o‘yinlar yo‘q.', result: 'SO‘NGGI NATIJA', noResult: 'Tasdiqlangan natija yo‘q.',
    season: 'MAVSUM KO‘RSATKICHLARI', position: 'O‘rin', points: 'Ochko', played: 'O‘yin', form: 'G‘–D–M',
    leagues: 'Ligalar', leaguesHint: 'Klub va jadvalni ko‘ring', clubs: 'klub',
    table: 'Jadval', cups: 'Kuboklar', calendar: 'Mavsum', explore: 'Ko‘rish',
    upcoming: 'Kelgusi', results: 'Natijalar', searchClubs: 'Klub qidirish',
    retry: 'Qayta urinish', loadError: 'Ma’lumotni yuklab bo‘lmadi.', chooseClub: 'Klub tanlash',
  },
  ru: {
    eyebrow: 'EFOOTBALL · 2026/27', greeting: 'Привет', subtitle: 'Ваши матчи и сезон в одном месте.',
    next: 'СЛЕДУЮЩИЙ МАТЧ', empty: 'Матч пока не назначен', emptyHint: 'Выберите клуб или откройте расписание.',
    matchCenter: 'Центр матча', submit: 'Ввести результат', locked: 'Тур ещё закрыт',
    pending: 'Ожидает подтверждения', disputed: 'Спор на рассмотрении', ready: 'Готов к игре',
    matchday: 'тур', myClub: 'Мой клуб', matches: 'Матчи', allMatches: 'Все матчи',
    noMatches: 'Других ближайших матчей нет.', result: 'ПОСЛЕДНИЙ РЕЗУЛЬТАТ', noResult: 'Подтверждённых результатов нет.',
    season: 'СТАТИСТИКА СЕЗОНА', position: 'Место', points: 'Очки', played: 'Матчи', form: 'В–Н–П',
    leagues: 'Лиги', leaguesHint: 'Клубы и таблицы', clubs: 'клубов',
    table: 'Таблица', cups: 'Кубки', calendar: 'Сезон', explore: 'Открыть',
    upcoming: 'Предстоящие', results: 'Результаты', searchClubs: 'Найти клуб',
    retry: 'Повторить', loadError: 'Не удалось загрузить данные.', chooseClub: 'Выбрать клуб',
  },
  en: {
    eyebrow: 'EFOOTBALL · 2026/27', greeting: 'Hello', subtitle: 'Your matches and season in one place.',
    next: 'NEXT MATCH', empty: 'No match scheduled yet', emptyHint: 'Choose a club or explore the fixture list.',
    matchCenter: 'Match Center', submit: 'Enter result', locked: 'Matchday is locked',
    pending: 'Awaiting confirmation', disputed: 'Dispute under review', ready: 'Ready to play',
    matchday: 'Matchday', myClub: 'My club', matches: 'Matches', allMatches: 'All matches',
    noMatches: 'No other upcoming matches.', result: 'LATEST RESULT', noResult: 'No confirmed results yet.',
    season: 'SEASON SNAPSHOT', position: 'Position', points: 'Points', played: 'Played', form: 'W–D–L',
    leagues: 'Leagues', leaguesHint: 'Browse clubs and tables', clubs: 'clubs',
    table: 'Table', cups: 'Cups', calendar: 'Season', explore: 'Explore',
    upcoming: 'Upcoming', results: 'Results', searchClubs: 'Find a club',
    retry: 'Retry', loadError: 'Could not load data.', chooseClub: 'Choose a club',
  },
};

function clubName(fixture: Fixture, side: 'home' | 'away') {
  const club = side === 'home' ? fixture.homeClub : fixture.awayClub;
  return club?.shortName || club?.name || (side === 'home' ? fixture.homeClubId : fixture.awayClubId) || 'TBD';
}

function matchLabel(fixture: Fixture, matchday: string) {
  return fixture.roundName || `${matchday} ${fixture.matchday}`;
}

export const MatchdayHomeView: React.FC<Props> = ({ onNavigateTab, onSelectFixtureForMatchCenter }) => {
  const { user, currentClub, ownedClubs, activeSeasonId, userStats } = useAuth();
  const { language } = useI18n();
  const c = copy[language] || copy.uz;
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [matchFilter, setMatchFilter] = useState<'upcoming' | 'results'>('upcoming');

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.getMyMatches(activeSeasonId);
      setFixtures(result.fixtures || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [activeSeasonId, user?.id, ownedClubs.map((club) => club.id).join(',')]);

  const pending = useMemo(() => fixtures.filter((fixture) => fixture.status !== 'CONFIRMED' && fixture.status !== 'CANCELLED'), [fixtures]);
  const featured = pending.find((fixture) => fixture.isPlayable !== false && fixture.status === 'SCHEDULED') || pending[0];
  const otherMatches = pending.filter((fixture) => fixture.id !== featured?.id).slice(0, 3);
  const confirmed = useMemo(() => [...fixtures].filter((fixture) => fixture.status === 'CONFIRMED').reverse(), [fixtures]);
  const lastResult = confirmed[0];
  const listedMatches = matchFilter === 'upcoming' ? otherMatches : confirmed.slice(0, 4);

  const openMatch = (fixture: Fixture) => {
    onSelectFixtureForMatchCenter?.(fixture);
    onNavigateTab('my-matches');
  };

  const openLeague = (leagueId: string, tab: 'CLUBS' | 'STANDINGS' = 'CLUBS') => {
    try {
      sessionStorage.setItem('efl:preview-league', `league-${leagueId}`);
      sessionStorage.setItem('efl:preview-league-tab', tab);
    } catch { /* storage may be unavailable in a WebView */ }
    onNavigateTab('leagues');
  };

  const openClubSearch = () => {
    try { sessionStorage.setItem('efl:preview-club-search', '1'); } catch { /* storage may be unavailable in a WebView */ }
    onNavigateTab('leagues');
  };

  const dateLabel = (fixture: Fixture) => {
    if (!fixture.scheduledAt) return matchLabel(fixture, c.matchday);
    const date = new Date(fixture.scheduledAt);
    return Number.isNaN(date.getTime()) || date.getFullYear() < 2026 ? matchLabel(fixture, c.matchday) : new Intl.DateTimeFormat(language === 'uz' ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  };

  return (
    <div className="matchday-home space-y-6 pb-24">
      <div className="flex items-end justify-between gap-3 pt-1">
        <div>
          <div className="matchday-kicker">{c.eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white">{c.greeting}, {user?.firstName || user?.username || 'Player'}<span className="text-emerald-300">.</span></h1>
          <p className="mt-1 text-sm text-slate-400">{c.subtitle}</p>
        </div>
        <button type="button" onClick={openClubSearch} aria-label={c.searchClubs} className="matchday-search-button"><Search className="w-5 h-5" /></button>
      </div>

      {error && <div className="preview-surface flex items-center justify-between gap-3 p-4 text-sm text-rose-200"><span>{c.loadError}</span><button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 font-bold text-white"><RefreshCw className="w-4 h-4" />{c.retry}</button></div>}

      <section aria-label={c.next} className="matchday-featured">
        <div className="relative z-10 flex items-center justify-between gap-3">
          <span className="matchday-kicker !text-rose-100/80">{c.next}</span>
          {featured && <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black text-white backdrop-blur-sm">{featured.competitionName || 'EFL UZ'} · {matchLabel(featured, c.matchday)}</span>}
        </div>
        {loading && fixtures.length === 0 ? (
          <div role="status" aria-label={c.next} className="relative z-10 mt-7 space-y-6 animate-pulse">
            <div className="mx-auto h-20 w-4/5 rounded-2xl bg-white/15" />
            <div className="h-11 w-full rounded-full bg-white/20" />
          </div>
        ) : featured ? (
          <>
            <div className="relative z-10 mt-7 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
              <div className="min-w-0 flex flex-col items-center gap-3"><div className="matchday-crest"><ClubCrest clubId={featured.homeClubId || undefined} logoUrl={featured.homeClub?.logoUrl} name={featured.homeClub?.name} shortName={featured.homeClub?.shortName} size="xl" className="w-16 h-16" /></div><span className="w-full truncate text-sm font-black text-white">{clubName(featured, 'home')}</span></div>
              <div className="min-w-[86px]"><div className="text-2xl sm:text-3xl font-black tracking-tight text-white">VS</div><div className="mt-1 text-[10px] font-bold text-rose-100/80">{dateLabel(featured)}</div></div>
              <div className="min-w-0 flex flex-col items-center gap-3"><div className="matchday-crest"><ClubCrest clubId={featured.awayClubId || undefined} logoUrl={featured.awayClub?.logoUrl} name={featured.awayClub?.name} shortName={featured.awayClub?.shortName} size="xl" className="w-16 h-16" /></div><span className="w-full truncate text-sm font-black text-white">{clubName(featured, 'away')}</span></div>
            </div>
            <div className="relative z-10 mt-6 flex items-center justify-between gap-2 border-t border-white/20 pt-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/90">{featured.isPlayable === false ? <LockKeyhole className="w-3.5 h-3.5" /> : featured.status === 'SCHEDULED' ? <Swords className="w-3.5 h-3.5" /> : <Clock3 className="w-3.5 h-3.5" />}{featured.isPlayable === false ? c.locked : featured.status === 'PENDING_CONFIRMATION' ? c.pending : featured.status === 'DISPUTED' ? c.disputed : c.ready}</span>
              <button type="button" onClick={() => openMatch(featured)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-[#131b2d] shadow-lg shadow-black/10">{featured.isPlayable === false ? c.matchCenter : featured.status === 'SCHEDULED' ? c.submit : c.matchCenter}<ArrowRight className="w-4 h-4" /></button>
            </div>
          </>
        ) : (
          <div className="relative z-10 mt-8"><h2 className="text-xl font-black text-white">{c.empty}</h2><p className="mt-1 text-sm text-rose-100/80">{currentClub ? c.noMatches : c.emptyHint}</p><button type="button" onClick={() => onNavigateTab(currentClub ? 'my-matches' : 'leagues')} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-xs font-black text-[#131b2d]">{currentClub ? c.allMatches : c.chooseClub}<ArrowRight className="w-4 h-4" /></button></div>
        )}
      </section>

      {ownedClubs.length > 0 && <section aria-label={c.myClub} className="preview-surface flex items-center gap-3 p-3.5 sm:p-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06]"><ClubCrest clubId={currentClub?.id} logoUrl={currentClub?.logoUrl} name={currentClub?.name} shortName={currentClub?.shortName} size="md" /></div><div className="min-w-0 flex-1"><div className="matchday-kicker">{c.myClub}</div><div className="mt-0.5 truncate text-sm font-black text-white">{currentClub?.name || ownedClubs[0].name}</div></div>{ownedClubs.length > 1 && <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-300">+{ownedClubs.length - 1}</span>}<button type="button" onClick={() => onNavigateTab('my-club')} aria-label={c.myClub} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"><ChevronRight className="h-5 w-5" /></button></section>}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="preview-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-5"><div><div className="matchday-kicker">{c.matches}</div><h2 className="mt-1 text-base font-black text-white">{c.allMatches}</h2></div><button type="button" onClick={() => onNavigateTab('my-matches')} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300">{c.explore}<ChevronRight className="w-4 h-4" /></button></div>
          <div className="flex gap-2 px-4 pt-3 sm:px-5" role="group" aria-label={c.matches}>
            {(['upcoming', 'results'] as const).map((filter) => <button key={filter} type="button" aria-pressed={matchFilter === filter} onClick={() => setMatchFilter(filter)} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${matchFilter === filter ? 'bg-emerald-300 text-slate-950' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.12]'}`}>{c[filter]}</button>)}
          </div>
          <div className="divide-y divide-white/[0.06]">
            {listedMatches.length ? listedMatches.map((fixture) => <button type="button" key={fixture.id} onClick={() => openMatch(fixture)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04] sm:px-5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><Swords className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-white">{clubName(fixture, 'home')} <span className="mx-1 text-slate-500">{fixture.status === 'CONFIRMED' ? `${fixture.homeScore} : ${fixture.awayScore}` : 'vs'}</span> {clubName(fixture, 'away')}</div><div className="mt-1 truncate text-[10px] text-slate-400">{fixture.competitionName || 'EFL UZ'} · {matchLabel(fixture, c.matchday)}</div></div><span className="shrink-0 text-[10px] font-bold text-slate-400">{dateLabel(fixture)}</span></button>) : <p className="px-5 py-6 text-xs text-slate-400">{loading ? '…' : matchFilter === 'results' ? c.noResult : c.noMatches}</p>}
          </div>
        </section>
        <section className="preview-surface p-4 sm:p-5"><div className="matchday-kicker">{c.season}</div><div className="mt-4 grid grid-cols-4 gap-2"><div className="matchday-stat"><span>{c.position}</span><strong>{userStats?.leaguePosition ? `#${userStats.leaguePosition}` : '—'}</strong></div><div className="matchday-stat"><span>{c.points}</span><strong>{userStats?.points ?? '—'}</strong></div><div className="matchday-stat"><span>{c.played}</span><strong>{userStats?.matchesPlayed ?? '—'}</strong></div><div className="matchday-stat"><span>{c.form}</span><strong className="!text-emerald-300">{userStats ? `${userStats.wins}–${userStats.draws}–${userStats.losses}` : '—'}</strong></div></div><div className="mt-5 border-t border-white/[0.07] pt-4"><div className="matchday-kicker">{c.result}</div>{lastResult ? <button type="button" onClick={() => openMatch(lastResult)} className="mt-3 flex w-full items-center gap-2 text-left"><span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-200">{clubName(lastResult, 'home')} · {clubName(lastResult, 'away')}</span><span className="shrink-0 rounded-lg bg-white/[0.07] px-2 py-1 text-sm font-black text-white">{lastResult.homeScore} : {lastResult.awayScore}</span><ChevronRight className="h-4 w-4 text-slate-500" /></button> : <p className="mt-3 text-xs text-slate-400">{c.noResult}</p>}</div></section>
      </div>

      <section><div className="mb-3 flex items-end justify-between"><div><div className="matchday-kicker">EFL UZ · 2026/27</div><h2 className="mt-1 text-lg font-black text-white">{c.leagues}</h2><p className="text-xs text-slate-400">{c.leaguesHint}</p></div><button type="button" onClick={() => onNavigateTab('leagues')} className="text-xs font-bold text-emerald-300">{c.explore} →</button></div><div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">{leagueCards.map((league) => <button key={league.id} type="button" onClick={() => openLeague(league.id)} className={`matchday-league-card tone-${league.tone}`}><span className="matchday-league-mark">{league.mark}</span><span className="mt-3 block truncate text-sm font-black text-white">{league.name}</span><span className="mt-1 block text-[11px] text-white/70">{league.country} · {league.clubs} {c.clubs}</span><span className="absolute right-3 top-3 text-white/50"><ChevronRight className="h-4 w-4" /></span></button>)}</div></section>

      <div className="grid grid-cols-3 gap-2.5"><button type="button" onClick={() => openLeague((currentClub?.leagueId || 'league-premier-league').replace(/^league-/, ''), 'STANDINGS')} className="matchday-quick"><Trophy className="h-5 w-5 text-amber-300" /><span>{c.table}</span></button><button type="button" onClick={() => onNavigateTab('cups')} className="matchday-quick"><Layers3 className="h-5 w-5 text-rose-300" /><span>{c.cups}</span></button><button type="button" onClick={() => onNavigateTab('season-hub')} className="matchday-quick"><CalendarDays className="h-5 w-5 text-sky-300" /><span>{c.calendar}</span></button></div>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><CircleHelp className="h-3.5 w-3.5" />eFootball {language === 'uz' ? 'o‘yinini o‘ynang, so‘ng natijani Match Center orqali yuboring.' : language === 'ru' ? 'сыграйте матч и внесите результат в Центре матча.' : 'matches are played first; submit the result in Match Center.'}</p>
    </div>
  );
};
