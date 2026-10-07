import React, { useState, useEffect } from 'react';
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
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TournamentAdminDrawer } from './TournamentAdminDrawer';
import { ClubCrest } from '../ClubCrest';
import { TOP5_CLUBS } from '../../constants/top5Clubs';
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
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures' | 'participants' | 'rules'>('standings');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [tournament, setTournament] = useState<CustomTournament | null>(null);
  const [participants, setParticipants] = useState<CustomTournamentParticipant[]>([]);
  const [fixtures, setFixtures] = useState<CustomTournamentFixture[]>([]);
  const [standings, setStandings] = useState<CustomTournamentStandingsRow[] | undefined>();
  const [canManage, setCanManage] = useState(false);

  // Modals
  const [showAdminDrawer, setShowAdminDrawer] = useState(false);
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
  const [clubSearch, setClubSearch] = useState('');
  const [claimingClubId, setClaimingClubId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await customTournamentApi.getTournamentDetails(tournamentId, inviteToken);
      setTournament(res.tournament);
      setParticipants(res.participants);
      setFixtures(res.fixtures);
      setStandings(res.standings);
      setCanManage(res.canManage);
    } catch (err: any) {
      setErrorMessage(err.message || 'Turnir ma’lumotlarini yuklab bo‘lmadi.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tournamentId, inviteToken]);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-slate-400 space-y-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs">Turnir yuklanmoqda...</p>
      </div>
    );
  }

  if (errorMessage || !tournament) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <p className="text-sm font-bold text-rose-300">{errorMessage || 'Turnir topilmadi.'}</p>
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

  // Filter allowed clubs for claiming
  const allowedSeedClubs = TOP5_CLUBS.filter((c) => {
    if (tournament.leagueScope === 'SINGLE_LEAGUE' && tournament.selectedLeagueId) {
      return c.leagueId === tournament.selectedLeagueId;
    }
    return true;
  });

  const availableClubs = allowedSeedClubs.filter(
    (c) => !participants.some((p) => p.clubId === c.id) &&
      (c.name.toLowerCase().includes(clubSearch.toLowerCase()) ||
       c.shortName.toLowerCase().includes(clubSearch.toLowerCase()))
  );

  const handleClaimClub = async (clubId: string) => {
    try {
      setClaimingClubId(clubId);
      await customTournamentApi.joinClub(tournament.id, clubId);
      setShowClubPickerModal(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Klubni band qilib bo‘lmadi.');
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
    setSelectedMatchForScore(fix);
    setSubmitHomeScore(fix.homeScore ?? 0);
    setSubmitAwayScore(fix.awayScore ?? 0);
    setSubmitPenHome(fix.penaltyHomeScore !== null && fix.penaltyHomeScore !== undefined ? String(fix.penaltyHomeScore) : '');
    setSubmitPenAway(fix.penaltyAwayScore !== null && fix.penaltyAwayScore !== undefined ? String(fix.penaltyAwayScore) : '');
    setSubmitProofUrl(fix.proofUrl || '');
  };

  const handleSubmitScore = async () => {
    if (!selectedMatchForScore) return;
    try {
      setIsSubmittingScore(true);
      await customTournamentApi.submitMatchResult(tournament.id, selectedMatchForScore.id, {
        homeScore: Number(submitHomeScore),
        awayScore: Number(submitAwayScore),
        penaltyHomeScore: submitPenHome !== '' ? Number(submitPenHome) : undefined,
        penaltyAwayScore: submitPenAway !== '' ? Number(submitPenAway) : undefined,
        proofUrl: submitProofUrl || undefined,
      });
      setSelectedMatchForScore(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Hisobni saqlashda xatolik.');
    } finally {
      setIsSubmittingScore(false);
    }
  };

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-100 transition-colors p-2 rounded-xl hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Barcha turnirlar</span>
        </button>

        {canManage && (
          <button
            onClick={() => setShowAdminDrawer(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-xs font-black transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Boshqaruv</span>
          </button>
        )}
      </div>

      {/* Tournament Hero Card */}
      <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800/80 shadow-xl space-y-4 backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                {tournament.format === 'LEAGUE' ? 'Liga' : tournament.format === 'PLAYOFF' ? 'Pley-off' : 'Liga + Pley-off'}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                {tournament.status === 'REGISTRATION_OPEN' ? 'Qabul ochiq' : tournament.status === 'IN_PROGRESS' ? 'Davom etmoqda' : tournament.status}
              </span>
              {tournament.visibility === 'PRIVATE' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Yopiq
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">{tournament.name}</h1>
            <p className="text-xs text-slate-400">
              Tashkilotchi: <strong className="text-slate-300">@{tournament.organizerUsername || 'efl_user'}</strong> · Qatnashchilar: {participants.length}/{tournament.maxParticipants}
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
        </div>

        {tournament.description && (
          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
            {tournament.description}
          </p>
        )}

        {/* User participation banner */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
          {isJoined && myParticipant ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-950 p-1 border border-slate-800 flex items-center justify-center">
                <ClubCrest
                  clubId={myParticipant.clubId}
                  logoUrl={myParticipant.clubLogoUrl}
                  name={myParticipant.clubName}
                  shortName={myParticipant.clubShortName}
                  size="sm"
                />
              </div>
              <div className="text-xs">
                <span className="text-slate-400">Sizning klubingiz: </span>
                <strong className="text-emerald-400">{myParticipant.clubName}</strong>
              </div>
              {tournament.status === 'REGISTRATION_OPEN' && (
                <button
                  onClick={handleLeaveTournament}
                  className="text-xs text-rose-400 hover:text-rose-300 ml-2 flex items-center gap-1 font-semibold"
                >
                  <LogOut className="w-3.5 h-3.5" /> Chiqish
                </button>
              )}
            </div>
          ) : tournament.status === 'REGISTRATION_OPEN' ? (
            <button
              onClick={() => setShowClubPickerModal(true)}
              className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Users className="w-4 h-4" />
              Klub tanlash va qo‘shilish
            </button>
          ) : (
            <span className="text-xs text-slate-500 italic">Ro‘yxatdan o‘tish yopilgan</span>
          )}
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="p-1 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-1">
        <button
          onClick={() => setActiveTab('standings')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'standings' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>{tournament.format === 'PLAYOFF' ? 'Bracket' : 'Jadval'}</span>
        </button>
        <button
          onClick={() => setActiveTab('fixtures')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'fixtures' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span>O‘yinlar ({fixtures.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('participants')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'participants' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Qatnashchilar ({participants.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 ${
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
                <p className="text-xs text-slate-500 italic p-6 text-center">Turnir boshlangach bracket tuziladi.</p>
              ) : (
                <div className="space-y-2.5">
                  {fixtures.map((f) => (
                    <div
                      key={f.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-bold text-slate-200">{f.homeClubName}</span>
                        <span className="text-slate-500">vs</span>
                        <span className="font-bold text-slate-200">{f.awayClubName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {f.status === 'CONFIRMED' ? (
                          <span className="font-black text-emerald-400 text-sm">
                            {f.homeScore} - {f.awayScore}
                            {f.penaltyHomeScore !== null && f.penaltyHomeScore !== undefined && (
                              <span className="text-[10px] text-amber-400 ml-1">
                                (pen: {f.penaltyHomeScore}-{f.penaltyAwayScore})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">{f.status}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 overflow-x-auto shadow-sm">
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
                    {standings.map((row) => (
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

      {/* TAB 2: FIXTURES */}
      {activeTab === 'fixtures' && (
        <div className="space-y-3">
          {fixtures.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-8 text-center bg-slate-900 rounded-2xl border border-slate-800">
              O‘yinlar hali rejalashtirilmagan. Turnir boshlanganda avtomatik shakllanadi.
            </p>
          ) : (
            fixtures.map((fix) => {
              const isMyMatch = user ? fix.homeUserId === user.id || fix.awayUserId === user.id : false;
              return (
                <div
                  key={fix.id}
                  className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Tur: {fix.roundOrMatchday} · {fix.stage}
                    </span>
                    <div className="flex items-center gap-2 text-slate-200">
                      <span className="font-bold truncate">{fix.homeClubName}</span>
                      <span className="text-slate-500 font-normal">vs</span>
                      <span className="font-bold truncate">{fix.awayClubName}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
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
                        {fix.status === 'PENDING_CONFIRMATION' ? 'Tasdiq kutilmoqda' : fix.status === 'DISPUTED' ? 'Nizo' : 'Rejada'}
                      </span>
                    )}

                    {(isMyMatch || canManage) && fix.status !== 'CONFIRMED' && (
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
                  <p className="text-[11px] text-slate-400 truncate">@{p.username || 'efl_user'}</p>
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
          participants={participants}
          fixtures={fixtures}
          onRefresh={loadData}
        />
      )}

      {/* CLUB PICKER MODAL */}
      {showClubPickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-black text-slate-100 text-base">Bo‘sh Klubni Tanlang</h3>
              <button
                onClick={() => setShowClubPickerModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              placeholder="Klub nomi bo‘yicha qidirish..."
              value={clubSearch}
              onChange={(e) => setClubSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {availableClubs.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-6 text-center">Bo‘sh klub topilmadi.</p>
              ) : (
                availableClubs.map((club) => (
                  <div
                    key={club.id}
                    onClick={() => handleClaimClub(club.id)}
                    className="p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 p-1 border border-slate-800 flex items-center justify-center">
                        <ClubCrest
                          clubId={club.id}
                          logoUrl={club.logoUrl}
                          name={club.name}
                          shortName={club.shortName}
                          size="xs"
                        />
                      </div>
                      <span className="font-bold text-slate-200 text-xs">{club.name}</span>
                    </div>

                    <button
                      disabled={claimingClubId === club.id}
                      className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950 font-bold text-xs transition-colors"
                    >
                      {claimingClubId === club.id ? 'Band qilinmoqda...' : 'Tanlash'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SCORE SUBMISSION MODAL */}
      {selectedMatchForScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl">
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
                  min="0"
                  value={submitHomeScore}
                  onChange={(e) => setSubmitHomeScore(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center text-base font-black text-slate-100"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1 truncate">{selectedMatchForScore.awayClubName}</label>
                <input
                  type="number"
                  min="0"
                  value={submitAwayScore}
                  onChange={(e) => setSubmitAwayScore(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center text-base font-black text-slate-100"
                />
              </div>
            </div>

            {/* Penalty input */}
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <span className="text-[10px] font-bold text-amber-400 block uppercase">
                Penaltilar (Pley-off durang bo‘lsa)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Mezbon"
                  value={submitPenHome}
                  onChange={(e) => setSubmitPenHome(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 text-center"
                />
                <input
                  type="number"
                  placeholder="Mehmon"
                  value={submitPenAway}
                  onChange={(e) => setSubmitPenAway(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 text-center"
                />
              </div>
            </div>

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
              {isSubmittingScore ? 'Yuborilmoqda...' : 'Natijani Tasdiqlashga Yuborish'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
