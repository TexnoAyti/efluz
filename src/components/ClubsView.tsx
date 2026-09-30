import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api, type ClubAdmissionStatus } from '../lib/api';
import { premiumApi } from '../lib/premiumApi';
import { League, Club, Fixture, StandingsRow, Competition } from '../types';
import { ClubCrest } from './ClubCrest';
import { PremiumClubBadge } from './PremiumClubBadge';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import confetti from 'canvas-confetti';
import {
  Shield,
  Search,
  CheckCircle2,
  Lock,
  MapPin,
  Sparkles,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Trophy,
  Swords,
  ExternalLink,
  Users,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
} from 'lucide-react';
import { ResultSubmissionModal } from './ResultSubmissionModal';

interface ClubsViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const ClubsView: React.FC<ClubsViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, ownedClubs, activeSeasonId, refreshUserData, showToast } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { t, language } = useI18n();
  const previewText = {
    uz: { domestic: 'Milliy ligalar', cups: 'Milliy kuboklar', refresh: 'Yangilash', tier: 'Daraja', active: 'Faol', clubs: 'Klublar', matches: 'O‘yinlar', standings: 'Jadval', available: 'Bo‘sh', claimed: 'Tanlangan', matchday: 'Tur', emptyFixtures: 'Bu turda o‘yin yo‘q.', emptyStandings: 'Jadval hali shakllanmagan.' },
    ru: { domestic: 'Национальные лиги', cups: 'Национальные кубки', refresh: 'Обновить', tier: 'Уровень', active: 'Активен', clubs: 'Клубы', matches: 'Матчи', standings: 'Таблица', available: 'Свободно', claimed: 'Занято', matchday: 'Тур', emptyFixtures: 'В этом туре матчей нет.', emptyStandings: 'Таблица пока не сформирована.' },
    en: { domestic: 'Domestic Leagues', cups: 'National Cups', refresh: 'Refresh', tier: 'Tier', active: 'Active', clubs: 'Clubs', matches: 'Matches', standings: 'Standings', available: 'Available', claimed: 'Claimed', matchday: 'Matchday', emptyFixtures: 'No fixtures scheduled for this matchday.', emptyStandings: 'Standings are not available yet.' },
  }[language] || { domestic: 'Milliy ligalar', cups: 'Milliy kuboklar', refresh: 'Yangilash', tier: 'Daraja', active: 'Faol', clubs: 'Klublar', matches: 'O‘yinlar', standings: 'Jadval', available: 'Bo‘sh', claimed: 'Tanlangan', matchday: 'Tur', emptyFixtures: 'Bu turda o‘yin yo‘q.', emptyStandings: 'Jadval hali shakllanmagan.' };
  const admissionText = {
    uz: { unavailable: 'Klub qabuli holatini yuklab bo‘lmadi.', checking: 'Klub qabuli tekshirilmoqda…', open: 'Klub tanlash ochiq.', leagueOpen: 'Bu ligada klub qabuli ochiq.', otherLeague: (name: string) => `Hozir ${name} klublari qabul qilinmoqda. Bu liga navbatda yoki yopilgan.`, finished: 'Klub qabuli yakunlangan.', retry: 'Qayta urinish', closed: 'Qabul yopiq' },
    ru: { unavailable: 'Не удалось загрузить статус приёма.', checking: 'Проверяем приём клубов…', open: 'Выбор клуба открыт.', leagueOpen: 'Приём клубов этой лиги открыт.', otherLeague: (name: string) => `Сейчас принимаются клубы лиги ${name}. Эта лига ожидает очереди или уже закрыта.`, finished: 'Приём клубов завершён.', retry: 'Повторить', closed: 'Приём закрыт' },
    en: { unavailable: 'Could not load club admission status.', checking: 'Checking club admission…', open: 'Club selection is open.', leagueOpen: 'Club selection is open for this league.', otherLeague: (name: string) => `Currently accepting ${name} clubs. This league is waiting or closed.`, finished: 'Club admission has ended.', retry: 'Retry', closed: 'Admission closed' },
  }[language] || { unavailable: 'Klub qabuli holatini yuklab bo‘lmadi.', checking: 'Klub qabuli tekshirilmoqda…', open: 'Klub tanlash ochiq.', leagueOpen: 'Bu ligada klub qabuli ochiq.', otherLeague: (name: string) => `Hozir ${name} klublari qabul qilinmoqda. Bu liga navbatda yoki yopilgan.`, finished: 'Klub qabuli yakunlangan.', retry: 'Qayta urinish', closed: 'Qabul yopiq' };

  // League & Data states
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(() => {
    try { return user?.isAdmin && sessionStorage.getItem('efl:preview-league') || 'league-premier-league'; } catch { return 'league-premier-league'; }
  });
  const [activeLeagueTab, setActiveLeagueTab] = useState<'CLUBS' | 'MATCHES' | 'STANDINGS'>(() => {
    if (!user?.isAdmin) return 'CLUBS';
    try {
      const target = sessionStorage.getItem('efl:preview-league-tab');
      sessionStorage.removeItem('efl:preview-league-tab');
      return target === 'STANDINGS' || target === 'MATCHES' ? target : 'CLUBS';
    } catch { return 'CLUBS'; }
  });

  // Clubs state
  const [clubs, setClubs] = useState<Club[]>([]);
  const [admission, setAdmission] = useState<ClubAdmissionStatus | null>(null);
  const [admissionError, setAdmissionError] = useState(false);
  const loadAdmission = useCallback(async () => {
    try {
      const result = await api.getClubAdmission(activeSeasonId);
      setAdmission(result.admission);
      setAdmissionError(false);
    } catch {
      setAdmission(null);
      setAdmissionError(true);
    }
  }, [activeSeasonId]);
  useEffect(() => {
    setAdmission(null);
    void loadAdmission();
    window.addEventListener('focus', loadAdmission);
    return () => window.removeEventListener('focus', loadAdmission);
  }, [loadAdmission]);
  const [premiumActive, setPremiumActive] = useState(false);
  const [premiumStatusReady, setPremiumStatusReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    setPremiumStatusReady(false);
    if (!user?.isAdmin) { setPremiumActive(false); setPremiumStatusReady(true); return; }
    premiumApi.getMyStatus(activeSeasonId).then((status) => {
      if (mounted) setPremiumActive(status.active);
    }).catch(() => {
      if (mounted) setPremiumActive(false);
    }).finally(() => { if (mounted) setPremiumStatusReady(true); });
    return () => { mounted = false; };
  }, [user?.id, user?.isAdmin, activeSeasonId]);
  const [isLoadingClubs, setIsLoadingClubs] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'AVAILABLE' | 'CLAIMED'>('ALL');

  useEffect(() => {
    if (!user?.isAdmin) return;
    try {
      if (sessionStorage.getItem('efl:preview-club-search') !== '1') return;
      sessionStorage.removeItem('efl:preview-club-search');
      setActiveLeagueTab('CLUBS');
      window.requestAnimationFrame(() => searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      // A WebView may hide the focused input behind its software keyboard.
      window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 300);
    } catch { /* storage may be unavailable in a WebView */ }
  }, [user?.isAdmin]);

  // Competition Fixtures & Standings state for the selected league
  const [leagueCompetitions, setLeagueCompetitions] = useState<Competition[]>([]);
  const [leagueFixtures, setLeagueFixtures] = useState<Fixture[]>([]);
  const [leagueStandings, setLeagueStandings] = useState<StandingsRow[]>([]);
  const [selectedMatchday, setSelectedMatchday] = useState<number>(1);
  const [selectedFixtureForModal, setSelectedFixtureForModal] = useState<Fixture | null>(null);
  const [isLoadingFixtures, setIsLoadingFixtures] = useState(false);
  const [isLoadingStandings, setIsLoadingStandings] = useState(false);

  // Global Error state
  const [error, setError] = useState<{ message: string; isQuota?: boolean } | null>(null);

  // Claim modal state
  const [clubToClaim, setClubToClaim] = useState<Club | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);
  const [membershipModal, setMembershipModal] = useState<{
    open: boolean;
    groupUsername: string;
    groupUrl: string;
    message?: string;
    pendingClub?: Club;
  } | null>(null);

  // 1. Load clubs for selected league
  const loadClubsForLeague = useCallback(async (leagueId: string, forceRefresh = false) => {
    if (!leagueId) return;
    setIsLoadingClubs(true);
    setError(null);
    try {
      const res = await api.getLeagueClubs(leagueId, activeSeasonId, forceRefresh);
      if (res.clubs && res.clubs.length > 0) {
        setClubs(res.clubs);
      } else if (clubs.length === 0) {
        setClubs([]);
      }
    } catch (err: any) {
      console.error('Failed to load clubs:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.isQuota ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: "Couldn't load data. Please try again.",
        isQuota,
      });
      // Do not wipe out existing clubs if we have them cached
    } finally {
      setIsLoadingClubs(false);
    }
  }, [activeSeasonId, clubs.length]);

  // 2. Load fixtures & standings for selected league on demand
  const loadLeagueStandings = useCallback(async (leagueId: string, compsList?: Competition[]) => {
    const list = compsList || leagueCompetitions;
    const matchingComp = list.find((c) => c.leagueId === leagueId && c.type === 'LEAGUE');
    if (!matchingComp) return;

    setIsLoadingStandings(true);
    try {
      const standRes = await api.getCompetitionStandings(matchingComp.id);
      if (standRes.standings && standRes.standings.length > 0) {
        setLeagueStandings(standRes.standings);
      }
    } catch (err) {
      console.error('Failed to load league standings:', err);
    } finally {
      setIsLoadingStandings(false);
    }
  }, [leagueCompetitions]);

  const loadLeagueFixtures = useCallback(async (leagueId: string, matchday?: number, compsList?: Competition[]) => {
    const list = compsList || leagueCompetitions;
    const matchingComp = list.find((c) => c.leagueId === leagueId && c.type === 'LEAGUE');
    if (!matchingComp) return;

    setIsLoadingFixtures(true);
    try {
      const targetMd = matchday ?? selectedMatchday;
      const fixRes = await api.getCompetitionFixtures(matchingComp.id, targetMd);
      if (fixRes.fixtures) {
        setLeagueFixtures(fixRes.fixtures);
      }
    } catch (err) {
      console.error('Failed to load league fixtures:', err);
    } finally {
      setIsLoadingFixtures(false);
    }
  }, [leagueCompetitions, selectedMatchday]);

  // 3. Load all 5 domestic leagues & competitions list
  const loadLeaguesAndComps = useCallback(async () => {
    setError(null);
    try {
      const [leaguesRes, compsRes] = await Promise.all([
        api.getLeagues(),
        api.getCompetitions(activeSeasonId).catch(() => ({ competitions: [] })),
      ]);

      const domesticLeagues = leaguesRes.leagues || [];
      if (domesticLeagues.length > 0) {
        setLeagues(domesticLeagues);
      }
      if (compsRes.competitions && compsRes.competitions.length > 0) {
        setLeagueCompetitions(compsRes.competitions);
      }

      if (domesticLeagues.length > 0) {
        setSelectedLeagueId((prev) => {
          const exists = domesticLeagues.some((l) => l.id === prev);
          const target = exists ? prev : domesticLeagues[0].id;
          loadClubsForLeague(target);
          return target;
        });
      }
    } catch (err: any) {
      console.error('Failed to load leagues:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.isQuota ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: "Couldn't load data. Please try again.",
        isQuota,
      });
    }
  }, [activeSeasonId, loadClubsForLeague]);

  useEffect(() => {
    loadLeaguesAndComps();
  }, [loadLeaguesAndComps]);

  // Load tab-specific data when tab or league changes
  useEffect(() => {
    if (activeLeagueTab === 'MATCHES') {
      loadLeagueFixtures(selectedLeagueId, selectedMatchday);
    } else if (activeLeagueTab === 'STANDINGS') {
      loadLeagueStandings(selectedLeagueId);
    }
  }, [activeLeagueTab, selectedLeagueId, selectedMatchday, loadLeagueFixtures, loadLeagueStandings]);

  const handleSelectLeague = (leagueId: string) => {
    setSelectedLeagueId(leagueId);
    if (user?.isAdmin) try { sessionStorage.setItem('efl:preview-league', leagueId); } catch { /* storage may be unavailable in a WebView */ }
    loadClubsForLeague(leagueId);
    if (activeLeagueTab === 'MATCHES') {
      loadLeagueFixtures(leagueId, selectedMatchday);
    } else if (activeLeagueTab === 'STANDINGS') {
      loadLeagueStandings(leagueId);
    }
  };

  const handleClaimClub = async (targetClub?: Club) => {
    const club = targetClub || clubToClaim;
    const clubId = club?.id;
    if (!club || !clubId || clubId === 'undefined' || clubId === 'null' || !clubId.startsWith('club-')) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[ClubsView] Attempted to claim club with invalid ID:', clubId, club);
      }
      showToast('Yaroqsiz klub tanlandi. Iltimos, qaytadan urinib ko‘ring.', 'error');
      setClubToClaim(null);
      return;
    }
    if (!admission || admission.enabled && admission.activeLeagueId !== club.leagueId) {
      showToast(admissionText.closed, 'error');
      setClubToClaim(null);
      return;
    }
    if (ownedClubs.some((owned) => owned.leagueId === club.leagueId) || ownedClubs.length >= (premiumActive ? 2 : 1) || !premiumStatusReady) {
      showToast(ownedClubs.some((owned) => owned.leagueId === club.leagueId) ? 'Bitta ligadan faqat bitta klub tanlash mumkin.' : t.alreadyHaveClubMessage, 'error');
      setClubToClaim(null);
      return;
    }
    setIsClaiming(true);
    try {
      const res = await api.claimClub(clubId, activeSeasonId);
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
      });
      showToast(res.message || t.claimSuccess, 'success');
      setClubToClaim(null);
      setMembershipModal(null);
      await refreshUserData();
      await loadClubsForLeague(selectedLeagueId);
    } catch (err: any) {
      if (err.data?.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED' || err.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED') {
        const groupUsername = err.data?.groupUsername || '@efleagueuz';
        const groupUrl = err.data?.groupUrl || 'https://t.me/efleagueuz';
        const msg = err.data?.message || err.message || "Klub tanlash uchun avval @efleagueuz Telegram guruhiga a'zo bo'lishingiz lozim.";
        setMembershipModal({
          open: true,
          groupUsername,
          groupUrl,
          message: msg,
          pendingClub: club,
        });
        showToast(msg, 'error');
        return;
      }
      if (err.data?.code === 'CLUB_ADMISSION_CLOSED') void loadAdmission();
      const msg = err.data?.message || err.message || 'Failed to claim club.';
      showToast(msg, 'error');
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCheckMembershipAndClaim = async () => {
    const targetClub = membershipModal?.pendingClub || clubToClaim;
    setIsCheckingMembership(true);
    try {
      // 1. Force fresh Telegram check
      const checkRes = await api.checkTelegramMembership();
      if (checkRes.isMember) {
        // 2. When fresh result becomes member, automatically retry the original pending club claim
        setMembershipModal(null);
        if (targetClub) {
          await handleClaimClub(targetClub);
        } else {
          showToast("A'zolik tasdiqlandi! Endi klubingizni tanlashingiz mumkin.", 'success');
        }
      } else {
        showToast("Siz hali @efleagueuz guruhiga a'zo bo'lmadingiz. Iltimos, avval guruhga a'zo bo'ling va yana tekshiring.", 'error');
      }
    } catch (err: any) {
      const msg = err.data?.message || err.message || "A'zolikni tekshirishda xatolik yuz berdi.";
      showToast(msg, 'error');
    } finally {
      setIsCheckingMembership(false);
    }
  };

  const isClubTaken = (c: typeof clubs[0]) =>
    Boolean(c.isTaken || c.claimedByUserId || c.occupancy?.status === 'occupied' || c.occupancy?.status === 'owned');

  const filteredClubs = clubs.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.shortName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.stadium && c.stadium.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === 'AVAILABLE') return !isClubTaken(c);
    if (filterMode === 'CLAIMED') return isClubTaken(c);
    return true;
  });

  const availableCount = clubs.filter((c) => !isClubTaken(c)).length;
  const claimedCount = clubs.filter((c) => isClubTaken(c)).length;

  const currentLeague = leagues.find((l) => l.id === selectedLeagueId) || leagues[0];

  // Group fixtures by matchday
  const currentComp = leagueCompetitions.find((c) => c.leagueId === selectedLeagueId && c.type === 'LEAGUE');
  const totalLeagueMatchdays = currentComp?.totalMatchdays || (selectedLeagueId.includes('bundesliga') || selectedLeagueId.includes('ligue-1') ? 17 : 19);
  const matchdays: number[] = Array.from({ length: totalLeagueMatchdays }, (_, i) => i + 1);
  const currentMatchdayFixtures = leagueFixtures.filter((f) => (Number(f.matchday) || 1) === selectedMatchday);

  const isPLOrLL = selectedLeagueId.includes('premier-league') || selectedLeagueId.includes('la-liga');
  const uclThreshold = isPLOrLL ? 7 : 6;
  const uelThreshold = isPLOrLL ? 14 : 12;
  const relThreshold = selectedLeagueId.includes('bundesliga') || selectedLeagueId.includes('ligue-1') ? 16 : 18;

  const getPositionStyle = (position: number) => {
    if (position <= uclThreshold) {
      return {
        badgeColor: 'bg-blue-500/20 text-blue-400 efl-theme-blue border-blue-500/30',
        barColor: 'bg-blue-500',
        label: t.uclZone,
      };
    }
    if (position <= uelThreshold) {
      return {
        badgeColor: 'bg-indigo-500/20 text-indigo-400 efl-theme-indigo border-indigo-500/30',
        barColor: 'bg-indigo-500',
        label: t.uelZone,
      };
    }
    if (position >= relThreshold) {
      return {
        badgeColor: 'bg-rose-500/20 text-rose-400 efl-theme-rose border-rose-500/30',
        barColor: 'bg-rose-500',
        label: t.relegationZone,
      };
    }
    return {
      badgeColor: 'bg-slate-800 efl-theme-surface-2 text-slate-400 efl-theme-text-2 border-slate-700',
      barColor: 'bg-transparent',
      label: '',
    };
  };



  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Category Quick Switcher Hub (Legacy Normal Players only) */}
      {!user?.isAdmin && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black btn-glass-primary text-slate-950 shadow-md min-h-[36px]"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Domestic Leagues</span>
          </button>
          {onNavigateTab && (
            <>
              <button
                onClick={() => onNavigateTab('cups')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 efl-theme-text-2 hover:text-white efl-theme-hover-text min-h-[36px]"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-400 efl-theme-amber" />
                <span>National Cups</span>
              </button>
              <button
                onClick={() => onNavigateTab('champions-league')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 efl-theme-text-2 hover:text-white efl-theme-hover-text min-h-[36px]"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-400 efl-theme-blue" />
                <span>Champions League</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 1. Domestic Leagues Selector Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black text-[var(--efl-text-2)] uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[var(--efl-primary)]" />
            <span>{user?.isAdmin ? previewText.domestic : 'Domestic Leagues'} (2026/27)</span>
          </div>
          <button
            id="btn-refresh-clubs-view"
            onClick={() => {
              loadClubsForLeague(selectedLeagueId, true);
              if (activeLeagueTab === 'MATCHES') {
                loadLeagueFixtures(selectedLeagueId, selectedMatchday);
              } else if (activeLeagueTab === 'STANDINGS') {
                loadLeagueStandings(selectedLeagueId);
              }
            }}
            disabled={isLoadingClubs}
            className="px-2.5 py-1 rounded-xl bg-[var(--efl-surface)] border border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)] font-bold text-[11px] flex items-center gap-1 transition-colors disabled:opacity-50 min-h-[32px] shadow-xs"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingClubs ? 'animate-spin text-[var(--efl-primary)]' : ''}`} />
            <span>{user?.isAdmin ? previewText.refresh : 'Refresh'}</span>
          </button>
        </div>

        {leagues.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {leagues.map((league) => {
              const isSelected = selectedLeagueId === league.id;
              const flag =
                league.country === 'England'
                  ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿'
                  : league.country === 'Spain'
                  ? '🇪🇸'
                  : league.country === 'Italy'
                  ? '🇮🇹'
                  : league.country === 'Germany'
                  ? '🇩🇪'
                  : '🇫🇷';

              return (
                <button
                  key={league.id}
                  id={`btn-league-${league.id}`}
                  onClick={() => handleSelectLeague(league.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 transition-all min-h-[42px] border ${
                    isSelected
                      ? 'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/40 text-[var(--efl-primary)] font-black shadow-xs'
                      : 'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'
                  }`}
                >
                  <img
                    src={league.logoUrl}
                    alt={league.name}
                    className="w-4 h-4 object-contain shrink-0 efl-theme-league-logo"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span>{flag}</span>
                  <span>{league.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      isSelected
                        ? 'bg-[var(--efl-primary)] text-white'
                        : 'bg-[var(--efl-surface-2)] text-[var(--efl-text-2)]'
                    }`}
                  >
                    {league.totalClubs || (league.name === 'Bundesliga' || league.name === 'Ligue 1' ? 18 : 20)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Dedicated Selected League Header Banner */}
      {currentLeague && (
        <div className="relative overflow-hidden p-4 sm:p-6 shadow-xs border border-[var(--efl-border)] bg-[var(--efl-surface)] rounded-2xl preview-league-banner">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="efl-theme-league-logo w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[var(--efl-surface-2)] p-2.5 border border-[var(--efl-border)] flex items-center justify-center shadow-xs shrink-0">
                <img
                  src={currentLeague.logoUrl}
                  alt={currentLeague.name}
                  className="w-10 h-10 object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--efl-text-2)] uppercase tracking-wider">
                    {currentLeague.country} • {user?.isAdmin ? previewText.tier : 'Tier'} {currentLeague.tier}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[var(--efl-primary-soft)] text-[var(--efl-primary)] border border-[var(--efl-primary)]/20">
                    2026/27 {user?.isAdmin ? previewText.active : 'Active'}
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-[var(--efl-text)] tracking-tight mt-0.5">
                  {currentLeague.name}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--efl-text-2)]">
                  <span className="flex items-center gap-1 font-semibold">
                    <Shield className="w-3.5 h-3.5 text-[var(--efl-primary)]" />
                    <span>{clubs.length} {user?.isAdmin ? previewText.clubs : 'Clubs'}</span>
                  </span>
                  <span>•</span>
                  <span className="text-emerald-600 efl-theme-emerald dark:text-emerald-400 font-bold">{availableCount} {user?.isAdmin ? previewText.available : 'Available'}</span>
                  <span>•</span>
                  <span className="text-blue-600 efl-theme-blue dark:text-blue-400 font-bold">{claimedCount} {user?.isAdmin ? previewText.claimed : 'Claimed'}</span>
                </div>
              </div>
            </div>

            {/* User Active Club Badge if belongs to this league */}
            {ownedClubs.filter((owned) => owned.leagueId === selectedLeagueId).map((club) => (
              <div key={club.id} className="flex items-center gap-3 bg-[var(--efl-surface-2)] border border-[var(--efl-border)] rounded-xl p-2.5 px-3.5 shadow-xs">
                <ClubCrest
                  clubId={club.id}
                  logoUrl={club.logoUrl}
                  name={club.name}
                  shortName={club.shortName}
                  size="sm"
                  className="w-7 h-7"
                />
                <div className="min-w-0">
                  <div className="text-[9px] uppercase font-black text-[var(--efl-primary)] flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    <span>{t.myClub} ({t.clubLocked})</span>
                  </div>
                  <div className="text-xs font-bold text-[var(--efl-text)] truncate max-w-[140px]">{club.name}</div>
                </div>
              </div>
            ))}
            {user?.isAdmin && premiumStatusReady && ownedClubs.length === 1 && !premiumActive && (
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-[10px] font-semibold text-fuchsia-700 efl-theme-fuchsia dark:text-fuchsia-300">
                Premium bilan boshqa ligadan yana bitta klub tanlash mumkin. Jami 2 ta klub.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Sub-Navigation Tabs: Clubs | Matches | Standings */}
      <div className="flex items-center gap-2 border-b border-[var(--efl-border)] pb-2 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveLeagueTab('CLUBS')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] border ${
            activeLeagueTab === 'CLUBS'
              ? 'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/30 text-[var(--efl-primary)] font-black shadow-xs'
              : 'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>{user?.isAdmin ? previewText.clubs : 'Clubs'} ({clubs.length})</span>
        </button>

        <button
          onClick={() => setActiveLeagueTab('MATCHES')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] border ${
            activeLeagueTab === 'MATCHES'
              ? 'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/30 text-[var(--efl-primary)] font-black shadow-xs'
              : 'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'
          }`}
        >
          <Swords className="w-4 h-4" />
          <span>{user?.isAdmin ? previewText.matches : `Matches (${leagueFixtures.length})`}</span>
        </button>

        <button
          onClick={() => setActiveLeagueTab('STANDINGS')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] border ${
            activeLeagueTab === 'STANDINGS'
              ? 'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/30 text-[var(--efl-primary)] font-black shadow-xs'
              : 'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>{user?.isAdmin ? previewText.standings : 'Standings Table'}</span>
        </button>
      </div>

      {/* 4. Sub-Tab Content */}

      {/* TAB A: CLUBS LIST */}
      {activeLeagueTab === 'CLUBS' && (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-[var(--efl-surface)] border border-[var(--efl-border)] text-xs text-[var(--efl-text-2)] flex items-center justify-between gap-3 shadow-xs">
            <span>{admissionError ? admissionText.unavailable : !admission ? admissionText.checking : !admission.enabled ? admissionText.open : admission.activeLeagueId === selectedLeagueId ? admissionText.leagueOpen : admission.activeLeagueId ? admissionText.otherLeague(admission.leagues[admission.stage].name) : admissionText.finished}</span>
            {admissionError && <button type="button" onClick={() => void loadAdmission()} className="text-emerald-600 efl-theme-emerald dark:text-emerald-400 font-bold">{admissionText.retry}</button>}
          </div>
          {/* Search & Filter Toolbar */}
          <div className="p-3 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-[var(--efl-muted)] efl-theme-meta absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-[var(--efl-surface-2)] border border-[var(--efl-border)] text-[var(--efl-text)] placeholder-[var(--efl-muted)] efl-theme-placeholder min-h-[38px] focus:outline-none focus:border-[var(--efl-primary)]"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end overflow-x-auto scrollbar-none">
              <button
                onClick={() => setFilterMode('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'ALL'
                    ? 'bg-[var(--efl-surface-2)] text-[var(--efl-text)] border border-[var(--efl-border)] font-black'
                    : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)] hover:bg-[var(--efl-surface-2)]'
                }`}
              >
                {t.filterAll} ({clubs.length})
              </button>
              <button
                onClick={() => setFilterMode('AVAILABLE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'AVAILABLE'
                    ? 'bg-emerald-500/15 text-emerald-600 efl-theme-emerald dark:text-emerald-400 border border-emerald-500/30 font-black'
                    : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)] hover:bg-[var(--efl-surface-2)]'
                }`}
              >
                {t.available} ({availableCount})
              </button>
              <button
                onClick={() => setFilterMode('CLAIMED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'CLAIMED'
                    ? 'bg-blue-500/15 text-blue-600 efl-theme-blue dark:text-blue-400 border border-blue-500/30 font-black'
                    : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)] hover:bg-[var(--efl-surface-2)]'
                }`}
              >
                {t.claimed} ({claimedCount})
              </button>
            </div>
          </div>

          {/* Clubs Grid */}
          {isLoadingClubs && clubs.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="h-44 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]" />
              ))}
            </div>
          ) : error && clubs.length === 0 ? (
            <div className="p-8 text-center glass-panel border-rose-500/30 bg-rose-950/30 rounded-3xl max-w-md mx-auto my-6 shadow-xl">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-rose-400 efl-theme-rose" />
              <h4 className="text-sm font-bold text-white efl-theme-text mb-1">Couldn't load data</h4>
              <p className="text-xs text-rose-200/80 efl-theme-rose mb-5">Please try again.</p>
              <button
                onClick={() => loadClubsForLeague(selectedLeagueId, true)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md inline-flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : filteredClubs.length === 0 ? (
            <div className="py-16 text-center glass-panel rounded-3xl border border-white/[0.06] efl-theme-border">
              <Shield className="w-10 h-10 text-slate-500 efl-theme-muted mx-auto mb-2 opacity-60" />
              <h4 className="text-sm font-bold text-slate-200 efl-theme-text">No clubs found</h4>
              <p className="text-xs text-slate-400 efl-theme-text-2 mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {filteredClubs.map((club) => {
                const ownerInfo = getClubOwnerDisplay(club, undefined, club.claimedByUserId, t.userNeeded);
                const isUserClub =
                  club.isCurrentUserClub ||
                  club.claimedByUserId === user?.id ||
                  club.occupancy?.status === 'owned' ||
                  ownedClubs.some((owned) => owned.id === club.id);
                const isClaimedByOther = (isClubTaken(club) || ownerInfo.isClaimed) && !isUserClub;

                return (
                  <div
                    key={club.id}
                    className={`p-4 rounded-2xl flex flex-col justify-between shadow-xs transition-all relative overflow-hidden border bg-[var(--efl-surface)] ${
                      isUserClub
                        ? 'border-[var(--efl-primary)]/50 bg-[var(--efl-primary-soft)]'
                        : isClaimedByOther
                        ? 'border-[var(--efl-border)] opacity-90'
                        : 'border-[var(--efl-border)] hover:border-[var(--efl-primary)]/40 hover:bg-[var(--efl-surface-2)]/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="w-12 h-12 rounded-xl bg-[var(--efl-surface-2)] p-2 border border-[var(--efl-border)] flex items-center justify-center shadow-xs shrink-0">
                          <ClubCrest
                            clubId={club.id}
                            logoUrl={club.logoUrl}
                            name={club.name}
                            shortName={club.shortName}
                            size="md"
                            className="w-8 h-8"
                          />
                        </div>

                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-[var(--efl-surface-2)] border border-[var(--efl-border)] text-[var(--efl-text-2)]">
                            {club.shortName}
                          </span>
                          {isUserClub ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-blue-600 efl-theme-blue dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                              <CheckCircle2 className="w-3 h-3" /> {t.myClub}
                            </div>
                          ) : isClaimedByOther ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--efl-text-2)] bg-[var(--efl-surface-2)] border border-[var(--efl-border)] px-2 py-0.5 rounded-full">
                              <Lock className="w-3 h-3 text-[var(--efl-muted)] efl-theme-meta" /> {t.claimed}
                            </div>
                          ) : (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-amber-600 efl-theme-amber dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">
                              <Sparkles className="w-3 h-3 text-amber-500 efl-theme-amber" /> {t.userNeeded}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mb-0.5"><h3 className="font-black text-xs sm:text-sm text-[var(--efl-text)] line-clamp-1">{club.name}</h3><PremiumClubBadge clubId={club.id} /></div>
                      <div className="mb-2">
                        {isUserClub ? (
                          <span className="text-[11px] font-bold text-blue-600 efl-theme-blue dark:text-blue-400 truncate block">
                            @{user?.username || 'siz'}
                          </span>
                        ) : isClaimedByOther ? (
                          ownerInfo.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserProfile(ownerInfo.userId!);
                              }}
                              className="text-[11px] font-semibold text-[var(--efl-text-2)] hover:text-[var(--efl-primary)] efl-theme-hover-primary transition-colors truncate block text-left"
                            >
                              {ownerInfo.displayText}
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-[var(--efl-text-2)] truncate block">
                              {ownerInfo.displayText}
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] font-bold text-amber-600 efl-theme-amber dark:text-amber-400 truncate block">
                            {t.userNeeded}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--efl-muted)] efl-theme-meta flex items-center gap-1.5 mb-2.5">
                        <MapPin className="w-3 h-3 text-[var(--efl-muted)] efl-theme-meta shrink-0" />
                        <span className="truncate">{club.stadium || 'Home Stadium'}</span>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-[var(--efl-border)] mt-1">
                      {isUserClub ? (
                        <div className="text-[11px] font-bold text-blue-600 efl-theme-blue dark:text-blue-400 text-center py-1.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
                          {t.manager}: @{user?.username}
                        </div>
                      ) : isClaimedByOther ? (
                        <div className="flex items-center justify-between text-[11px] text-[var(--efl-text-2)] bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-2 rounded-xl">
                          <span className="text-[10px] uppercase font-bold text-[var(--efl-muted)] efl-theme-meta">{t.manager}:</span>
                          {ownerInfo.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserProfile(ownerInfo.userId!);
                              }}
                              className="font-semibold text-[var(--efl-text)] hover:text-[var(--efl-primary)] efl-theme-hover-primary transition-colors truncate underline decoration-[var(--efl-border)] hover:decoration-[var(--efl-primary)] underline-offset-2 max-w-[140px]"
                            >
                              {ownerInfo.displayText}
                            </button>
                          ) : (
                            <span className="font-semibold text-[var(--efl-text)] truncate">{ownerInfo.displayText}</span>
                          )}
                        </div>
                      ) : !admission || admission.enabled && admission.activeLeagueId !== club.leagueId || !premiumStatusReady || ownedClubs.some((owned) => owned.leagueId === club.leagueId) || ownedClubs.length >= (premiumActive ? 2 : 1) ? (
                        <button
                          disabled={true}
                          className="w-full py-2 bg-[var(--efl-surface-2)] border border-[var(--efl-border)] text-[var(--efl-muted)] efl-theme-meta font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-not-allowed opacity-75 min-h-[38px]"
                        >
                          <Lock className="w-3.5 h-3.5 text-[var(--efl-muted)] efl-theme-meta" />
                          <span>{admission?.enabled && admission.activeLeagueId !== club.leagueId ? admissionText.closed : t.clubLocked}</span>
                        </button>
                      ) : (
                        <button
                          id={`btn-claim-club-${club.id}`}
                          onClick={() => {
                            if (club && club.id && club.id !== 'undefined' && club.id !== 'null' && club.id.startsWith('club-')) {
                              setClubToClaim(club);
                            }
                          }}
                          className="w-full py-2 btn-glass-primary text-white font-black text-xs flex items-center justify-center gap-1.5 min-h-[40px] touch-manipulation shadow-xs"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          <span>{t.claimClub}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB B: MATCHES / FIXTURES */}
      {activeLeagueTab === 'MATCHES' && (
        <div className="space-y-4">
          {/* Matchday Selector */}
          {matchdays.length > 0 && (
            <div className="p-2.5 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] flex items-center gap-2 overflow-x-auto scrollbar-none shadow-xs">
              <span className="text-[11px] font-black text-[var(--efl-text-2)] uppercase tracking-wider shrink-0 mr-1">
                {user?.isAdmin ? previewText.matchday : 'Matchday'}:
              </span>
              {matchdays.map((md) => (
                <button
                  key={md}
                  onClick={() => setSelectedMatchday(md)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all min-h-[34px] border ${
                    selectedMatchday === md
                      ? 'bg-[var(--efl-primary)] text-white font-black shadow-xs border-transparent'
                      : 'bg-[var(--efl-surface-2)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface)] hover:text-[var(--efl-text)]'
                  }`}
                >
                  {user?.isAdmin ? previewText.matchday : 'MD'} {md}
                </button>
              ))}
            </div>
          )}

          {/* Fixtures List */}
          {isLoadingFixtures && leagueFixtures.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]" />
              ))}
            </div>
          ) : currentMatchdayFixtures.length === 0 ? (
            <div className="py-12 text-center rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] text-[var(--efl-text-2)] text-xs shadow-xs">
              {user?.isAdmin ? previewText.emptyFixtures : 'No fixtures scheduled for this matchday.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentMatchdayFixtures.map((fix) => {
                const isConfirmed = fix.status === 'CONFIRMED';
                const isUserClub = ownedClubs.some((club) => club.id === fix.homeClubId || club.id === fix.awayClubId);

                return (
                  <div
                    key={fix.id}
                    onClick={() => {
                      if (!isConfirmed && fix.isPlayable !== false) {
                        setSelectedFixtureForModal(fix);
                      }
                    }}
                    className={`p-3.5 sm:p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-xs bg-[var(--efl-surface)] border border-[var(--efl-border)] transition-colors ${
                      !isConfirmed && fix.isPlayable !== false ? 'cursor-pointer hover:bg-[var(--efl-surface-2)]/60' : ''
                    } ${isUserClub ? 'border-[var(--efl-primary)]/40 bg-[var(--efl-primary-soft)]/40' : ''}`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-[var(--efl-text-2)] border-b border-[var(--efl-border)] pb-2">
                      <span className="font-bold">{fix.roundName || `Matchday ${fix.matchday}`}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          isConfirmed
                            ? 'bg-emerald-500/15 text-emerald-600 efl-theme-emerald dark:text-emerald-400 border border-emerald-500/30'
                            : fix.status === 'PENDING_CONFIRMATION'
                            ? 'bg-amber-500/15 text-amber-600 efl-theme-amber dark:text-amber-400 border border-amber-500/30'
                            : 'bg-[var(--efl-surface-2)] text-[var(--efl-text-2)] border border-[var(--efl-border)]'
                        }`}
                      >
                        {isConfirmed ? 'CONFIRMED' : fix.status || 'UPCOMING'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {/* Home */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ClubCrest
                          clubId={fix.homeClub?.id}
                          logoUrl={fix.homeClub?.logoUrl}
                          name={fix.homeClub?.name}
                          shortName={fix.homeClub?.shortName}
                          size="sm"
                          className="w-6 h-6 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className={`text-xs truncate block ${isUserClub && ownedClubs.some((c) => c.id === fix.homeClubId) ? 'font-black text-blue-600 efl-theme-blue dark:text-blue-400' : 'font-bold text-[var(--efl-text)]'}`}>
                            {fix.homeClub?.shortName || fix.homeClub?.name}
                          </span>
                          {(() => {
                            const homeOwnerInfo = getClubOwnerDisplay(fix.homeClub, fix.homeOwner || fix.homeUser, fix.homeOwnerId, t.userNeeded);
                            if (homeOwnerInfo.isClaimed) {
                              return homeOwnerInfo.userId ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUserProfile(homeOwnerInfo.userId!);
                                  }}
                                  className="text-[10px] text-[var(--efl-muted)] efl-theme-meta hover:text-[var(--efl-primary)] efl-theme-hover-primary transition-colors font-medium truncate block text-left"
                                >
                                  {homeOwnerInfo.displayText}
                                </button>
                              ) : (
                                <span className="text-[10px] text-[var(--efl-muted)] efl-theme-meta font-medium truncate block">
                                  {homeOwnerInfo.displayText}
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] text-amber-600 efl-theme-amber dark:text-amber-400 font-bold truncate block">
                                {t.userNeeded}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Score / VS */}
                      <div className="px-3 py-1.5 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] font-black text-xs sm:text-sm text-[var(--efl-text)] shrink-0 tabular-nums">
                        {isConfirmed ? `${fix.homeScore} : ${fix.awayScore}` : 'vs'}
                      </div>

                      {/* Away */}
                      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end text-right">
                        <div className="min-w-0 text-right">
                          <span className={`text-xs truncate block ${isUserClub && ownedClubs.some((c) => c.id === fix.awayClubId) ? 'font-black text-blue-600 efl-theme-blue dark:text-blue-400' : 'font-bold text-[var(--efl-text)]'}`}>
                            {fix.awayClub?.shortName || fix.awayClub?.name}
                          </span>
                          {(() => {
                            const awayOwnerInfo = getClubOwnerDisplay(fix.awayClub, fix.awayOwner || fix.awayUser, fix.awayOwnerId, t.userNeeded);
                            if (awayOwnerInfo.isClaimed) {
                              return awayOwnerInfo.userId ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUserProfile(awayOwnerInfo.userId!);
                                  }}
                                  className="text-[10px] text-[var(--efl-muted)] efl-theme-meta hover:text-[var(--efl-primary)] efl-theme-hover-primary transition-colors font-medium truncate block text-right ml-auto"
                                >
                                  {awayOwnerInfo.displayText}
                                </button>
                              ) : (
                                <span className="text-[10px] text-[var(--efl-muted)] efl-theme-meta font-medium truncate block text-right">
                                  {awayOwnerInfo.displayText}
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] text-amber-600 efl-theme-amber dark:text-amber-400 font-bold truncate block text-right">
                                {t.userNeeded}
                              </span>
                            );
                          })()}
                        </div>
                        <ClubCrest
                          clubId={fix.awayClub?.id}
                          logoUrl={fix.awayClub?.logoUrl}
                          name={fix.awayClub?.name}
                          shortName={fix.awayClub?.shortName}
                          size="sm"
                          className="w-6 h-6 shrink-0"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB C: STANDINGS TABLE */}
      {activeLeagueTab === 'STANDINGS' && (
        <div className="space-y-4">
          {isLoadingStandings && leagueStandings.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] space-y-3 animate-pulse shadow-xs">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]" />
              ))}
            </div>
          ) : leagueStandings.length === 0 ? (
            <div className="py-12 text-center rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] text-[var(--efl-text-2)] text-xs shadow-xs">
              {user?.isAdmin ? previewText.emptyStandings : 'Standings are not available yet.'}
            </div>
          ) : (
            <div className="preview-surface overflow-hidden shadow-sm rounded-2xl border border-[var(--efl-border)]">
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-[var(--efl-surface-2)] border-b border-[var(--efl-border)] text-[10px]">
                <div className="font-bold text-[var(--efl-text)]">
                  {currentComp?.name || 'League Table'} • {totalLeagueMatchdays} Tur
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-[var(--efl-text-2)]">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>{t.uclZone} (1–{uclThreshold})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[var(--efl-text-2)]">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span>{t.uelZone} ({uclThreshold + 1}–{uelThreshold})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[var(--efl-text-2)]">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>{t.relegationZone} ({relThreshold}–{relThreshold === 16 ? 18 : 20})</span>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto scrollbar-none">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--efl-border)] bg-[var(--efl-surface-2)] text-[var(--efl-text-2)] font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-3 w-12 text-center">#</th>
                      <th className="py-3 px-3">{t.club}</th>
                      <th className="py-3 px-2 text-center font-bold text-[var(--efl-text)]">P</th>
                      <th className="py-3 px-2 text-center">W</th>
                      <th className="py-3 px-2 text-center">D</th>
                      <th className="py-3 px-2 text-center">L</th>
                      <th className="py-3 px-2 text-center hidden sm:table-cell">GF</th>
                      <th className="py-3 px-2 text-center hidden sm:table-cell">GA</th>
                      <th className="py-3 px-2 text-center">GD</th>
                      <th className="py-3 px-3 text-center font-black text-[var(--efl-primary)]">PTS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--efl-border)]">
                    {leagueStandings.map((row) => {
                      const posStyle = getPositionStyle(row.position);
                      const isMyClub = ownedClubs.some((club) => club.id === row.clubId);

                      return (
                        <tr
                          key={row.clubId}
                          className={`transition-colors ${
                            isMyClub ? 'active-club-highlight bg-[var(--efl-primary-soft)] font-bold' : 'hover:bg-[var(--efl-surface-2)]'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span
                                className={`w-1.5 h-4 rounded-full ${posStyle.barColor}`}
                                title={posStyle.label}
                              />
                              <span className="font-black text-[var(--efl-text)] text-xs">{row.position}</span>
                            </div>
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5 min-w-[140px]">
                              <ClubCrest
                                clubId={row.clubId}
                                logoUrl={row.clubLogoUrl}
                                name={row.clubName}
                                size="xs"
                                className="w-5 h-5 shrink-0"
                              />
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-[var(--efl-text)] text-xs truncate max-w-[160px]">
                                    {row.clubName}
                                  </span>
                                  <PremiumClubBadge clubId={row.clubId} />
                                  {isMyClub && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-[var(--efl-primary)] text-white uppercase">
                                      You
                                    </span>
                                  )}
                                </div>
                                {(() => {
                                  const rowOwnerInfo = getClubOwnerDisplay(
                                    {
                                      claimedByUserId: row.managerUserId,
                                      claimedByUsername: row.managerUsername,
                                      managerUsername: row.managerUsername,
                                    },
                                    undefined,
                                    row.managerUserId,
                                    t.userNeeded
                                  );
                                  if (rowOwnerInfo.isClaimed) {
                                    return rowOwnerInfo.userId ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openUserProfile(rowOwnerInfo.userId!);
                                        }}
                                        className="text-[10px] text-[var(--efl-muted)] efl-theme-meta hover:text-[var(--efl-primary)] efl-theme-hover-primary font-medium truncate max-w-[140px] text-left transition-colors"
                                      >
                                        {rowOwnerInfo.displayText}
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-[var(--efl-muted)] efl-theme-meta font-medium truncate max-w-[140px]">
                                        {rowOwnerInfo.displayText}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="text-[10px] text-amber-500 efl-theme-amber font-bold truncate max-w-[140px]">
                                      {t.userNeeded}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-center font-semibold text-[var(--efl-text)]">{row.played}</td>
                          <td className="py-2.5 px-2 text-center text-[var(--efl-text-2)]">{row.won}</td>
                          <td className="py-2.5 px-2 text-center text-[var(--efl-text-2)]">{row.drawn}</td>
                          <td className="py-2.5 px-2 text-center text-[var(--efl-text-2)]">{row.lost}</td>
                          <td className="py-2.5 px-2 text-center text-[var(--efl-text-2)] hidden sm:table-cell">
                            {row.goalsFor}
                          </td>
                          <td className="py-2.5 px-2 text-center text-[var(--efl-text-2)] hidden sm:table-cell">
                            {row.goalsAgainst}
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold text-[var(--efl-text)]">
                            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                          </td>
                          <td className="py-2.5 px-3 text-center font-black text-[var(--efl-primary)] text-sm">{row.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Claim Confirmation Modal */}
      {clubToClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md shadow-2xl p-6 text-white text-center border-emerald-500/30">
            <div className="w-16 h-16 rounded-2xl bg-slate-950/90 p-2.5 border border-white/[0.1] mx-auto mb-3 flex items-center justify-center shadow-lg">
              <ClubCrest
                clubId={clubToClaim.id}
                logoUrl={clubToClaim.logoUrl}
                name={clubToClaim.name}
                shortName={clubToClaim.shortName}
                size="lg"
                className="w-11 h-11"
              />
            </div>

            <h3 className="text-lg font-black text-white">{clubToClaim.name}</h3>
            <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed">{t.claimConfirmationDesc}</p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setClubToClaim(null)}
                className="flex-1 py-2.5 glass-card glass-card-interactive text-slate-300 font-semibold text-xs min-h-[44px] touch-manipulation"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                id="btn-confirm-claim-action"
                disabled={isClaiming || !clubToClaim || !clubToClaim.id || clubToClaim.id === 'undefined' || clubToClaim.id === 'null' || !clubToClaim.id.startsWith('club-')}
                onClick={() => handleClaimClub()}
                className="flex-1 py-2.5 btn-glass-primary disabled:opacity-50 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 min-h-[44px] touch-manipulation"
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>{t.loading}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-slate-950" />
                    <span>{t.confirm}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Group Membership Required Modal */}
      {membershipModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md shadow-2xl p-6 text-white text-center border-amber-500/40">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 mx-auto mb-3 flex items-center justify-center shadow-lg text-amber-400 efl-theme-amber">
              <Users className="w-8 h-8" />
            </div>

            <h3 className="text-lg font-black text-white">Guruhga A'zo Bo'ling</h3>
            <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed">
              Klub tanlash va ligada ishtirok etish uchun rasmiy{' '}
              <span className="text-amber-400 efl-theme-amber font-bold">{membershipModal.groupUsername}</span> Telegram guruhimizga
              a'zo bo'lishingiz lozim.
            </p>

            <div className="space-y-2">
              <a
                href={membershipModal.groupUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 btn-glass-primary text-slate-950 font-black text-xs flex items-center justify-center gap-2 rounded-xl touch-manipulation shadow-md"
              >
                <Users className="w-4 h-4 text-slate-950" />
                <span>{membershipModal.groupUsername} guruhiga qo'shilish</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-950" />
              </a>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMembershipModal(null)}
                  className="flex-1 py-2.5 glass-card glass-card-interactive text-slate-300 font-semibold text-xs min-h-[44px] touch-manipulation"
                >
                  Yopish
                </button>
                <button
                  type="button"
                  id="btn-verify-telegram-membership"
                  disabled={isCheckingMembership || isClaiming}
                  onClick={handleCheckMembershipAndClaim}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 min-h-[44px] touch-manipulation shadow-md transition-colors"
                >
                  {isCheckingMembership || isClaiming ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                      <span>Tekshirilmoqda...</span>
                    </>
                  ) : (
                    <span>✅ Tekshirish</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

