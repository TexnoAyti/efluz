import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { ClubCrest } from './ClubCrest';
import { MatchdayCountdown } from './MatchdayCountdown';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';
import {
  Swords,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Shield,
  Search,
  Filter,
  ArrowRight,
  Sparkles,
  ChevronRight,
  Info,
  Lock,
  Send,
} from 'lucide-react';

interface MyMatchesViewProps {
  initialSelectedFixture?: Fixture | null;
  onNavigateTab?: (tab: any) => void;
}

export const MyMatchesView: React.FC<MyMatchesViewProps> = ({ initialSelectedFixture, onNavigateTab }) => {
  const { user, currentClub, activeSeasonId, showToast } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED' | 'DISPUTED'>('ALL');
  const [selectedFixtureForModal, setSelectedFixtureForModal] = useState<Fixture | null>(
    initialSelectedFixture || null
  );
  const [focusedFixture, setFocusedFixture] = useState<Fixture | null>(
    initialSelectedFixture || null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMatches = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getMyMatches(activeSeasonId);
      setFixtures(res.fixtures || []);
      if (res.fixtures && res.fixtures.length > 0) {
        // If currently focused fixture is in the new list, update it, otherwise pick next upcoming
        const match = focusedFixture ? res.fixtures.find((f) => f.id === focusedFixture.id) : null;
        const next = match || res.fixtures.find((f) => f.status !== 'CONFIRMED') || res.fixtures[0];
        setFocusedFixture(next);
      } else {
        setFocusedFixture(null);
      }
    } catch (err: any) {
      console.error('Failed to load matches:', err);
      setError("Couldn't load data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMatches();
  }, [activeSeasonId, user?.id, currentClub?.id]);

  const filteredFixtures = fixtures.filter((f) => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'PENDING') return f.status === 'SCHEDULED' || f.status === 'PENDING_CONFIRMATION';
    if (activeFilter === 'CONFIRMED') return f.status === 'CONFIRMED';
    if (activeFilter === 'DISPUTED') return f.status === 'DISPUTED';
    return true;
  });

  const getStatusBadge = (status: Fixture['status']) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> {t.matchStatusConfirmed}
          </span>
        );
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> {t.matchStatusPending}
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> {t.matchStatusDisputed}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-slate-300 glass-pill">
            <Calendar className="w-3 h-3" /> {t.matchStatusUpcoming}
          </span>
        );
    }
  };

  const handleQuickConfirm = async (fixture: Fixture, homeScore: number, awayScore: number) => {
    try {
      const res = await api.submitFixtureResult(fixture.id, homeScore, awayScore);
      showToast(t.submissionSuccess, 'success');
      loadMatches();
      if (focusedFixture?.id === fixture.id) {
        setFocusedFixture(res.fixture);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-5 sm:p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider mb-1">
            <Swords className="w-4 h-4" />
            <span>{t.matchCenter}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">{t.navMyMatches}</h2>
          <p className="text-xs text-slate-400 mt-1">
            Play your fixtures in eFootball and submit/confirm verified match scores.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 glass-card p-1 rounded-xl border-white/[0.08] overflow-x-auto scrollbar-none w-full sm:w-auto max-w-full">
          {(['ALL', 'PENDING', 'CONFIRMED', 'DISPUTED'] as const).map((filterKey) => (
            <button
              key={filterKey}
              onClick={() => setActiveFilter(filterKey)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                activeFilter === filterKey
                  ? 'btn-glass-primary text-slate-950 font-black shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {filterKey === 'ALL'
                ? t.filterAll
                : filterKey === 'PENDING'
                ? t.matchStatusPending
                : filterKey === 'CONFIRMED'
                ? t.matchStatusConfirmed
                : t.matchStatusDisputed}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      {error && fixtures.length === 0 && !isLoading && (
        <div className="p-6 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-white">Couldn't load data</div>
              <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
            </div>
          </div>
          <button
            onClick={loadMatches}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
          >
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main Grid: Match Center Card & Fixture List */}
      {isLoading && fixtures.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-pulse">
          <div className="lg:col-span-7 h-72 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          <div className="lg:col-span-5 h-72 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Match Details & Submission (lg:col-span-7) */}
          <div className="lg:col-span-7 space-y-4">
          {focusedFixture ? (
            <div className="glass-panel p-5 sm:p-6 shadow-2xl space-y-5">
              {/* Competition & Status bar */}
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3.5">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                    {focusedFixture.competitionName}
                  </span>
                  <div className="text-[11px] text-slate-400 font-medium">
                    {focusedFixture.roundName || `${t.matchday} ${focusedFixture.matchday}`}
                  </div>
                </div>
                {getStatusBadge(focusedFixture.status)}
              </div>

              {/* Matchup Teams Display */}
              <div className="grid grid-cols-7 items-center gap-2 py-3">
                {/* Home Club */}
                <div className="col-span-3 flex flex-col items-center text-center">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center mb-2 shadow-inner">
                    <ClubCrest
                      clubId={focusedFixture.homeClub?.id}
                      logoUrl={focusedFixture.homeClub?.logoUrl}
                      name={focusedFixture.homeClub?.name}
                      shortName={focusedFixture.homeClub?.shortName}
                      size="xl"
                      className="w-full h-full"
                    />
                  </div>
                  <h4 className="font-black text-xs sm:text-sm text-white truncate max-w-full">
                    {focusedFixture.homeClub?.name}
                  </h4>
                  {focusedFixture.homeOwnerId === user?.id || focusedFixture.homeClub?.claimedByUserId === user?.id ? (
                    <span className="text-[10px] text-emerald-400 font-bold mt-1">
                      ({t.myClub})
                    </span>
                  ) : (() => {
                    const homeOwnerInfo = getClubOwnerDisplay(
                      focusedFixture.homeClub,
                      focusedFixture.homeOwner || focusedFixture.homeUser,
                      focusedFixture.homeOwnerId,
                      t.userNeeded
                    );
                    if (homeOwnerInfo.isClaimed) {
                      return (
                        <div className="flex flex-col items-center gap-1.5 mt-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-slate-300 font-bold truncate max-w-[120px]">
                              {homeOwnerInfo.displayText}
                            </span>
                            <span className="text-[9px] font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 rounded">
                              {t.opponentBadge}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap justify-center">
                            {homeOwnerInfo.userId && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUserProfile(homeOwnerInfo.userId!);
                                }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
                              >
                                {t.profile}
                              </button>
                            )}
                            {homeOwnerInfo.hasValidTelegram && homeOwnerInfo.username && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTelegramChat(homeOwnerInfo.username!);
                                }}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors flex items-center gap-1 shadow-sm"
                              >
                                <Send className="w-2.5 h-2.5" />
                                <span>{t.writeToOpponent}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <span className="text-[10px] text-amber-400/90 font-bold mt-1">
                        {t.userNeeded}
                      </span>
                    );
                  })()}
                </div>

                {/* Score / VS Center */}
                <div className="col-span-1 flex flex-col items-center justify-center">
                  {focusedFixture.status === 'CONFIRMED' ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 glass-card border-white/[0.1]">
                      <span className="text-xl sm:text-2xl font-black text-white">{focusedFixture.homeScore}</span>
                      <span className="text-slate-500 font-bold">:</span>
                      <span className="text-xl sm:text-2xl font-black text-white">{focusedFixture.awayScore}</span>
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full glass-card flex items-center justify-center font-black text-[10px] text-slate-400">
                      VS
                    </div>
                  )}
                </div>

                {/* Away Club */}
                <div className="col-span-3 flex flex-col items-center text-center">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center mb-2 shadow-inner">
                    <ClubCrest
                      clubId={focusedFixture.awayClub?.id}
                      logoUrl={focusedFixture.awayClub?.logoUrl}
                      name={focusedFixture.awayClub?.name}
                      shortName={focusedFixture.awayClub?.shortName}
                      size="xl"
                      className="w-full h-full"
                    />
                  </div>
                  <h4 className="font-black text-xs sm:text-sm text-white truncate max-w-full">
                    {focusedFixture.awayClub?.name}
                  </h4>
                  {focusedFixture.awayOwnerId === user?.id || focusedFixture.awayClub?.claimedByUserId === user?.id ? (
                    <span className="text-[10px] text-emerald-400 font-bold mt-1">
                      ({t.myClub})
                    </span>
                  ) : (() => {
                    const awayOwnerInfo = getClubOwnerDisplay(
                      focusedFixture.awayClub,
                      focusedFixture.awayOwner || focusedFixture.awayUser,
                      focusedFixture.awayOwnerId,
                      t.userNeeded
                    );
                    if (awayOwnerInfo.isClaimed) {
                      return (
                        <div className="flex flex-col items-center gap-1.5 mt-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-slate-300 font-bold truncate max-w-[120px]">
                              {awayOwnerInfo.displayText}
                            </span>
                            <span className="text-[9px] font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 rounded">
                              {t.opponentBadge}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap justify-center">
                            {awayOwnerInfo.userId && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUserProfile(awayOwnerInfo.userId!);
                                }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
                              >
                                {t.profile}
                              </button>
                            )}
                            {awayOwnerInfo.hasValidTelegram && awayOwnerInfo.username && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTelegramChat(awayOwnerInfo.username!);
                                }}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors flex items-center gap-1 shadow-sm"
                              >
                                <Send className="w-2.5 h-2.5" />
                                <span>{t.writeToOpponent}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <span className="text-[10px] text-amber-400/90 font-bold mt-1">
                        {t.userNeeded}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Opponent Submission Notification Banner (Two-Party Flow) */}
              {focusedFixture.opponentSubmission && focusedFixture.status === 'PENDING_CONFIRMATION' && (
                <div className="glass-card bg-amber-950/20 border-amber-500/30 p-4 text-xs space-y-2.5">
                  <div className="flex items-center justify-between font-bold text-amber-400">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 animate-spin text-amber-400" />
                      <span>{t.opponentSubmitted}: {focusedFixture.opponentSubmission.homeScore} - {focusedFixture.opponentSubmission.awayScore}</span>
                    </div>
                  </div>

                  <p className="text-slate-300 text-[11px]">
                    Your opponent recorded this score. Please confirm if this matches your eFootball match or submit your counter score to dispute.
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        handleQuickConfirm(
                          focusedFixture,
                          focusedFixture.opponentSubmission!.homeScore,
                          focusedFixture.opponentSubmission!.awayScore
                        )
                      }
                      className="flex-1 py-2 btn-glass-primary font-black text-xs"
                    >
                      {t.confirmOpponentScore}
                    </button>
                    <button
                      onClick={() => setSelectedFixtureForModal(focusedFixture)}
                      className="px-4 py-2 btn-glass-danger font-bold text-xs"
                    >
                      {t.reportDispute}
                    </button>
                  </div>
                </div>
              )}

              {/* Instructions Box */}
              <div className="glass-card p-3.5 border-white/[0.06] text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-slate-300 text-[11px]">
                  <Info className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t.instructions}</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  {t.instructionsText} Both players must enter the score or confirm the opponent’s submission. Screenshots can be attached for dispute resolution.
                </p>
              </div>

              {/* Matchday Locked Notice */}
              {focusedFixture.isPlayable === false && focusedFixture.status !== 'CONFIRMED' && (
                <div className="glass-card bg-rose-950/20 border-rose-500/30 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0 mt-0.5 sm:mt-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-rose-300 flex items-center gap-2">
                        <span>Matchday {focusedFixture.matchday} Qulflangan</span>
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          LOCKED
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Faqat hozirgi faol tur o‘yinlarini o‘ynash va natija kiritish mumkin.
                      </div>
                    </div>
                  </div>
                  {focusedFixture.nextMatchdayOpenAt && (
                    <div className="sm:text-right pl-11 sm:pl-0">
                      <span className="text-[10px] text-slate-400 uppercase font-black block">Ochilish vaqti</span>
                      <span className="text-xs font-mono font-bold text-amber-300">
                        <MatchdayCountdown targetIso={focusedFixture.nextMatchdayOpenAt} onExpire={() => loadMatches()} />
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Primary Action Button */}
              {focusedFixture.status !== 'CONFIRMED' && (
                <button
                  disabled={focusedFixture.isPlayable === false}
                  onClick={() => setSelectedFixtureForModal(focusedFixture)}
                  className={`w-full py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all ${
                    focusedFixture.isPlayable === false
                      ? 'bg-slate-800/70 text-slate-500 border border-slate-700/60 cursor-not-allowed shadow-none'
                      : 'btn-glass-primary'
                  }`}
                >
                  {focusedFixture.isPlayable === false ? (
                    <>
                      <Lock className="w-4 h-4 text-slate-500" />
                      <span>Matchday {focusedFixture.matchday} Qulflangan</span>
                    </>
                  ) : (
                    <>
                      <Swords className="w-4 h-4" />
                      <span>{focusedFixture.userSubmission ? 'Update / Re-Submit Result' : t.submitResult}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          ) : !currentClub ? (
            <div className="glass-panel p-8 text-center space-y-4 shadow-xl">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
                <Shield className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">No Club Claimed Yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Claim your favorite club from Europe's top 5 leagues to unlock your full tournament schedule and match center.
                </p>
              </div>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('leagues')}
                  className="px-5 py-2.5 btn-glass-primary text-xs inline-flex items-center gap-1.5"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Choose Your Club</span>
                </button>
              )}
            </div>
          ) : (
            <div className="glass-panel p-10 text-center text-slate-400 text-sm">
              <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <div className="font-bold text-slate-200">{t.noUpcomingMatches}</div>
              <p className="text-xs text-slate-500 mt-1">
                Your club is active. Fixtures will appear here as soon as the tournament administrator generates the season schedule.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Fixtures List (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-2.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 px-1">
            {t.navMyMatches} ({filteredFixtures.length})
          </h3>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredFixtures.map((fixture) => {
              const isSelected = focusedFixture?.id === fixture.id;
              return (
                <div
                  key={fixture.id}
                  onClick={() => setFocusedFixture(fixture)}
                  className={`cursor-pointer rounded-xl p-3.5 border transition-all ${
                    isSelected
                      ? 'glass-panel border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                      : 'glass-card hover:border-white/[0.15]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                    <span className="font-semibold text-slate-300 truncate max-w-[150px]">
                      {fixture.competitionName} • MD {fixture.matchday}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {fixture.isPlayable === false && fixture.status !== 'CONFIRMED' && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-rose-400 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20">
                          <Lock className="w-2.5 h-2.5" /> Qulflangan
                        </span>
                      )}
                      {getStatusBadge(fixture.status)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {/* Home Team */}
                    {(() => {
                      const isHomeUser = fixture.homeOwnerId === user?.id || fixture.homeClub?.claimedByUserId === user?.id;
                      const homeOwnerInfo = getClubOwnerDisplay(fixture.homeClub, fixture.homeOwner || fixture.homeUser, fixture.homeOwnerId, t.userNeeded);
                      return (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <ClubCrest
                            clubId={fixture.homeClub?.id}
                            logoUrl={fixture.homeClub?.logoUrl}
                            name={fixture.homeClub?.name}
                            shortName={fixture.homeClub?.shortName}
                            size="xs"
                            className="w-5 h-5 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {fixture.homeClub?.name}
                              </span>
                              {isHomeUser && (
                                <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 px-1 rounded">Siz</span>
                              )}
                            </div>
                            {homeOwnerInfo.isClaimed ? (
                              homeOwnerInfo.userId ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUserProfile(homeOwnerInfo.userId!);
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-emerald-400 transition-colors truncate block text-left"
                                >
                                  {homeOwnerInfo.displayText}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 truncate block">
                                  {homeOwnerInfo.displayText}
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] text-amber-400/90 font-bold truncate block">
                                {t.userNeeded}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Score / VS */}
                    <div className="px-2.5 py-1 rounded-lg glass-card text-[11px] font-black shrink-0">
                      {fixture.status === 'CONFIRMED' ? (
                        <span>{fixture.homeScore} - {fixture.awayScore}</span>
                      ) : (
                        <span className="text-slate-400">VS</span>
                      )}
                    </div>

                    {/* Away Team */}
                    {(() => {
                      const isAwayUser = fixture.awayOwnerId === user?.id || fixture.awayClub?.claimedByUserId === user?.id;
                      const awayOwnerInfo = getClubOwnerDisplay(fixture.awayClub, fixture.awayOwner || fixture.awayUser, fixture.awayOwnerId, t.userNeeded);
                      return (
                        <div className="flex items-center justify-end gap-2 flex-1 min-w-0 text-right">
                          <div className="min-w-0 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isAwayUser && (
                                <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 px-1 rounded">Siz</span>
                              )}
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {fixture.awayClub?.name}
                              </span>
                            </div>
                            {awayOwnerInfo.isClaimed ? (
                              awayOwnerInfo.userId ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUserProfile(awayOwnerInfo.userId!);
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-emerald-400 transition-colors truncate block text-right ml-auto"
                                >
                                  {awayOwnerInfo.displayText}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 truncate block text-right">
                                  {awayOwnerInfo.displayText}
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] text-amber-400/90 font-bold truncate block text-right">
                                {t.userNeeded}
                              </span>
                            )}
                          </div>
                          <ClubCrest
                            clubId={fixture.awayClub?.id}
                            logoUrl={fixture.awayClub?.logoUrl}
                            name={fixture.awayClub?.name}
                            shortName={fixture.awayClub?.shortName}
                            size="xs"
                            className="w-5 h-5 shrink-0"
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

      {/* Submission Modal */}
      {selectedFixtureForModal && (
        <ResultSubmissionModal
          fixture={selectedFixtureForModal}
          isOpen={true}
          onClose={() => setSelectedFixtureForModal(null)}
          onSuccess={(updated) => {
            loadMatches();
            setFocusedFixture(updated);
          }}
        />
      )}
    </div>
  );
};
