import { CompetitionTrophy } from './CompetitionTrophy';
import { useEffect, useId, useState } from 'react';
import { Award, Crown, Medal, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { useI18n, type Language } from '../i18n';
import { seasonLabel, type PlayerTrophyCabinet as CabinetData, type PlayerTrophy, type ProfileAward } from '../types/trophies';

const copy = {
  uz: {
    title: 'EFL Honours', subtitle: 'Sovrinlar va shaxsiy mavsum mukofotlari', titles: 'Sovrinlar', awards: 'Mavsum awardlari', all: 'Barcha mavsumlar', season: 'Mavsum', champion: 'Chempion', awardHolder: 'Shaxsiy natija', empty: 'Hali sovrin yo‘q. Mavsum awardlari ham shu yerda ko‘rinadi.', loading: 'Sovrinlar yuklanmoqda…', error: 'Sovrinlarni hozir yuklab bo‘lmadi.', retry: 'Qayta urinish', stale: 'Oxirgi saqlangan ma’lumotlar ko‘rsatilmoqda.', countTitles: 'sovrin', countAwards: 'award', clubAward: 'Klub natijasi', noAwards: 'Bu mavsumda shaxsiy award yo‘q.'
  },
  ru: {
    title: 'EFL Honours', subtitle: 'Трофеи и личные награды сезона', titles: 'Трофеи', awards: 'Награды сезона', all: 'Все сезоны', season: 'Сезон', champion: 'Чемпион', awardHolder: 'Личный результат', empty: 'Трофеев и наград пока нет.', loading: 'Загрузка трофеев…', error: 'Не удалось загрузить трофеи.', retry: 'Повторить', stale: 'Показаны последние сохранённые данные.', countTitles: 'трофеев', countAwards: 'наград', clubAward: 'Результат клуба', noAwards: 'Личных наград в этом сезоне нет.'
  },
  en: {
    title: 'EFL Honours', subtitle: 'Trophies and personal season awards', titles: 'Trophies', awards: 'Season awards', all: 'All seasons', season: 'Season', champion: 'Champion', awardHolder: 'Personal result', empty: 'No trophies or awards yet.', loading: 'Loading honours…', error: 'Honours are temporarily unavailable.', retry: 'Retry', stale: 'Showing the last saved data.', countTitles: 'trophies', countAwards: 'awards', clubAward: 'Club result', noAwards: 'No personal awards in this season.'
  },
};

function AwardCard({ award, language }: { award: ProfileAward; language: Language }) {
  const text = copy[language];
  const labels: Record<string, string> = language === 'uz' ? {
    GOLDEN_BALL: 'Oltin to‘p', MOST_WINS: 'Eng ko‘p g‘alaba', MOST_GOALS: 'Eng ko‘p gol', BEST_DEFENCE: 'Eng yaxshi himoya', LONGEST_UNBEATEN: 'Eng uzun mag‘lubiyatsiz seriya', LONGEST_WIN_STREAK: 'Eng uzun g‘alabalar seriyasi',
  } : language === 'ru' ? {
    GOLDEN_BALL: 'Золотой мяч', MOST_WINS: 'Больше всего побед', MOST_GOALS: 'Больше всего голов', BEST_DEFENCE: 'Лучшая защита', LONGEST_UNBEATEN: 'Самая длинная серия без поражений', LONGEST_WIN_STREAK: 'Самая длинная победная серия',
  } : {};
  const units: Record<string, string> = language === 'uz' ? { winner: 'sohibi', wins: 'g‘alaba', goals: 'gol', conceded: 'gol o‘tkazildi', matches: 'o‘yin' } : language === 'ru' ? { winner: 'лауреат', wins: 'побед', goals: 'голов', conceded: 'пропущено', matches: 'матчей' } : {};
  const trophyImage = award.id === 'GOLDEN_BALL' ? '/welcome-awards/golden-ball-photo.png'
    : award.id === 'MOST_GOALS' || award.id === 'GOLDEN_BOOT' ? '/welcome-awards/golden-boot-photo.png'
    : award.id === 'PLAYER_OF_WEEK' || award.id === 'WEEKLY_MVP' || award.id === 'MOTM' ? '/welcome-awards/weekly-motm-photo.png' : null;
  return <article className="efl-honour-award">
    <div className="efl-honour-award-icon">{trophyImage
      ? <img src={trophyImage} alt="" className="efl-honour-award-photo" />
      : <Medal aria-hidden="true" />}</div>
    <div className="efl-honour-award-copy">
      <div className="efl-honour-award-topline"><span>{seasonLabel(award.seasonId)}</span><strong>{award.value} {units[award.unit] || award.unit}</strong></div>
      <h3>{labels[award.id] || award.label}</h3>
      <p>{award.clubName} · {text.clubAward}</p>
    </div>
  </article>;
}

export function TrophyCabinetView({ trophies, awards = [], language, stale = false }: { trophies: PlayerTrophy[]; awards?: ProfileAward[]; language: Language; stale?: boolean }) {
  const text = copy[language];
  const [selectedSeason, setSelectedSeason] = useState('ALL');
  const filterId = useId();
  const seasons = [...new Set([...trophies.map(item => item.seasonId), ...awards.map(item => item.seasonId)])].sort().reverse();
  const filter = seasons.includes(selectedSeason) ? selectedSeason : 'ALL';
  const visibleTrophies = filter === 'ALL' ? trophies : trophies.filter(item => item.seasonId === filter);
  const visibleAwards = filter === 'ALL' ? awards : awards.filter(item => item.seasonId === filter);
  return (
    <section aria-label={text.title} className="efl-honours">
      <header className="efl-honours-header">
        <div className="efl-honours-heading"><div className="efl-honours-mark"><Crown aria-hidden="true" /></div><div><div className="efl-honours-eyebrow"><Sparkles aria-hidden="true" /> EFL PLAYER HONOURS</div><h2>{text.title}</h2><p>{text.subtitle}</p></div></div>
        {seasons.length > 1 && <div className="efl-honours-filter"><label htmlFor={filterId} className="sr-only">{text.season}</label><select id={filterId} value={filter} onChange={event => setSelectedSeason(event.target.value)}><option value="ALL">{text.all}</option>{seasons.map(season => <option key={season} value={season}>{seasonLabel(season)}</option>)}</select></div>}
      </header>
      {stale && <p role="status" className="efl-honours-stale">{text.stale}</p>}
      <div className="efl-honours-summary"><div><Trophy aria-hidden="true" /><strong>{visibleTrophies.length}</strong><span>{text.countTitles}</span></div><div><Award aria-hidden="true" /><strong>{visibleAwards.length}</strong><span>{text.countAwards}</span></div><div className="efl-honours-season"><span>{filter === 'ALL' ? text.all : seasonLabel(filter)}</span><small>{visibleTrophies.length + visibleAwards.length ? text.awardHolder : text.empty}</small></div></div>
      {(visibleTrophies.length > 0 || visibleAwards.length > 0) ? <div className="efl-honours-body">
        {visibleTrophies.length > 0 && <section className="efl-honours-section"><div className="efl-honours-section-title"><span><Trophy aria-hidden="true" />{text.titles}</span><b>{visibleTrophies.length}</b></div><ul className="efl-honours-trophies">{visibleTrophies.map(trophy => <li key={trophy.id} className="efl-honour-trophy"><div className="efl-honour-trophy-art"><CompetitionTrophy competitionId={trophy.competitionId} name={trophy.competitionName} /></div><div className="efl-honour-trophy-copy"><h3>{trophy.competitionName}</h3><p>{seasonLabel(trophy.seasonId)} · <strong>{text.champion}</strong></p><span>{trophy.clubName}</span></div></li>)}</ul></section>}
        {visibleAwards.length > 0 && <section className="efl-honours-section"><div className="efl-honours-section-title"><span><Award aria-hidden="true" />{text.awards}</span><b>{visibleAwards.length}</b></div><div className="efl-honours-awards">{visibleAwards.map(award => <AwardCard key={award.id} award={award} language={language} />)}</div></section>}
      </div> : <div className="efl-honours-empty"><Trophy aria-hidden="true" /><p>{text.empty}</p></div>}
    </section>
  );
}

/** Public; independent of Premium and the player's currently selected club. */
function RemoteTrophyCabinet({ subjectId, kind, seasonId = 'season-2026-27' }: { subjectId: string; kind: 'player' | 'club'; seasonId?: string }) {
  const { language } = useI18n();
  const text = copy[language];
  const [state, setState] = useState<{ subjectId: string; seasonId: string; data?: CabinetData; error?: boolean }>({ subjectId, seasonId });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ subjectId, seasonId });
    void fetch(`/api/insights/${kind}/${encodeURIComponent(subjectId)}/trophies?seasonId=${encodeURIComponent(seasonId)}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async response => { if (!response.ok) throw new Error('HONOURS_UNAVAILABLE'); const data: CabinetData = await response.json(); if (!Array.isArray(data.trophies)) throw new Error('INVALID_HONOURS'); if (!controller.signal.aborted) setState({ subjectId, seasonId, data: { ...data, awards: Array.isArray(data.awards) ? data.awards : [] } }); })
      .catch(() => { if (!controller.signal.aborted) setState({ subjectId, seasonId, error: true }); });
    return () => controller.abort();
  }, [subjectId, kind, seasonId, retry]);
  const current = state.subjectId === subjectId && state.seasonId === seasonId;
  if (current && state.data) return <TrophyCabinetView key={`${kind}:${subjectId}`} trophies={state.data.trophies} awards={state.data.awards} language={language} stale={state.data.stale} />;
  return <section aria-label={text.title} className="efl-honours efl-honours-status">{current && state.error ? <div role="alert" className="efl-honours-status-row"><span>{text.error}</span><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw aria-hidden="true" />{text.retry}</button></div> : <p role="status">{text.loading}</p>}</section>;
}

export function PlayerTrophyCabinet({ userId, seasonId }: { userId: string; seasonId?: string }) { return <RemoteTrophyCabinet key={`player:${userId}`} subjectId={userId} kind="player" seasonId={seasonId} />; }
export function ClubTrophyCabinet({ clubId, seasonId }: { clubId: string; seasonId?: string }) { return <RemoteTrophyCabinet key={`club:${clubId}`} subjectId={clubId} kind="club" seasonId={seasonId} />; }
