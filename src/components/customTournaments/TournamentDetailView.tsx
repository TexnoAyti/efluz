import {isCustomMatchReady,customMatchNeedsPenalties} from '../../lib/customTournamentMatches';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Trophy,
  Users,
  Calendar,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Globe,
  Settings,
  Share2,
  ChevronRight,
  LogOut,
  UploadCloud,
  X,
  Swords,
} from 'lucide-react';
import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentStandingsRow,
} from '../../types/customTournament';
import { CustomPlayoffBracket } from './CustomPlayoffBracket';
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TournamentAdminDrawer } from './TournamentAdminDrawer';
import { ClubCrest } from '../ClubCrest';
import { TournamentClubPicker } from './TournamentClubPicker';
import {tournamentStatusLabel,fixtureStageLabel,fixtureStatusLabel} from '../../lib/customTournamentLabels';
import {TournamentOverview} from './TournamentOverview';
import { useAuth } from '../../context/AuthContext';

interface TournamentDetailViewProps {
  tournamentId: string;
  inviteToken?: string;
  onBack: () => void;
}

export const TournamentDetailView: React.FC<TournamentDetailViewProps> = ({
  tournamentId,
  inviteToken,
  onBack,
}) => {
  const { user } = useAuth();
  const requestSequence = useRef(0);
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures' | 'participants' | 'rules'>('standings');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [tournament, setTournament] = useState<CustomTournament | null>(null);
  const [participants, setParticipants] = useState<CustomTournamentParticipant[]>([]);
  const [fixtures, setFixtures] = useState<CustomTournamentFixture[]>([]);
  const [standings, setStandings] = useState<CustomTournamentStandingsRow[] | undefined>();
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [selectedRound, setSelectedRound] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [canJoin, setCanJoin] = useState(false);

  // Modals
  const [showAdminDrawer, setShowAdminDrawer] = useState(false);
  const [adminFixtureId,setAdminFixtureId]=useState('');
  const [scoreError,setScoreError]=useState<string|null>(null);
  const [adminTab,setAdminTab] = useState<'overview'|'participants'|'matches'>('overview');
  const [showClubPickerModal, setShowClubPickerModal] = useState(false);
  const [selectedMatchForScore, setSelectedMatchForScore] = useState<CustomTournamentFixture | null>(null);

  // Score submission form
  const [submitHomeScore, setSubmitHomeScore] = useState<number>(0);
  const [submitAwayScore, setSubmitAwayScore] = useState<number>(0);
  const [submitPenHome, setSubmitPenHome] = useState<string>('');
  const [submitPenAway, setSubmitPenAway] = useState<string>('');
  const [submitProofUrl, setSubmitProofUrl] = useState<string>('');
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);

  // Club claim search
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimingClubId, setClaimingClubId] = useState<string | null>(null);

  const loadData = async () => {
    const sequence = ++requestSequence.current;
    try {
      setErrorMessage(null);
      const res = await customTournamentApi.getTournamentDetails(tournamentId, inviteToken);
      if (sequence !== requestSequence.current) return;
      setTournament(res.tournament);
      setParticipants(res.participants);
      setFixtures(res.fixtures);
      setStandings(res.standings);
      setCanManage(res.canManage);
      setCanJoin(res.canJoin);
    } catch (err: any) {
      if (sequence === requestSequence.current) setErrorMessage(err.message || 'Turnir ma’lumotlarini yuklab bo‘lmadi.');
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadData();
    return () => { requestSequence.current++; };
  }, [tournamentId, inviteToken, user?.id]);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-slate-400 space-y-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs">Turnir yuklanmoqda...</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <p className="text-sm font-bold text-rose-300">{errorMessage || 'Turnir topilmadi.'}</p>
        <button type="button" onClick={loadData} className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold">Qayta urinish</button>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold hover:bg-slate-700 transition-colors"
        >
          Orqaga qaytish
        </button>
      </div>
    );
  }

  const myParticipant = user ? participants.find((p) => p.userId === user.id) : undefined;
  const isJoined = Boolean(myParticipant);

  const groupIndexes = [...new Set((standings || []).map(r => r.groupIndex).filter((g): g is number => g !== undefined))].sort();
  const displayedStandings = (standings || []).filter(r => !groupIndexes.length || r.groupIndex === selectedGroup);
  const rounds = [...new Set(fixtures.map(f => `${f.stage}:${f.roundOrMatchday}`))];
  const displayedFixtures = fixtures.filter(f => `${f.stage}:${f.roundOrMatchday}` === (selectedRound || rounds[0]));

  const handleClaimClub = async (clubId: string) => {
    if (claimingClubId) return;
    setClaimError(null);
    try {
      setClaimingClubId(clubId);
      await customTournamentApi.joinClub(tournament.id, clubId, inviteToken);
      setShowClubPickerModal(false);
      await loadData();
    } catch (err: any) {
      setClaimError(err.message || 'Klubni band qilib bo‘lmadi.');
    } finally {
      setClaimingClubId(null);
    }
  };

  const handleLeaveTournament = async () => {
    if (!confirm('Turnirdan chiqmoqchimisiz? Tanlagan klubingiz bo‘shatiladi.')) return;
    try {
      await customTournamentApi.leaveTournament(tournament.id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Chiqib ketishda xatolik.');
    }
  };

  const handleOpenScoreModal = (fix: CustomTournamentFixture) => {
    if(!isCustomMatchReady(fix,fixtures))return;
    if(canManage){setAdminFixtureId(fix.id);setAdminTab('matches');setShowAdminDrawer(true);return;}
    setScoreError(null);
    setSelectedMatchForScore(fix);
    setSubmitHomeScore(fix.homeScore ?? 0);
    setSubmitAwayScore(fix.awayScore ?? 0);
    setSubmitPenHome(fix.penaltyHomeScore !== null && fix.penaltyHomeScore !== undefined ? String(fix.penaltyHomeScore) : '');
    setSubmitPenAway(fix.penaltyAwayScore !== null && fix.penaltyAwayScore !== undefined ? String(fix.penaltyAwayScore) : '');
    setSubmitProofUrl(fix.proofUrl || '');
  };

  const handleSubmitScore = async () => {
    if (!selectedMatchForScore||isSubmittingScore) return;
    setScoreError(null);
    try {
      setIsSubmittingScore(true);
      await customTournamentApi.submitMatchResult(tournament.id, selectedMatchForScore.id, {
        homeScore: Number(submitHomeScore),
        awayScore: Number(submitAwayScore),
        penaltyHomeScore: scoreNeedsPenalties&&submitPenHome !== '' ? Number(submitPenHome) : undefined,
        penaltyAwayScore: scoreNeedsPenalties&&submitPenAway !== '' ? Number(submitPenAway) : undefined,
        proofUrl: submitProofUrl || undefined,
      });
      setSelectedMatchForScore(null);
      loadData();
    } catch (err: any) {
      setScoreError(err.message || 'Hisobni saqlashda xatolik.');
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const scoreNeedsPenalties=!!selectedMatchForScore&&customMatchNeedsPenalties(selectedMatchForScore,fixtures,submitHomeScore,submitAwayScore);
  return (
    <div className="efl-custom-tournaments tourney-page">
      {errorMessage && <div role="alert" className="p-3 rounded-xl text-xs text-rose-400">{errorMessage}<button type="button" onClick={loadData} className="min-h-[44px] px-3 underline">Qayta urinish</button></div>}
      <TournamentOverview tournament={tournament} participants={participants} fixtures={fixtures} userId={user?.id} canManage={canManage} canJoin={canJoin} onBack={onBack} onManage={tab=>{setAdminFixtureId('');setAdminTab(tab);setShowAdminDrawer(true);}} onJoin={()=>{setClaimError(null);setShowClubPickerModal(true);}} onMatch={handleOpenScoreModal} onRefresh={loadData}/>
      {myParticipant&&tournament.status==='REGISTRATION_OPEN'&&<button onClick={handleLeaveTournament} className="tourney-muted min-h-[44px] underline justify-self-start">Turnirdan chiqish</button>}
      {/* Sub Tabs */}
      <div className="p-1 rounded-2xl bg-slate-900 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-1">
        <button
          onClick={() => setActiveTab('standings')}
          className={`min-w-0 min-h-[44px] py-2 px-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'standings' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>{tournament.format === 'PLAYOFF' ? 'Pley-off' : 'Jadval'}</span>
        </button>
        <button
          onClick={() => setActiveTab('fixtures')}
          className={`min-w-0 min-h-[44px] py-2 px-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'fixtures' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span>O‘yinlar ({fixtures.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('participants')}
          className={`min-w-0 min-h-[44px] py-2 px-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'participants' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>A’zolar ({participants.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`min-w-0 min-h-[44px] py-2 px-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'rules' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Reglament</span>
        </button>
      </div>

      {/* TAB 1: STANDINGS OR PLAYOFF BRACKET */}
      {activeTab === 'standings' && (
        <div className="space-y-4">
          {tournament.format === 'PLAYOFF' ? (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <h3 className="font-bold text-slate-200 text-sm">Pley-off Juftliklari</h3>
              {fixtures.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-6 text-center">Turnir boshlangach juftliklar tuziladi.</p>
              ) : (
                <CustomPlayoffBracket fixtures={fixtures} />
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 overflow-x-auto shadow-sm">
              {groupIndexes.length > 0 && <div className="flex gap-2 mb-3">{groupIndexes.map(g => <button key={g} onClick={() => setSelectedGroup(g)} className={`min-h-[44px] px-3 rounded-xl text-xs ${g === selectedGroup ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{String.fromCharCode(65 + g)} guruhi</button>)}</div>}
              {!standings || standings.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-6 text-center">Jadval hali shakllanmagan.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold">
                      <th className="py-2 px-2 w-8">#</th>
                      <th className="py-2 px-3">Klub</th>
                      <th className="py-2 px-2 text-center">O‘</th>
                      <th className="py-2 px-2 text-center">G‘</th>
                      <th className="py-2 px-2 text-center">D</th>
                      <th className="py-2 px-2 text-center">M</th>
                      <th className="py-2 px-2 text-center">TF</th>
                      <th className="py-2 px-2 text-center font-black text-slate-100">O</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {displayedStandings.map((row) => (
                      <tr key={row.clubId} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-2 font-bold text-slate-400">{row.position}</td>
                        <td className="py-2.5 px-3 flex items-center gap-2 font-semibold text-slate-200">
                          <ClubCrest
                            clubId={row.clubId}
                            logoUrl={row.clubLogoUrl}
                            name={row.clubName}
                            shortName={row.clubShortName}
                            size="xs"
                          />
                          <span className="truncate max-w-[140px] sm:max-w-[200px]">{row.clubName}</span>
                        </td>
                        <td className="py-2.5 px-2 text-center text-slate-400">{row.played}</td>
                        <td className="py-2.5 px-2 text-center text-slate-400">{row.won}</td>
                        <td className="py-2.5 px-2 text-center text-slate-400">{row.drawn}</td>
                        <td className="py-2.5 px-2 text-center text-slate-400">{row.lost}</td>
                        <td className="py-2.5 px-2 text-center text-slate-400 font-mono">
                          {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                        </td>
                        <td className="py-2.5 px-2 text-center font-black text-emerald-400 text-sm">
                          {row.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'standings' && tournament.format === 'LEAGUE_AND_PLAYOFF' && fixtures.some(f => f.stage.startsWith('PLAYOFF_')) && (
        <CustomPlayoffBracket fixtures={fixtures} />
      )}

      {/* TAB 2: FIXTURES */}
      {activeTab === 'fixtures' && (
        <div className="space-y-3">
          {rounds.length > 0 && <label className="block text-xs text-slate-300">Bosqich va tur
            <select value={selectedRound || rounds[0]} onChange={e => setSelectedRound(e.target.value)} className="w-full p-3 mt-1 bg-slate-900 border border-slate-800 rounded-xl">{rounds.map(r => <option key={r} value={r}>{fixtureStageLabel[r.split(':')[0] as CustomTournamentFixture['stage']]} · Tur {r.split(':')[1]}</option>)}</select>
          </label>}
          {fixtures.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-8 text-center bg-slate-900 rounded-2xl border border-slate-800">
              O‘yinlar hali rejalashtirilmagan. Turnir boshlanganda avtomatik shakllanadi.
            </p>
          ) : (
            displayedFixtures.map((fix) => {
              const isMyMatch = user ? fix.homeUserId === user.id || fix.awayUserId === user.id : false;
              return (
                <div
                  key={fix.id}
                  className="min-w-0 p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Tur: {fix.roundOrMatchday} · {fixtureStageLabel[fix.stage]}
                    </span>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-slate-200">
                      <span className="font-bold break-words [overflow-wrap:anywhere]">{fix.homeClubName}</span>
                      <span className="text-slate-500 font-normal">vs</span>
                      <span className="font-bold break-words text-right [overflow-wrap:anywhere]">{fix.awayClubName}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {fix.status === 'CONFIRMED' ? (
                      <div className="text-right">
                        <span className="text-sm font-black text-emerald-400">
                          {fix.homeScore} - {fix.awayScore}
                        </span>
                        {fix.penaltyHomeScore !== null && fix.penaltyHomeScore !== undefined && (
                          <div className="text-[10px] text-amber-400">
                            (pen: {fix.penaltyHomeScore}-{fix.penaltyAwayScore})
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                        {fixtureStatusLabel[fix.status]}
                      </span>
                    )}

                    {tournament.status === 'IN_PROGRESS' && (isMyMatch || canManage) && !['CONFIRMED', 'BYE_AUTO_ADVANCED'].includes(fix.status) && isCustomMatchReady(fix,fixtures) && (fix.status !== 'DISPUTED' || canManage) && (
                      <button
                        onClick={() => handleOpenScoreModal(fix)}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors"
                      >
                        Hisob
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: PARTICIPANTS */}
      {activeTab === 'participants' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {participants.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-8 text-center col-span-2">Qatnashchilar hali qo‘shilmagan.</p>
          ) : (
            participants.map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-xs"
              >
                <div className="w-9 h-9 rounded-xl bg-slate-950 p-1.5 border border-slate-800 flex items-center justify-center shrink-0">
                  <ClubCrest
                    clubId={p.clubId}
                    logoUrl={p.clubLogoUrl}
                    name={p.clubName}
                    shortName={p.clubShortName}
                    size="sm"
                  />
                </div>
                <div className="truncate flex-1">
                  <h4 className="font-bold text-slate-200 truncate">{p.clubName}</h4>
                  <p className="text-[11px] text-slate-400 truncate">@{p.username || 'efl_user'}{p.status === 'PENDING_APPROVAL' ? ' · Tasdiq kutilmoqda' : ''}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: REGLAMENT */}
      {activeTab === 'rules' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 text-xs text-slate-300 leading-relaxed">
          <h3 className="font-bold text-slate-100 text-sm">Turnir Reglamenti</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Liga bosqichi tenglik qoidasi:</strong> Ochko → To‘plar farqi → Urilgan gollar → O‘zaro uchrashuv natijasi.
            </li>
            <li>
              <strong>Pley-off durangi:</strong> Ikki o‘yinli yoki bir o‘yinli pley-offda durang bo‘lsa, alohida penaltilar seriyasi o‘ynaladi va kiritiladi. Safar goli qoidasi qo‘llanmaydi.
            </li>
            <li>
              <strong>O‘yin muddati:</strong> Har bir turning o‘yinlarini yakunlash uchun {tournament.rules.matchDurationHours} soat vaqt beriladi.
            </li>
            <li>
              <strong>Klub egaligi:</strong> Bir foydalanuvchi bir turnirda faqat 1 ta klubni boshqara oladi. Bir klubni 2 kishi tanlay olmaydi.
            </li>
            <li>
              <strong>Nizolarni hal qilish:</strong> Hisoblar mos kelmasa yoki bahs yuzaga kelsa, tashkilotchi yoki yordamchi admin yakuniy qarorni qabul qiladi.
            </li>
          </ul>
        </div>
      )}

      {/* ADMIN DRAWER */}
      {showAdminDrawer && (
        <TournamentAdminDrawer
          isOpen={showAdminDrawer}
          onClose={() => setShowAdminDrawer(false)}
          tournament={tournament}
          initialTab={adminTab}
          initialFixtureId={adminFixtureId}
          isOrganizer={tournament.organizerUserId === user?.id}
          participants={participants}
          fixtures={fixtures}
          onRefresh={loadData}
        />
      )}

      {/* CLUB PICKER MODAL */}
      {showClubPickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label="Turnir klubini tanlash" className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-black text-slate-100 text-base">Bo‘sh Klubni Tanlang</h3>
              <button
                aria-label="Klub tanlashni yopish"
                disabled={!!claimingClubId}
                onClick={() => setShowClubPickerModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {claimError && <p role="alert" className="text-xs text-rose-400">{claimError}</p>}
            {claimingClubId && <p role="status" className="text-xs text-emerald-400">Klub band qilinmoqda…</p>}
            <div className="overflow-y-auto min-h-0">
              <TournamentClubPicker selectedLeagueId={tournament.leagueScope === 'SINGLE_LEAGUE' ? tournament.selectedLeagueId : undefined} participants={participants} busy={!!claimingClubId} onSelect={handleClaimClub} />
            </div>
          </div>
        </div>
      )}

      {/* SCORE SUBMISSION MODAL */}
      {selectedMatchForScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label="O‘yin natijasi" className="w-full max-w-sm max-h-[90dvh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl">
            {scoreError&&<p role="alert" className="text-sm text-rose-400">{scoreError}</p>}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-black text-slate-100 text-base">O‘yin Natijasi</h3>
              <button
                onClick={() => setSelectedMatchForScore(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center space-y-1">
              <span className="text-[11px] text-slate-400">Tur: {selectedMatchForScore.roundOrMatchday}</span>
              <div className="font-bold text-slate-200 text-sm">
                {selectedMatchForScore.homeClubName} vs {selectedMatchForScore.awayClubName}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1 truncate">{selectedMatchForScore.homeClubName}</label>
                <input
                  type="number"
                  min="0" max="99" step="1"
                  value={submitHomeScore}
                  onChange={(e) => setSubmitHomeScore(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center text-base font-black text-slate-100"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1 truncate">{selectedMatchForScore.awayClubName}</label>
                <input
                  type="number"
                  min="0" max="99" step="1"
                  value={submitAwayScore}
                  onChange={(e) => setSubmitAwayScore(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center text-base font-black text-slate-100"
                />
              </div>
            </div>

            {/* Penalty input */}
            {scoreNeedsPenalties&&<div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <span className="text-[10px] font-bold text-amber-400 block uppercase">
                Penaltilar (Pley-off durang bo‘lsa)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  aria-label="Mezbon penaltilari" min={0} max={99} step={1} placeholder="Mezbon"
                  value={submitPenHome}
                  onChange={(e) => setSubmitPenHome(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 text-center"
                />
                <input
                  type="number"
                  aria-label="Mehmon penaltilari" min={0} max={99} step={1} placeholder="Mehmon"
                  value={submitPenAway}
                  onChange={(e) => setSubmitPenAway(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 text-center"
                />
              </div>
            </div>}

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Screenshot / Rasm havolasi (ixtiyoriy)</label>
              <input
                type="text"
                placeholder="https://..."
                value={submitProofUrl}
                onChange={(e) => setSubmitProofUrl(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              />
            </div>

            <button
              onClick={handleSubmitScore}
              disabled={isSubmittingScore}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
            >
              {isSubmittingScore ? 'Yuborilmoqda...' : 'Natijani yuborish / tasdiqlash'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
