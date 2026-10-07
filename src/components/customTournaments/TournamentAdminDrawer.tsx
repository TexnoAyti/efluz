import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  UserPlus,
  Trash2,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  History,
  Copy,
  Check,
  Users,
} from 'lucide-react';
import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentAuditLog,
} from '../../types/customTournament';
import { customTournamentApi } from '../../lib/customTournamentApi';

interface TournamentAdminDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tournament: CustomTournament;
  participants: CustomTournamentParticipant[];
  fixtures: CustomTournamentFixture[];
  onRefresh: () => void;
}

export const TournamentAdminDrawer: React.FC<TournamentAdminDrawerProps> = ({
  isOpen,
  onClose,
  tournament,
  participants,
  fixtures,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'control' | 'assistants' | 'disputes' | 'audit'>('control');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Assistants state
  const [assistantInput, setAssistantInput] = useState('');

  // Disputes & correction state
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('');
  const [homeScore, setHomeScore] = useState<number>(0);
  const [awayScore, setAwayScore] = useState<number>(0);
  const [penHome, setPenHome] = useState<string>('');
  const [penAway, setPenAway] = useState<string>('');
  const [correctionNote, setCorrectionNote] = useState<string>('');

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<CustomTournamentAuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Link copy status
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedSpec, setCopiedSpec] = useState(false);

  useEffect(() => {
    if (isOpen && activeTab === 'audit') {
      fetchLogs();
    }
  }, [isOpen, activeTab]);

  const fetchLogs = async () => {
    try {
      setLoadingLogs(true);
      const logs = await customTournamentApi.getAuditLogs(tournament.id);
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  if (!isOpen) return null;

  const handleStartTournament = async () => {
    if (participants.length < 4) {
      setStatusMessage({ type: 'error', text: 'Boshlash uchun kamida 4 ta ishtirokchi zarur.' });
      return;
    }
    try {
      setIsLoading(true);
      setStatusMessage(null);
      await customTournamentApi.startTournament(tournament.id);
      setStatusMessage({ type: 'success', text: 'Turnir muvaffaqiyatli boshlandi va taqvim shakllantirildi!' });
      onRefresh();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Turnirni boshlashda xatolik.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAssistant = async () => {
    if (!assistantInput.trim()) return;
    try {
      setIsLoading(true);
      setStatusMessage(null);
      await customTournamentApi.updateAssistants(tournament.id, assistantInput.trim(), 'ADD');
      setAssistantInput('');
      setStatusMessage({ type: 'success', text: 'Yordamchi admin muvaffaqiyatli qo‘shildi.' });
      onRefresh();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Qo‘shishda xatolik.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAssistant = async (id: string) => {
    try {
      setIsLoading(true);
      setStatusMessage(null);
      await customTournamentApi.updateAssistants(tournament.id, id, 'REMOVE');
      setStatusMessage({ type: 'success', text: 'Yordamchi admin olib tashlandi.' });
      onRefresh();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Olib tashlashda xatolik.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCorrectScore = async () => {
    if (!selectedFixtureId) return;
    try {
      setIsLoading(true);
      setStatusMessage(null);
      await customTournamentApi.correctMatchScore(tournament.id, selectedFixtureId, {
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
        penaltyHomeScore: penHome !== '' ? Number(penHome) : undefined,
        penaltyAwayScore: penAway !== '' ? Number(penAway) : undefined,
        note: correctionNote || 'Tashkilotchi tomonidan kiritilgan rasmiy hisob',
      });
      setStatusMessage({ type: 'success', text: 'Natija muvaffaqiyatli tasdiqlandi va jadval yangilandi.' });
      setSelectedFixtureId('');
      onRefresh();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Xatolik yuz berdi.' });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, isInvite: boolean) => {
    navigator.clipboard.writeText(text);
    if (isInvite) {
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } else {
      setCopiedSpec(true);
      setTimeout(() => setCopiedSpec(false), 2000);
    }
  };

  const inviteUrl = `${window.location.origin}/?inv=${tournament.inviteToken}`;
  const specUrl = `${window.location.origin}/?spec=${tournament.spectatorToken}`;

  const disputedFixtures = fixtures.filter((f) => f.status === 'DISPUTED' || f.status === 'PENDING_CONFIRMATION');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-100 text-lg leading-tight">Turnir Boshqaruvi</h2>
              <p className="text-xs text-slate-400 truncate max-w-[260px]">{tournament.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            className={`p-3 text-xs font-medium flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-b border-rose-500/20'
            }`}
          >
            {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Tab switchers */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 p-1 gap-1">
          <button
            onClick={() => setActiveTab('control')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'control'
                ? 'bg-slate-800 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" /> Boshqaruv
          </button>
          <button
            onClick={() => setActiveTab('assistants')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'assistants'
                ? 'bg-slate-800 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" /> Yordamchilar
          </button>
          <button
            onClick={() => setActiveTab('disputes')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'disputes'
                ? 'bg-slate-800 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Nizolar {disputedFixtures.length > 0 && `(${disputedFixtures.length})`}
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'audit'
                ? 'bg-slate-800 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" /> Audit
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* TAB 1: CONTROL */}
          {activeTab === 'control' && (
            <div className="space-y-4">
              {/* Start Tournament Card */}
              {tournament.status === 'REGISTRATION_OPEN' && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">Turnirni boshlash</h4>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Hozir {participants.length} / {tournament.maxParticipants} qatnashchi ro‘yxatdan o‘tgan.
                      </p>
                    </div>
                    <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                      <Play className="w-4 h-4" />
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
                    O‘rinlar to‘lmagan taqdirda ham, tashkilotchi sifatida o‘rinlar sonini mavjud qatnashchilarga moslab
                    turnirni qo‘lda boshlashingiz mumkin.
                  </p>

                  <button
                    onClick={handleStartTournament}
                    disabled={isLoading || participants.length < 4}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Turnirni Boshlash ({participants.length} ta jamoa bilan)
                  </button>
                </div>
              )}

              {/* Tournament Links */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <h4 className="font-bold text-slate-200 text-sm">Ulashish Havolalari</h4>

                {/* Invite link */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Qatnashish uchun taklif havolasi (Ishtirokchi klub tanlashi uchun)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 font-mono truncate"
                    />
                    <button
                      onClick={() => copyToClipboard(inviteUrl, true)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                      {copiedInvite ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedInvite ? 'Nusxa olindi' : 'Nusxa'}
                    </button>
                  </div>
                </div>

                {/* Spectator link */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                    Kuzatuvchi havolasi (Faqat tomosha qilish uchun)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={specUrl}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 font-mono truncate"
                    />
                    <button
                      onClick={() => copyToClipboard(specUrl, false)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                      {copiedSpec ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSpec ? 'Nusxa olindi' : 'Nusxa'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status info */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Holat:</span>
                  <span className="font-bold text-slate-200">{tournament.status}</span>
                </div>
                <div className="flex justify-between">
                  <span>Format:</span>
                  <span className="font-bold text-slate-200">{tournament.format}</span>
                </div>
                <div className="flex justify-between">
                  <span>Ko‘rinishi:</span>
                  <span className="font-bold text-slate-200">{tournament.visibility}</span>
                </div>
                <div className="flex justify-between">
                  <span>O‘yin davomiyligi:</span>
                  <span className="font-bold text-slate-200">{tournament.rules.matchDurationHours} soat / tur</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ASSISTANTS */}
          {activeTab === 'assistants' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <h4 className="font-bold text-slate-200 text-sm">Yordamchi Admin Tayinlash</h4>
                <p className="text-xs text-slate-400">
                  Yordamchi admin faqat ushbu turnir doirasida natijalarni tasdiqlash va nizolarni hal qilish huquqiga ega bo‘ladi.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Foydalanuvchi IDsi..."
                    value={assistantInput}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleAddAssistant}
                    disabled={isLoading || !assistantInput.trim()}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-colors"
                  >
                    Qo‘shish
                  </button>
                </div>
              </div>

              {/* List of assistants */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold text-slate-400 px-1">Amaldagi Yordamchilar</h5>
                {(tournament.assistantAdminIds || []).length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
                    Hozircha yordamchi adminlar belgilanmagan.
                  </p>
                ) : (
                  (tournament.assistantAdminIds || []).map((adminId) => (
                    <div
                      key={adminId}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-sky-400" />
                        <span className="font-mono text-slate-200">{adminId}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveAssistant(adminId)}
                        disabled={isLoading}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DISPUTES & SCORE CORRECTION */}
          {activeTab === 'disputes' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <h4 className="font-bold text-slate-200 text-sm">Rasmiy Natijani Belgilash (Nizoni hal qilish)</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tashkilotchi yoki yordamchi admin o‘yin hisobini rasman tasdiqlaydi. Agar pley-offda durang bo‘lsa, penaltilar
                  seriyasini alohida kiriting.
                </p>

                {/* Select match */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">O‘yinni tanlang</label>
                  <select
                    value={selectedFixtureId}
                    onChange={(e) => {
                      setSelectedFixtureId(e.target.value);
                      const f = fixtures.find((fix) => fix.id === e.target.value);
                      if (f) {
                        setHomeScore(f.homeScore ?? 0);
                        setAwayScore(f.awayScore ?? 0);
                        setPenHome(f.penaltyHomeScore !== null && f.penaltyHomeScore !== undefined ? String(f.penaltyHomeScore) : '');
                        setPenAway(f.penaltyAwayScore !== null && f.penaltyAwayScore !== undefined ? String(f.penaltyAwayScore) : '');
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- O‘yinni tanlang --</option>
                    {fixtures.map((f) => (
                      <option key={f.id} value={f.id}>
                        [{f.status}] {f.homeClubName} vs {f.awayClubName} (Tur: {f.roundOrMatchday})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFixtureId && (
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Mezbon gollari</label>
                        <input
                          type="number"
                          min="0"
                          value={homeScore}
                          onChange={(e) => setHomeScore(Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Mehmon gollari</label>
                        <input
                          type="number"
                          min="0"
                          value={awayScore}
                          onChange={(e) => setAwayScore(Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 font-bold"
                        />
                      </div>
                    </div>

                    {/* Penalty series (optional) */}
                    <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                      <span className="text-[11px] font-bold text-amber-400 block">
                        Penaltilar seriyasi (Pley-off durang bo‘lsa)
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <input
                            type="number"
                            min="0"
                            placeholder="Mezbon penalti"
                            value={penHome}
                            onChange={(e) => setPenHome(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1 text-xs text-slate-200"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            min="0"
                            placeholder="Mehmon penalti"
                            value={penAway}
                            onChange={(e) => setPenAway(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1 text-xs text-slate-200"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Qaror izohi (Auditga yoziladi)</label>
                      <input
                        type="text"
                        placeholder="Masalan: Raqib o‘yinga chiqmadi, texnik g‘alaba"
                        value={correctionNote}
                        onChange={(e) => setCorrectionNote(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
                      />
                    </div>

                    <button
                      onClick={handleCorrectScore}
                      disabled={isLoading}
                      className="w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors"
                    >
                      Natijani Rasman Tasdiqlash
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <h4 className="font-bold text-slate-200 text-sm px-1">Turnir Boshqaruv Tarixi</h4>
              {loadingLogs ? (
                <div className="p-8 text-center text-xs text-slate-400">Yuklanmoqda...</div>
              ) : auditLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 italic bg-slate-950/40 rounded-2xl border border-slate-800">
                  Audit yozuvlari hali mavjud emas.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-bold text-emerald-400">{log.action}</span>
                      <span className="text-[10px]">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    {log.details?.note && (
                      <p className="text-slate-300 text-[11px] bg-slate-900/80 p-2 rounded-lg border border-slate-800/60">
                        {log.details.note}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
