import React, { useState, useEffect, useRef } from 'react';
import { X, Trophy, Layers, CheckCircle2, Ticket, Sparkles, AlertCircle, HelpCircle } from 'lucide-react';
import {
  CustomTournamentFormat,
  CustomTournamentLeagueScope,
  CustomTournamentVisibility,
  CustomTournamentSpectatorAccess,
  CustomTournamentPlayoffLegMode,
  CustomTournamentGroupStageMode,
  TournamentFormatPreview,
} from '../../types/customTournament';
import { generateTournamentPreview } from '../../lib/customTournamentEngine';
import { customTournamentApi } from '../../lib/customTournamentApi';

interface TournamentWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTournamentCreated: (tournamentId: string) => void;
}

export const TournamentWizardModal: React.FC<TournamentWizardModalProps> = ({
  isOpen,
  onClose,
  onTournamentCreated,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isAdvancedMode, setIsAdvancedMode] = useState<boolean>(false);
  const creationKey = useRef<string>('');
  const creationPayload = useRef<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ticket balance
  const [ticketBalance, setTicketBalance] = useState<number | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState<boolean>(true);

  // Form fields
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [format, setFormat] = useState<CustomTournamentFormat>('LEAGUE');
  const [leagueScope, setLeagueScope] = useState<CustomTournamentLeagueScope>('TOP5_ALL');
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [maxParticipants, setMaxParticipants] = useState<number>(8);
  const [visibility, setVisibility] = useState<CustomTournamentVisibility>('PUBLIC_OPEN');

  const [spectatorAccess, setSpectatorAccess] = useState<CustomTournamentSpectatorAccess>('PUBLIC_LINK');
  const participantLimit = leagueScope === 'TOP5_ALL' ? 32 : ['league-bundesliga', 'league-ligue-1'].includes(selectedLeagueId) ? 18 : 20;

  // Rules (Advanced)
  const [roundsCount, setRoundsCount] = useState<1 | 2>(1);
  const [playoffLegMode, setPlayoffLegMode] = useState<CustomTournamentPlayoffLegMode>('SINGLE_LEG');
  const [playoffQualifiersCount, setPlayoffQualifiersCount] = useState<2 | 4 | 8 | 16>(4);
  const [groupStageMode, setGroupStageMode] = useState<CustomTournamentGroupStageMode>('SINGLE_TABLE');
  const [groupsCount, setGroupsCount] = useState<2 | 4>(2);
  const [matchDurationHours, setMatchDurationHours] = useState<number>(36);

  // Real-time Preview
  const [preview, setPreview] = useState<TournamentFormatPreview | null>(null);

  useEffect(() => {
    if (isOpen) {
      creationKey.current = crypto.randomUUID();
      creationPayload.current = '';
      fetchTicketBalance();
    }
  }, [isOpen]);

  useEffect(() => {
    // Generate live preview instantaneously
    const p = generateTournamentPreview(format, maxParticipants, {
      roundsCount,
      playoffLegMode,
      playoffQualifiersCount,
      groupStageMode,
      groupsCount,
      matchDurationHours,
    });
    setPreview(p);
  }, [format, maxParticipants, roundsCount, playoffLegMode, playoffQualifiersCount, groupStageMode, groupsCount, matchDurationHours]);

  useEffect(() => {
    if (maxParticipants > participantLimit) setMaxParticipants(participantLimit);
    if (groupsCount === 4 && maxParticipants < 8) setGroupsCount(2);
    const valid = [2, 4, 8, 16].filter(n => n <= maxParticipants && (groupStageMode !== 'GROUPS' || n % groupsCount === 0));
    if (!valid.includes(playoffQualifiersCount)) setPlayoffQualifiersCount(valid[0] as 2 | 4 | 8 | 16);
  }, [participantLimit, maxParticipants, groupsCount, groupStageMode, playoffQualifiersCount]);

  const fetchTicketBalance = async () => {
    try {
      setLoadingTickets(true);
      setTicketError(null);
      setTicketBalance(null);
      const account = await customTournamentApi.getTicketBalance();
      setTicketBalance(account.balance);
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Chipta balansini yuklab bo‘lmadi.');
    } finally {
      setLoadingTickets(false);
    }
  };

  if (!isOpen) return null;

  const handleCreateTournament = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      // One authenticated, atomic create request
      const payload = {
          name,
          description,
          format,
          leagueScope,
          selectedLeagueId: leagueScope === 'SINGLE_LEAGUE' ? selectedLeagueId : undefined,
          maxParticipants,
          visibility,
          spectatorAccess,
          rules: {
            roundsCount,
            playoffLegMode,
            playoffQualifiersCount: format === 'LEAGUE_AND_PLAYOFF' ? playoffQualifiersCount : undefined,
            groupStageMode: format === 'LEAGUE_AND_PLAYOFF' ? groupStageMode : undefined,
            groupsCount: format === 'LEAGUE_AND_PLAYOFF' && groupStageMode === 'GROUPS' ? groupsCount : undefined,
            matchDurationHours,
          },
      };
      const signature = JSON.stringify(payload);
      if (creationPayload.current && creationPayload.current !== signature) creationKey.current = crypto.randomUUID();
      creationPayload.current = signature;
      const tournament = await customTournamentApi.createTournament({...payload, idempotencyKey: creationKey.current});
      const tournamentId = tournament.id;
      onTournamentCreated(tournamentId);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Xatolik yuz berdi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-100">Yangi Turnir Yaratish</h2>
              <p className="text-xs text-slate-400">
                {step === 1 && '1-qadam: Asosiy ma‘lumotlar va format'}
                {step === 2 && '2-qadam: Aniq reglament va sozlamalar'}
                {step === 3 && '3-qadam: Preview va e‘lon qilish'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-sm text-slate-200">
          {errorMessage && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-start gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Turnir nomi <span className="text-emerald-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: EFL Do'stlar Chempionati #1"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:border-emerald-500 focus:outline-none text-slate-100 text-sm"
                  maxLength={60}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Qisqacha tavsif (ixtiyoriy)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Turnir maqsadi, do'stona qoidalar..."
                  rows={2}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl focus:border-emerald-500 focus:outline-none text-slate-100 text-xs resize-none"
                  maxLength={160}
                />
              </div>

              {/* Format selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Musobaqa formati
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'LEAGUE', label: 'Liga', desc: 'Aylanma jadval' },
                    { id: 'PLAYOFF', label: 'Pley-off', desc: 'Kubok (Bracket)' },
                    { id: 'LEAGUE_AND_PLAYOFF', label: 'Liga + Pley-off', desc: 'Guruh + Final' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFormat(item.id as any)}
                      className={`p-2.5 rounded-2xl border text-left transition-all min-h-[44px] ${
                        format === item.id
                          ? 'bg-emerald-500/15 border-emerald-500/60 text-slate-100 shadow-sm'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-xs text-slate-200">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Scope & Clubs */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Klublar bazasi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLeagueScope('TOP5_ALL')}
                    className={`p-2.5 rounded-2xl border text-left transition-all min-h-[44px] ${
                      leagueScope === 'TOP5_ALL'
                        ? 'bg-emerald-500/15 border-emerald-500/60 text-slate-100'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-200">Top 5 barcha klublar</div>
                    <div className="text-[10px] text-slate-400">98 ta klub (PL, La Liga, Serie A...)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLeagueScope('SINGLE_LEAGUE')}
                    className={`p-2.5 rounded-2xl border text-left transition-all min-h-[44px] ${
                      leagueScope === 'SINGLE_LEAGUE'
                        ? 'bg-emerald-500/15 border-emerald-500/60 text-slate-100'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-200">Bitta tanlangan liga</div>
                    <div className="text-[10px] text-slate-400">Faqat 1 ta liga klublari</div>
                  </button>
                </div>

                {leagueScope === 'SINGLE_LEAGUE' && (
                  <select
                    value={selectedLeagueId}
                    onChange={(e) => setSelectedLeagueId(e.target.value)}
                    className="w-full mt-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs"
                  >
                    <option value="league-premier-league">Premier League (20 klub)</option>
                    <option value="league-la-liga">La Liga (20 klub)</option>
                    <option value="league-serie-a">Serie A (20 klub)</option>
                    <option value="league-bundesliga">Bundesliga (18 klub)</option>
                    <option value="league-ligue-1">Ligue 1 (18 klub)</option>
                  </select>
                )}
              </div>

              {/* Participants count slider */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-300">Qatnashchilar chegarasi:</span>
                  <strong className="text-emerald-400 text-sm">{maxParticipants} kishi</strong>
                </div>
                <input
                  type="range"
                  min={4}
                  max={participantLimit}
                  step={1}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Min: 4 kishi</span>
                  <span>O‘rtacha: 8-16 kishi</span>
                  <span>Max: {participantLimit} kishi</span>
                </div>
              </div>

              <label className="block text-xs font-semibold text-slate-300">Turnirni kuzatish
                <select value={spectatorAccess} onChange={e => setSpectatorAccess(e.target.value as CustomTournamentSpectatorAccess)} className="w-full mt-2 p-2 bg-slate-950 border border-slate-800 rounded-xl">
                  <option value="PUBLIC_LINK">Kuzatuvchilar uchun ochiq</option>
                  <option value="MEMBERS_ONLY">Faqat turnir a’zolari</option>
                </select>
              </label>
              {/* Visibility */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Kirish va qatnashish qoidasi
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'PUBLIC_OPEN', label: 'Ochiq', desc: 'Erkin qo‘shilish' },
                    { id: 'PUBLIC_MODERATED', label: 'Tasdiqli', desc: 'Ariza asosida' },
                    { id: 'PRIVATE', label: 'Yopiq', desc: 'Faqat taklif bilan' },
                  ].map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVisibility(v.id as any)}
                      className={`p-2 rounded-xl border text-left transition-all min-h-[44px] ${
                        visibility === v.id
                          ? 'bg-emerald-500/15 border-emerald-500/60 text-slate-100'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="font-semibold text-xs text-slate-200">{v.label}</div>
                      <div className="text-[10px] text-slate-400">{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Settings (Oddiy vs Kengaytirilgan) */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <div>
                  <h4 className="font-bold text-xs text-slate-200">Kengaytirilgan sozlamalar</h4>
                  <p className="text-[11px] text-slate-400">Davralar soni, o‘yin muddatlari va pley-off turlari</p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (isAdvancedMode) { setRoundsCount(1); setPlayoffLegMode('SINGLE_LEG'); setPlayoffQualifiersCount(4); setGroupStageMode('SINGLE_TABLE'); setGroupsCount(2); setMatchDurationHours(36); } setIsAdvancedMode(!isAdvancedMode); }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all min-h-[38px] ${
                    isAdvancedMode
                      ? 'bg-emerald-500 text-slate-950 shadow-md'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {isAdvancedMode ? 'Yoqilgan' : 'Oddiy rejim'}
                </button>
              </div>

              {!isAdvancedMode ? (
                <div className="p-3.5 bg-slate-950/40 border border-slate-800/80 rounded-2xl space-y-2 text-xs text-slate-300">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <Sparkles className="w-4 h-4" />
                    <span>Standart qoidalar faol:</span>
                  </div>
                  <p>• {format === 'LEAGUE' ? '1 davrali aylanma chempionat' : format === 'PLAYOFF' ? '1 o‘yinli pley-off (durangda penaltilar seriyasi)' : '1 davrali liga va eng yaxshi 4 klub uchun pley-off'}.</p>
                  <p>• Har bir o‘yinni o‘tkazish uchun 36 soat muhlat beriladi.</p>
                  <p>• Hisob va screenshotni ikki tomonlama tasdiqlash tizimi.</p>
                </div>
              ) : (
                <div className="space-y-3 p-3 bg-slate-950/60 border border-slate-800 rounded-2xl">
                  {format !== 'PLAYOFF' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Davralar soni</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setRoundsCount(1)}
                          className={`p-2 rounded-xl border text-xs font-semibold ${
                            roundsCount === 1 ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          1 davrali (1 marta o‘yin)
                        </button>
                        <button
                          type="button"
                          onClick={() => setRoundsCount(2)}
                          className={`p-2 rounded-xl border text-xs font-semibold ${
                            roundsCount === 2 ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          2 davrali (Uy / Safar)
                        </button>
                      </div>
                    </div>
                  )}

                  {format !== 'LEAGUE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Pley-off bosqichi formati</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPlayoffLegMode('SINGLE_LEG')}
                          className={`p-2 rounded-xl border text-xs font-semibold ${
                            playoffLegMode === 'SINGLE_LEG' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          1 ta o‘yin (Yakka bahs)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlayoffLegMode('TWO_LEG')}
                          className={`p-2 rounded-xl border text-xs font-semibold ${
                            playoffLegMode === 'TWO_LEG' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          2 ta o‘yin (Umumiy hisob)
                        </button>
                      </div>
                    </div>
                  )}

                  {format === 'LEAGUE_AND_PLAYOFF' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Dastlabki liga bosqichi</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setGroupStageMode('SINGLE_TABLE')}
                            className={`p-2 rounded-xl border text-xs font-semibold ${
                              groupStageMode === 'SINGLE_TABLE' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                            }`}
                          >
                            Yagona umumiy jadval
                          </button>
                          <button
                            type="button"
                            onClick={() => setGroupStageMode('GROUPS')}
                            className={`p-2 rounded-xl border text-xs font-semibold ${
                              groupStageMode === 'GROUPS' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                            }`}
                          >
                            Guruhlarga bo‘lish
                          </button>
                        </div>
                      </div>

                      {groupStageMode === 'GROUPS' && <label className="block text-xs text-slate-300">Guruhlar soni
                        <select value={groupsCount} onChange={e => setGroupsCount(Number(e.target.value) as 2 | 4)} className="w-full mt-1 p-2 bg-slate-900 border border-slate-800 rounded-xl">
                          <option value={2}>2 ta guruh</option>
                          {maxParticipants >= 8 && <option value={4}>4 ta guruh</option>}
                        </select>
                      </label>}
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Pley-offga yo‘l oladiganlar</label>
                        <select
                          value={playoffQualifiersCount}
                          onChange={(e) => setPlayoffQualifiersCount(Number(e.target.value) as any)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 text-xs"
                        >
                          {(groupStageMode !== 'GROUPS' || groupsCount === 2) && <option value={2}>Top 2 (Final)</option>}
                          <option value={4}>Top 4 (Yarim final)</option>
                          {maxParticipants >= 8 && <option value={8}>Top 8 (Chorak final)</option>}
                          {maxParticipants >= 16 && <option value={16}>Top 16 (1/8 final)</option>}
                        </select>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">O‘yin o‘tkazish muddati</label>
                    <select
                      value={matchDurationHours}
                      onChange={(e) => setMatchDurationHours(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-200 text-xs"
                    >
                      <option value={24}>24 soat (Tezkor turnir)</option>
                      <option value={36}>36 soat (Standart)</option>
                      <option value={48}>48 soat (Erkin vaqt)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Live Preview & Action */}
          {step === 3 && preview && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Jami o‘yinlar soni:</span>
                  <strong className="text-emerald-400 text-sm">{preview.totalMatches} ta o‘yin</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Bosqichlar / Turlar:</span>
                  <span className="text-slate-200 font-semibold text-xs">{preview.totalStagesOrRounds} ta tur</span>
                </div>
                <div className="text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                  <p>{preview.stagesDescription}</p>
                  {preview.byeCount ? (
                    <p className="text-amber-400 text-[11px] mt-1">
                      ℹ️ Ishtirokchilar soni {maxParticipants} nafar bo‘lgani sababli, 1-bosqichda {preview.byeCount} ta ishtirokchi o‘yinsiz keyingi bosqichga o‘tadi (BYE).
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Ticket status block */}
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <Ticket className="w-4 h-4" />
                    <span>Sizdagi chiptalar (Tickets):</span>
                  </div>
                  <span className="font-extrabold text-sm text-emerald-300">
                    {loadingTickets ? '...' : ticketBalance === null ? '—' : `${ticketBalance} ta`}
                  </span>
                </div>

                {ticketError ? (
                  <div role="alert" className="text-[11px] text-amber-300 space-y-2">
                    <p>{ticketError}</p>
                    <button type="button" onClick={fetchTicketBalance} className="underline font-bold min-h-[44px]">Qayta urinish</button>
                  </div>
                ) : loadingTickets ? (
                  <p className="text-[11px] text-slate-300">Chipta balansi tekshirilmoqda...</p>
                ) : ticketBalance !== null && ticketBalance >= 1 ? (
                  <p className="text-[11px] text-slate-300">
                    Turnir yaratish uchun <strong>1 ta chipta</strong> sarflanadi.
                  </p>
                ) : (
                  <div className="text-[11px] text-amber-300 space-y-1.5 pt-1">
                    <p>Sizda turnir e‘lon qilish uchun chipta yo‘q (1 turnir = 15 000 so‘m).</p>
                    <p className="text-slate-400">
                      Chipta olish uchun Telegram orqali <a href="https://t.me/texnoadmin" target="_blank" rel="noreferrer" className="text-emerald-400 font-bold underline">@texnoadmin</a> bilan bog‘laning.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as any)}
              className="px-4 py-2.5 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800 text-xs font-semibold min-h-[44px]"
            >
              Orqaga
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {step < 3 ? (
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => setStep((s) => (s + 1) as any)}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg disabled:opacity-40 min-h-[44px]"
              >
                Keyingisi
              </button>
            ) : (
              <>
                {ticketBalance !== null && ticketBalance >= 1 && !loadingTickets && !ticketError && (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handleCreateTournament}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold shadow-lg disabled:opacity-50 min-h-[44px] flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Turnir yaratish (1 ticket)</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
