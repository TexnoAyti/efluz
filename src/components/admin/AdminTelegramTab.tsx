import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Send,
  Users,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  MessageSquare,
  Clock,
  Shield,
  Filter,
  CheckSquare,
  Square,
  Info,
  ChevronRight,
} from 'lucide-react';

interface PublicRecipient {
  userId: string;
  username: string;
  displayName: string;
  clubId?: string;
  clubName?: string;
  leagueId?: string;
  leagueName?: string;
  hasTelegram: boolean;
  messageable: boolean;
}

interface SmartNotificationSettings {
  seasonId: string;
  enabled: boolean;
  events: {
    resultVerification: boolean;
    resultConfirmed: boolean;
    resultDisputed: boolean;
    nextOpponent: boolean;
    matchdayOpened: boolean;
    cupProgress: boolean;
    qualification: boolean;
    europeanOutcome: boolean;
  };
  updatedAt?: string;
  updatedBy?: string;
}

interface BroadcastRecord {
  id: string;
  title: string;
  body: string;
  type: string;
  targetAudience: string;
  targetLeagueId?: string;
  createdByUsername: string;
  createdAt: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIALLY_FAILED';
  metrics: {
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  };
  recipients?: Array<{
    userId: string;
    username: string;
    displayName: string;
    clubName?: string;
    status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NO_TELEGRAM';
    sentAt?: string;
    error?: string;
  }>;
}

export const AdminTelegramTab: React.FC = () => {
  const { showToast } = useAuth();

  // Audience & filters
  const [audience, setAudience] = useState<'ALL_USERS' | 'CLUB_OWNERS' | 'LEAGUE_OWNERS' | 'SELECTED_RECIPIENTS'>('SELECTED_RECIPIENTS');
  const pendingSend = useRef<{ content: string; id: string } | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Recipients
  const [recipients, setRecipients] = useState<PublicRecipient[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isLoadingRecipients, setIsLoadingRecipients] = useState<boolean>(true);

  // Message compose
  const [messageType, setMessageType] = useState<'NEW_MATCHDAY' | 'UPCOMING_MATCH' | 'COMPETITION_UPDATE' | 'CUSTOM_ALERT'>('NEW_MATCHDAY');
  const [title, setTitle] = useState<string>('Matchday 1 is Now Live!');
  const [body, setBody] = useState<string>(
    'Fixtures for Matchday 1 have been scheduled. Please submit your match results and proof screenshots through the web app.'
  );
  const [isSending, setIsSending] = useState<boolean>(false);

  // History & queue
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastRecord | null>(null);
  const [retryingBroadcastId, setRetryingBroadcastId] = useState<string | null>(null);

  const [smartSettings, setSmartSettings] = useState<SmartNotificationSettings | null>(null);
  const [isLoadingSmartSettings, setIsLoadingSmartSettings] = useState(true);
  const [isSavingSmartSettings, setIsSavingSmartSettings] = useState(false);

  useEffect(() => {
    loadRecipients();
    loadBroadcasts();
  }, [audience, selectedLeagueId]);

  useEffect(() => {
    loadSmartSettings();
  }, []);

  async function loadRecipients() {
    setIsLoadingRecipients(true);
    try {
      const res = await api.getNotificationRecipients({
        audience,
        leagueId: audience === 'LEAGUE_OWNERS' ? selectedLeagueId : undefined,
      });
      setRecipients(res.recipients || []);

      // Default all loaded recipients as selected
      const ids = audience === 'SELECTED_RECIPIENTS' ? new Set<string>() : new Set<string>(res.recipients.filter((r: PublicRecipient) => r.messageable).map((r: PublicRecipient) => r.userId));
      setSelectedUserIds(ids);
    } catch (err: any) {
      showToast(err.message || 'Failed to load recipients list', 'error');
    } finally {
      setIsLoadingRecipients(false);
    }
  }

  async function loadBroadcasts() {
    setIsLoadingHistory(true);
    try {
      const res = await api.getTelegramBroadcasts(20);
      setBroadcasts(res.broadcasts || []);
    } catch (err: any) {
      // Non-blocking
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function loadSmartSettings() {
    setIsLoadingSmartSettings(true);
    try {
      const res = await api.getSmartNotificationSettings('season-2026-27');
      setSmartSettings(res.settings);
    } catch (err: any) {
      showToast(err.message || 'Smart notification settings could not be loaded', 'error');
    } finally {
      setIsLoadingSmartSettings(false);
    }
  }

  async function saveSmartSettings(next: SmartNotificationSettings) {
    setSmartSettings(next);
    setIsSavingSmartSettings(true);
    try {
      const res = await api.updateSmartNotificationSettings({
        seasonId: next.seasonId || 'season-2026-27',
        enabled: next.enabled,
        events: next.events,
      });
      setSmartSettings(res.settings);
      showToast('Smart notification sozlamalari saqlandi', 'success');
    } catch (err: any) {
      showToast(err.message || 'Smart notification settings could not be saved', 'error');
      await loadSmartSettings();
    } finally {
      setIsSavingSmartSettings(false);
    }
  }

  function toggleSmartEvent(key: keyof SmartNotificationSettings['events']) {
    if (!smartSettings || isSavingSmartSettings) return;
    void saveSmartSettings({
      ...smartSettings,
      events: { ...smartSettings.events, [key]: !smartSettings.events[key] },
    });
  }

  const deliveryHealth = useMemo(() => broadcasts.reduce((acc, item) => {
    acc.total += Number(item.metrics?.totalRecipients || 0);
    acc.sent += Number(item.metrics?.sentCount || 0);
    acc.failed += Number(item.metrics?.failedCount || 0);
    acc.skipped += Number(item.metrics?.skippedCount || 0);
    acc.pending += Math.max(0, Number(item.metrics?.totalRecipients || 0) - Number(item.metrics?.sentCount || 0) - Number(item.metrics?.failedCount || 0) - Number(item.metrics?.skippedCount || 0));
    return acc;
  }, { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 }), [broadcasts]);

  // Filtered visible recipients
  const filteredRecipients = useMemo(() => {
    if (!searchTerm.trim()) return recipients;
    const q = searchTerm.toLowerCase();
    return recipients.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        (r.clubName && r.clubName.toLowerCase().includes(q))
    );
  }, [recipients, searchTerm]);

  function handleToggleAll(checked: boolean) {
    if (checked) {
      const newSet = new Set(filteredRecipients.map((r) => r.userId));
      setSelectedUserIds(newSet);
    } else {
      setSelectedUserIds(new Set());
    }
  }

  function handleToggleUser(userId: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function handleSendBroadcast() {
    if (!title.trim() || !body.trim()) {
      showToast('Title and message content cannot be empty.', 'info');
      return;
    }

    const targetList: string[] = Array.from(selectedUserIds);
    if (targetList.length === 0) {
      showToast('Please select at least one recipient.', 'info');
      return;
    }

    setIsSending(true);
    try {
      const content = JSON.stringify([title, body, messageType, [...targetList].sort()]);
      if (pendingSend.current?.content !== content) pendingSend.current = { content, id: crypto.randomUUID() };
      const res = await api.sendTelegramBroadcast({
        requestId: pendingSend.current.id,
        title,
        body,
        type: messageType,
        targetAudience: 'SELECTED_RECIPIENTS',
        selectedUserIds: targetList,
        seasonId: 'season-2026-27',
      });

      showToast(res.message || 'Broadcast queued successfully for delivery!', 'success');
      pendingSend.current = null;
      await api.processTelegramQueue().catch(() => showToast('Xabarlar saqlandi. Yuborishni davom ettirish uchun Process Queue tugmasini bosing.', 'info'));
      await loadBroadcasts();
    } catch (err: any) {
      showToast(err.message || 'Failed to send broadcast', 'error');
    } finally {
      setIsSending(false);
    }
  }

  async function handleProcessQueue() {
    try {
      const res = await api.processTelegramQueue();
      showToast(`Processed: ${res.result?.processed || 0} jobs`, 'info');
      await loadBroadcasts();
    } catch (err: any) {
      showToast(err.message || 'Failed to trigger queue processor', 'error');
    }
  }

  async function handleRetryFailed(broadcastId: string) {
    setRetryingBroadcastId(broadcastId);
    try {
      const res = await api.retryTelegramBroadcastFailures(broadcastId);
      showToast(res.retried > 0 ? `Retry queued for ${res.retried} failed recipient(s).` : 'No retryable failed recipients found.', res.retried > 0 ? 'success' : 'info');
      await loadBroadcasts();
    } catch (err: any) {
      showToast(err.message || 'Failed deliveries could not be retried', 'error');
    } finally {
      setRetryingBroadcastId(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Send className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Official Telegram Broadcast Center</h4>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Tanlangan foydalanuvchilarga bot orqali xabar yuboring. Yuborilish holatini quyidagi tarixdan tekshiring.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleProcessQueue}
            className="px-3 py-1.5 glass-card text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
            <span>Flush Queue</span>
          </button>
        </div>
      </div>

      <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Smart Notification Control</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Avtomatik Telegram xabarlarini productionda boshqaring. Hozircha oddiy va premium foydalanuvchilarga bir xil ishlaydi.
            </p>
          </div>
          {isLoadingSmartSettings ? (
            <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
          ) : smartSettings ? (
            <button
              onClick={() => void saveSmartSettings({ ...smartSettings, enabled: !smartSettings.enabled })}
              disabled={isSavingSmartSettings}
              className={`px-4 py-2 rounded-xl text-xs font-black border transition-all ${smartSettings.enabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'}`}
            >
              {smartSettings.enabled ? 'MASTER: ON' : 'MASTER: OFF'}
            </button>
          ) : null}
        </div>

        {smartSettings && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 ${!smartSettings.enabled ? 'opacity-50' : ''}`}>
            {([
              ['resultVerification', 'Natijani tasdiqlash', 'Raqib score yuborganda'],
              ['resultConfirmed', 'Natija tasdiqlandi', 'Final score ikki tomonga'],
              ['resultDisputed', 'Dispute alert', 'Natijalar mos kelmaganda'],
              ['nextOpponent', 'Keyingi raqib', 'Match tasdiqlangandan keyin'],
              ['matchdayOpened', 'Matchday ochildi', 'Raqib + deadline'],
              ['cupProgress', 'Cup progress', 'Next round + champion'],
              ['qualification', 'Qualification', 'UCL/UEL yo‘llanmasi'],
              ['europeanOutcome', 'European outcome', 'Direct/playoff/eliminated'],
            ] as Array<[keyof SmartNotificationSettings['events'], string, string]>).map(([key, label, detail]) => (
              <button
                key={key}
                onClick={() => toggleSmartEvent(key)}
                disabled={isSavingSmartSettings}
                className={`p-3 rounded-xl border text-left transition-all ${smartSettings.events[key]
                  ? 'bg-sky-500/10 border-sky-500/30'
                  : 'bg-slate-950 border-slate-800'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-white">{label}</span>
                  <span className={`w-2.5 h-2.5 rounded-full ${smartSettings.events[key] ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{detail}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800 pt-3">
          <span>Storage: Upstash Redis • Firestore read: 0</span>
          <span>{isSavingSmartSettings ? 'Saving…' : smartSettings?.updatedAt ? `Updated ${new Date(smartSettings.updatedAt).toLocaleString()}` : 'Defaults active'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Audience & Recipient Selection (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                <span>1. Select Target Audience</span>
              </h3>
              <span className="text-xs text-slate-400 font-semibold">
                {selectedUserIds.size} of {recipients.length} selected
              </span>
            </div>

            {/* Audience Preset Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <button
                onClick={() => setAudience('ALL_USERS')}
                className={`p-2.5 rounded-xl font-bold border transition-all text-left ${
                  audience === 'ALL_USERS'
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                All Players
              </button>
              <button
                onClick={() => setAudience('CLUB_OWNERS')}
                className={`p-2.5 rounded-xl font-bold border transition-all text-left ${
                  audience === 'CLUB_OWNERS'
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Club Owners
              </button>
              <button
                onClick={() => setAudience('LEAGUE_OWNERS')}
                className={`p-2.5 rounded-xl font-bold border transition-all text-left ${
                  audience === 'LEAGUE_OWNERS'
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Specific League
              </button>
              <button
                onClick={() => setAudience('SELECTED_RECIPIENTS')}
                className={`p-2.5 rounded-xl font-bold border transition-all text-left ${
                  audience === 'SELECTED_RECIPIENTS'
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Manual Picks
              </button>
            </div>

            {/* League Dropdown if LEAGUE_OWNERS */}
            {audience === 'LEAGUE_OWNERS' && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedLeagueId}
                  onChange={(e) => setSelectedLeagueId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white"
                >
                  <option value="league-premier-league">Premier League (England)</option>
                  <option value="league-la-liga">La Liga (Spain)</option>
                  <option value="league-serie-a">Serie A (Italy)</option>
                  <option value="league-bundesliga">Bundesliga (Germany)</option>
                  <option value="league-ligue-1">Ligue 1 (France)</option>
                </select>
              </div>
            )}

            {/* Recipient Search & Controls */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter recipients by name, username or club..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500"
                />
              </div>

              <button
                onClick={() => handleToggleAll(selectedUserIds.size < filteredRecipients.length)}
                className="px-3 py-1.5 glass-card text-xs font-bold text-slate-300 hover:text-white rounded-xl whitespace-nowrap"
              >
                {selectedUserIds.size === filteredRecipients.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Recipients List Table */}
            <div className="border border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              {isLoadingRecipients ? (
                <div className="py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Loading safe recipient directory...</span>
                </div>
              ) : filteredRecipients.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">No matching recipients found.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400">
                    <tr>
                      <th className="py-2 px-3 w-8"></th>
                      <th className="py-2 px-3">Player</th>
                      <th className="py-2 px-3">Club</th>
                      <th className="py-2 px-3 text-right">Telegram Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredRecipients.map((r) => {
                      const isChecked = selectedUserIds.has(r.userId);
                      return (
                        <tr
                          key={r.userId}
                          onClick={() => handleToggleUser(r.userId)}
                          className={`cursor-pointer hover:bg-slate-800/50 transition-colors ${
                            isChecked ? 'bg-sky-950/20' : ''
                          }`}
                        >
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleUser(r.userId)}
                              className="rounded border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-bold text-white">{r.displayName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">@{r.username}</div>
                          </td>
                          <td className="py-2 px-3">
                            {r.clubName ? (
                              <div>
                                <span className="font-bold text-slate-200">{r.clubName}</span>
                                {r.leagueName && (
                                  <div className="text-[10px] text-slate-400">{r.leagueName}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {r.hasTelegram ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                Connected
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-500">
                                No Telegram
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Compose Message & Live Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-sky-400" />
              <span>2. Compose Official Message</span>
            </h3>

            {/* Template Type */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-slate-400">Message Category</label>
              <select
                value={messageType}
                onChange={(e: any) => {
                  setMessageType(e.target.value);
                  if (e.target.value === 'NEW_MATCHDAY') {
                    setTitle('Matchday Announced!');
                    setBody('A new matchday has kicked off. Review your scheduled fixtures and coordinate with your opponent in time.');
                  } else if (e.target.value === 'UPCOMING_MATCH') {
                    setTitle('Upcoming Match Reminder');
                    setBody('You have an unplayed fixture awaiting kickoff. Ensure results are submitted before the deadline window closes.');
                  } else if (e.target.value === 'COMPETITION_UPDATE') {
                    setTitle('Competition Update');
                    setBody('Tournament brackets and standings have been updated. Visit the official portal for details.');
                  }
                }}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white"
              >
                <option value="NEW_MATCHDAY">⚽ New Matchday Announced</option>
                <option value="UPCOMING_MATCH">⏰ Upcoming Match Reminder</option>
                <option value="COMPETITION_UPDATE">🏆 Competition Update</option>
                <option value="CUSTOM_ALERT">📢 Custom Announcement</option>
              </select>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-slate-400">Message Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief announcement header..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white placeholder:text-slate-500"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase text-slate-400">Message Body</label>
                <span className="text-[10px] text-slate-500">{body.length}/1000</span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Detailed instructions or notification text..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-500 resize-none leading-relaxed"
              />
            </div>

            {/* Telegram Preview Box */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase text-slate-400">Live Telegram Preview</div>
              <div className="p-3.5 bg-slate-950 border border-sky-500/30 rounded-xl text-xs space-y-2 relative shadow-inner">
                <div className="text-[11px] font-bold text-sky-400 flex items-center gap-1.5">
                  <span>⚽ EFL UZ Official Alert</span>
                </div>
                <div className="font-black text-white text-sm">{title || 'Message Title'}</div>
                <div className="text-slate-300 text-xs whitespace-pre-wrap leading-relaxed">
                  {body || 'Message body content...'}
                </div>
                <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800">
                  Season 2026/27 • Open EFL WebApp to manage fixtures
                </div>
              </div>
            </div>

            {/* Send Button */}
            <button
              onClick={handleSendBroadcast}
              disabled={isSending || selectedUserIds.size === 0}
              className={`w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-lg ${
                selectedUserIds.size > 0 && !isSending
                  ? 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/25 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {isSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>
                {isSending
                  ? 'Enqueuing to Redis Queue...'
                  : `Send to ${selectedUserIds.size} Selected Recipients`}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-2xl border-slate-800 space-y-3">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-black text-white">Delivery Health</h3><p className="text-[10px] text-slate-500">Recent Redis broadcast records • successful users are never resent by Retry Failed</p></div><button onClick={handleProcessQueue} className="px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[10px] font-black">Process Queue</button></div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[['Total', deliveryHealth.total, 'text-white'], ['Sent', deliveryHealth.sent, 'text-emerald-300'], ['Pending', deliveryHealth.pending, 'text-sky-300'], ['Failed', deliveryHealth.failed, 'text-rose-300'], ['Skipped', deliveryHealth.skipped, 'text-slate-400']].map(([label, value, cls]) => <div key={String(label)} className="rounded-xl bg-slate-950/60 border border-white/[0.05] p-3"><div className={`text-lg font-black font-mono ${cls}`}>{value}</div><div className="text-[9px] uppercase font-bold text-slate-500">{label}</div></div>)}
        </div>
      </div>

      {/* Broadcast Delivery History Table */}
      <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-400" />
              <span>Broadcast Delivery History & Metrics</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Audited queue records tracked in Redis storage
            </p>
          </div>
          <button
            onClick={loadBroadcasts}
            disabled={isLoadingHistory}
            className="px-3 py-1.5 glass-card text-xs font-bold text-slate-300 hover:text-white rounded-xl flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isLoadingHistory ? 'animate-spin' : ''}`} />
            <span>Refresh History</span>
          </button>
        </div>

        {broadcasts.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No notification broadcasts have been enqueued in this session.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase text-slate-400">
                  <th className="py-2.5 px-3">Broadcast</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Sent By</th>
                  <th className="py-2.5 px-2 text-center">Total</th>
                  <th className="py-2.5 px-2 text-center">Sent</th>
                  <th className="py-2.5 px-2 text-center">Skipped</th>
                  <th className="py-2.5 px-2 text-center">Failed</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {broadcasts.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-900/60 transition-colors">
                    <td className="py-2 px-3">
                      <div className="font-bold text-white truncate max-w-xs">{b.title}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {new Date(b.createdAt).toLocaleTimeString()} • {b.targetAudience}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                        {b.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-300">@{b.createdByUsername}</td>
                    <td className="py-2 px-2 text-center font-mono font-bold text-white">
                      {b.metrics?.totalRecipients || 0}
                    </td>
                    <td className="py-2 px-2 text-center font-mono font-bold text-emerald-400">
                      {b.metrics?.sentCount || 0}
                    </td>
                    <td className="py-2 px-2 text-center font-mono font-bold text-slate-500">
                      {b.metrics?.skippedCount || 0}
                    </td>
                    <td className="py-2 px-2 text-center font-mono font-bold text-rose-400">
                      {b.metrics?.failedCount || 0}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          b.status === 'COMPLETED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : b.status === 'PARTIALLY_FAILED'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-sky-500/20 text-sky-300 border border-sky-500/30 animate-pulse'
                        }`}
                      >
                        {b.status}
                      </span>
                      {(b.metrics?.failedCount || 0) > 0 && (
                        <button
                          onClick={() => handleRetryFailed(b.id)}
                          disabled={retryingBroadcastId === b.id}
                          className="ml-2 px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          {retryingBroadcastId === b.id ? 'Retrying…' : 'Retry Failed'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
