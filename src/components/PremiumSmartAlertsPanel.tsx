import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Crown,
  Gauge,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';
import { PremiumSmartAlertsDto, premiumApi } from '../lib/premiumApi';

const SEASON_ID = 'season-2026-27';

interface Props {
  userId: string;
  username?: string;
  entitlementActive: boolean;
}

export const PremiumSmartAlertsPanel: React.FC<Props> = ({ userId, username, entitlementActive }) => {
  const [prefs, setPrefs] = useState<PremiumSmartAlertsDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await premiumApi.getSmartAlerts(userId, SEASON_ID);
      setPrefs(res.preferences);
    } catch (err: any) {
      setError(err?.message || 'Smart Alert preferences could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const enabledCount = useMemo(() => {
    if (!prefs) return 0;
    return [prefs.deadlinePriority, prefs.qualificationWatch, prefs.cupProgress, prefs.formMilestones, prefs.careerDigest]
      .filter(Boolean).length;
  }, [prefs]);

  const toggle = (key: keyof Pick<PremiumSmartAlertsDto, 'enabled' | 'deadlinePriority' | 'qualificationWatch' | 'cupProgress' | 'formMilestones' | 'careerDigest'>) => {
    setPrefs((current) => current ? { ...current, [key]: !current[key] } : current);
    setMessage(null);
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await premiumApi.updateSmartAlerts(prefs);
      setPrefs(res.preferences);
      setMessage('Premium Smart Alert preferences saved.');
    } catch (err: any) {
      setError(err?.message || 'Smart Alert preferences could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const sendDigest = async () => {
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await premiumApi.sendCareerDigest(userId, SEASON_ID);
      setMessage(`Career Digest sent to @${username || 'player'}.`);
    } catch (err: any) {
      const code = String(err?.message || '');
      if (code.includes('PREMIUM_ENTITLEMENT_REQUIRED')) setError('Grant Premium first. Digests cannot be sent to a standard user.');
      else if (code.includes('PREMIUM_TARGET_TELEGRAM_UNAVAILABLE')) setError('This player has no reachable Telegram account.');
      else if (code.includes('PREMIUM_CAREER_DIGEST_DISABLED')) setError('Career Digest is disabled in this player’s Premium preferences.');
      else setError(code || 'Career Digest could not be sent.');
    } finally {
      setSending(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.08] via-slate-950 to-slate-950 p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-sky-300">
                <BellRing className="h-3 w-3" /> Premium Smart Alerts
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${entitlementActive ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
                <Crown className="h-3 w-3" /> {entitlementActive ? 'Entitled' : 'Preview only'}
              </span>
            </div>
            <h3 className="mt-3 text-lg font-black text-white">Personal notification layer</h3>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-400">
              Free tournament-critical alerts stay untouched. Premium adds personalized monitoring, Career recaps and higher-signal reminders without changing competitive gameplay.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2 text-right">
              <div className="text-lg font-black text-white">{enabledCount}/5</div>
              <div className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-600">features on</div>
            </div>
            <button onClick={() => void load()} disabled={loading} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500 hover:text-white disabled:opacity-40">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {(message || error) && (
        <div className={`rounded-xl border px-3.5 py-3 text-xs font-semibold ${error ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200' : 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'}`}>
          {error || message}
        </div>
      )}

      {prefs && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.055] pb-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Master control</div>
              <div className="mt-1 text-xs font-bold text-white">Premium Smart Alerts for @{username || 'player'}</div>
            </div>
            <Toggle checked={prefs.enabled} onClick={() => toggle('enabled')} />
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 transition ${prefs.enabled ? '' : 'opacity-45 pointer-events-none'}`}>
            <PreferenceCard icon={<Clock3 className="h-4 w-4" />} title="Priority deadline reminders" description="Higher-signal reminders around unfinished matchday obligations." checked={prefs.deadlinePriority} onClick={() => toggle('deadlinePriority')} />
            <PreferenceCard icon={<Gauge className="h-4 w-4" />} title="Qualification watch" description="Personal alerts when European qualification status meaningfully changes." checked={prefs.qualificationWatch} onClick={() => toggle('qualificationWatch')} />
            <PreferenceCard icon={<Trophy className="h-4 w-4" />} title="Cup progress" description="Round progression, next-stage context and knockout milestones." checked={prefs.cupProgress} onClick={() => toggle('cupProgress')} />
            <PreferenceCard icon={<Zap className="h-4 w-4" />} title="Form milestones" description="Unbeaten runs, win streaks and notable Career milestones." checked={prefs.formMilestones} onClick={() => toggle('formMilestones')} />
            <PreferenceCard icon={<Sparkles className="h-4 w-4" />} title="EFL Career Digest" description="Personal season snapshot with W-D-L, goals, form and Career trends." checked={prefs.careerDigest} onClick={() => toggle('careerDigest')} className="sm:col-span-2" />
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button onClick={save} disabled={saving || loading} className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-sky-400/25 bg-sky-400/10 px-4 py-2.5 text-xs font-black text-sky-200 transition hover:bg-sky-400/15 disabled:opacity-40">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save preferences
            </button>
            <button onClick={sendDigest} disabled={sending || !entitlementActive || !prefs.enabled || !prefs.careerDigest} className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-35">
              {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Career Digest now
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <InfoCard icon={<ShieldCheck className="h-4 w-4" />} title="No pay-to-win" text="Alerts improve awareness and convenience only; fixtures, results and competition rules remain identical." />
        <InfoCard icon={<Sparkles className="h-4 w-4" />} title="Personal, not broadcast" text="Career Digest is addressed to one entitled player and never uses the mass broadcast control." />
        <InfoCard icon={<BellRing className="h-4 w-4" />} title="Event-driven ready" text="Preferences are durable in Redis and can be consumed by the existing Telegram event pipeline without minute-level cron." />
      </div>
    </div>
  );
};

const PreferenceCard: React.FC<{ icon: React.ReactNode; title: string; description: string; checked: boolean; onClick: () => void; className?: string }> = ({ icon, title, description, checked, onClick, className = '' }) => (
  <button onClick={onClick} className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${checked ? 'border-sky-400/20 bg-sky-400/[0.055]' : 'border-white/[0.055] bg-slate-950/50 hover:bg-white/[0.03]'} ${className}`}>
    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${checked ? 'bg-sky-300 text-slate-950' : 'bg-slate-900 text-slate-600'}`}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-[11px] font-black text-white">{title}</span><span className="mt-1 block text-[9px] leading-relaxed text-slate-500">{description}</span></span>
    <Toggle checked={checked} onClick={onClick} compact />
  </button>
);

const Toggle: React.FC<{ checked: boolean; onClick: () => void; compact?: boolean }> = ({ checked, onClick, compact }) => (
  <span onClick={(event) => { event.stopPropagation(); onClick(); }} className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full border transition ${compact ? 'h-5 w-9' : 'h-6 w-11'} ${checked ? 'border-sky-300/40 bg-sky-300/90' : 'border-slate-700 bg-slate-900'}`}>
    <span className={`block rounded-full bg-white shadow transition-transform ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${checked ? (compact ? 'translate-x-[17px]' : 'translate-x-[22px]') : 'translate-x-1'}`} />
  </span>
);

const InfoCard: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4"><div className="flex items-center gap-2 text-[10px] font-black text-white"><span className="text-sky-300">{icon}</span>{title}</div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">{text}</p></div>
);
