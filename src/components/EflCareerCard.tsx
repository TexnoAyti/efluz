import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Crown,
  Flame,
  Gauge,
  LockKeyhole,
  Medal,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserRoundCheck,
  UserRoundX,
  Zap,
} from 'lucide-react';
import {
  PremiumAdminUser,
  PremiumCareerDto,
  PremiumEntitlementDto,
  premiumApi,
} from '../lib/premiumApi';

const SEASON_ID = 'season-2026-27';

type LabTab = 'career' | 'access' | 'checkout';

export const EflCareerCard: React.FC<{ userId?: string; adminPreview?: boolean }> = ({ userId, adminPreview = false }) => {
  const [users, setUsers] = useState<PremiumAdminUser[]>([]);
  const [entitlements, setEntitlements] = useState<PremiumEntitlementDto[]>([]);
  const [counts, setCounts] = useState({ totalRecords: 0, active: 0, revoked: 0, stars: 0, admin: 0 });
  const [priceStars, setPriceStars] = useState(89);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(userId || '');
  const [career, setCareer] = useState<PremiumCareerDto | null>(null);
  const [selectedEntitlement, setSelectedEntitlement] = useState<PremiumEntitlementDto | null>(null);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('Private Premium Lab QA');
  const [tab, setTab] = useState<LabTab>('career');
  const [loading, setLoading] = useState(true);
  const [careerLoading, setCareerLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const entitlementMap = useMemo(
    () => new Map(entitlements.map((item) => [item.userId, item])),
    [entitlements]
  );

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...users].sort((a, b) => {
      const aPremium = entitlementMap.get(a.id)?.status === 'ACTIVE' ? 1 : 0;
      const bPremium = entitlementMap.get(b.id)?.status === 'ACTIVE' ? 1 : 0;
      if (aPremium !== bPremium) return bPremium - aPremium;
      return (a.username || a.firstName || a.id).localeCompare(b.username || b.firstName || b.id);
    });
    if (!query) return sorted;
    return sorted.filter((item) => {
      const haystack = [item.id, item.telegramId, item.username, item.firstName, item.lastName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [users, search, entitlementMap]);

  const loadLab = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, overviewRes] = await Promise.all([
        premiumApi.getAdminUsers(),
        premiumApi.getOverview(SEASON_ID),
      ]);
      setUsers(usersRes.users || []);
      setEntitlements(overviewRes.entitlements || []);
      setCounts(overviewRes.counts);
      setPriceStars(overviewRes.priceStars || 89);
      setPublicEnabled(Boolean(overviewRes.publicEnabled));
      const nextUserId = selectedUserId || userId || usersRes.users?.[0]?.id || '';
      if (nextUserId) setSelectedUserId(nextUserId);
    } catch (err: any) {
      setError(err?.message || 'Premium Lab data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const loadCareer = async (targetUserId: string) => {
    if (!targetUserId) return;
    setCareerLoading(true);
    setError(null);
    try {
      const res = await premiumApi.getCareer(targetUserId, SEASON_ID);
      setCareer(res.career);
      setSelectedEntitlement(res.entitlement);
      setPriceStars(res.priceStars || 89);
    } catch (err: any) {
      setCareer(null);
      setSelectedEntitlement(null);
      setError(err?.message || 'Career preview could not be loaded.');
    } finally {
      setCareerLoading(false);
    }
  };

  useEffect(() => {
    if (!adminPreview) return;
    void loadLab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPreview]);

  useEffect(() => {
    if (!adminPreview || !selectedUserId) return;
    void loadCareer(selectedUserId);
  }, [adminPreview, selectedUserId]);

  if (!adminPreview) return null;

  const activeEntitlement = selectedEntitlement?.status === 'ACTIVE';
  const unlockedAchievements = career?.achievements.filter((item) => item.unlocked).length || 0;

  const handleGrant = async () => {
    if (!selectedUserId) return;
    setActionLoading(true);
    setMessage(null);
    setError(null);
    try {
      await premiumApi.grant(selectedUserId, SEASON_ID, note);
      setMessage('Premium season access granted.');
      await Promise.all([loadLab(), loadCareer(selectedUserId)]);
    } catch (err: any) {
      setError(err?.message || 'Premium grant failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!selectedUserId) return;
    setActionLoading(true);
    setMessage(null);
    setError(null);
    try {
      await premiumApi.revoke(selectedUserId, SEASON_ID, note);
      setMessage('Premium season access revoked.');
      await Promise.all([loadLab(), loadCareer(selectedUserId)]);
    } catch (err: any) {
      setError(err?.message || 'Premium revoke failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleInvoice = async () => {
    setActionLoading(true);
    setMessage(null);
    setError(null);
    try {
      const invoice = await premiumApi.createInvoice(SEASON_ID);
      const tg = (window as any)?.Telegram?.WebApp;
      if (tg?.openInvoice) {
        tg.openInvoice(invoice.invoiceLink, (status: string) => {
          setMessage(`Telegram invoice closed with status: ${status}`);
          if (status === 'paid') {
            window.setTimeout(() => {
              void loadLab();
              if (selectedUserId) void loadCareer(selectedUserId);
            }, 1200);
          }
        });
      } else {
        window.open(invoice.invoiceLink, '_blank', 'noopener,noreferrer');
        setMessage('Invoice link opened in a new tab.');
      }
    } catch (err: any) {
      setError(err?.message || 'Stars invoice could not be created.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-amber-400/25 bg-slate-950/95 shadow-[0_24px_80px_rgba(2,6,23,0.65)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.08),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />

      <div className="relative z-10 p-4 sm:p-6 lg:p-7 space-y-5">
        <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-amber-300">
                <LockKeyhole className="h-3 w-3" /> Private Premium Lab
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${publicEnabled ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${publicEnabled ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                Public visibility {publicEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            <div>
              <h2 className="flex items-center gap-2.5 text-xl sm:text-2xl font-black tracking-tight text-white">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-300/20 to-amber-600/5 text-amber-300 shadow-lg shadow-amber-950/30">
                  <Crown className="h-5 w-5" />
                </span>
                EFL UZ Premium
              </h2>
              <p className="mt-2 max-w-2xl text-xs sm:text-sm leading-relaxed text-slate-400">
                Admin-only product studio for season entitlement, Career analytics and Telegram Stars checkout. Nothing in this surface is rendered for regular players while the private lab flag stays closed.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 shrink-0 min-w-[250px]">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-right">
              <div className="text-2xl font-black tracking-tight text-amber-300">{priceStars} ⭐</div>
              <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Season pass</div>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-right">
              <div className="text-base font-black text-white">2026/27</div>
              <div className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-400">Season scoped</div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          <Kpi icon={<Crown className="h-3.5 w-3.5" />} label="Active Premium" value={counts.active} tone="amber" />
          <Kpi icon={<CircleDollarSign className="h-3.5 w-3.5" />} label="Stars buyers" value={counts.stars} tone="sky" />
          <Kpi icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Admin grants" value={counts.admin} tone="emerald" />
          <Kpi icon={<UserRoundX className="h-3.5 w-3.5" />} label="Revoked" value={counts.revoked} tone="rose" />
          <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Records" value={counts.totalRecords} tone="slate" className="col-span-2 lg:col-span-1" />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none rounded-2xl border border-white/[0.06] bg-black/20 p-1.5">
          <LabTabButton active={tab === 'career'} onClick={() => setTab('career')} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Career Studio" />
          <LabTabButton active={tab === 'access'} onClick={() => setTab('access')} icon={<UserRoundCheck className="h-3.5 w-3.5" />} label="Access Control" />
          <LabTabButton active={tab === 'checkout'} onClick={() => setTab('checkout')} icon={<Star className="h-3.5 w-3.5" />} label="Stars Checkout" />
          <button onClick={() => void loadLab()} disabled={loading} className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50" title="Refresh Premium Lab">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {(message || error) && (
          <div className={`rounded-2xl border px-3.5 py-3 text-xs font-semibold ${error ? 'border-rose-500/25 bg-rose-500/10 text-rose-200' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'}`}>
            {error || message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[310px_minmax(0,1fr)] gap-4">
          <aside className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 space-y-3 min-h-[420px]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Player selector</div>
                <div className="mt-0.5 text-xs font-bold text-white">{users.length} registered players</div>
              </div>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1 text-[9px] font-mono text-slate-500">ADMIN</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Username, ID, Telegram ID..."
                className="w-full rounded-xl border border-white/[0.07] bg-slate-950/80 py-2.5 pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/35"
              />
            </div>

            <div className="max-h-[440px] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
              {filteredUsers.map((item) => {
                const entitlement = entitlementMap.get(item.id);
                const active = entitlement?.status === 'ACTIVE';
                const selected = selectedUserId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedUserId(item.id)}
                    className={`w-full rounded-xl border p-2.5 text-left transition ${selected ? 'border-amber-400/35 bg-amber-400/[0.08] shadow-[inset_0_0_0_1px_rgba(251,191,36,0.03)]' : 'border-transparent bg-white/[0.02] hover:border-white/[0.07] hover:bg-white/[0.04]'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-[10px] font-black ${active ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-white/[0.06] bg-slate-900 text-slate-500'}`}>
                        {active ? <Crown className="h-3.5 w-3.5" /> : (item.username || item.firstName || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-black text-white">@{item.username || 'player'}</div>
                        <div className="mt-0.5 truncate text-[9px] text-slate-500">{item.firstName} {item.lastName || ''} • {item.id}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,.65)]' : 'bg-slate-700'}`} />
                        {selected && <ChevronRight className="h-3 w-3 text-amber-300" />}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!loading && filteredUsers.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-8 text-center text-[10px] text-slate-600">No matching player.</div>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {tab === 'career' && (
              <CareerStudio career={career} loading={careerLoading} selectedUser={selectedUser} entitlement={selectedEntitlement} unlockedAchievements={unlockedAchievements} />
            )}

            {tab === 'access' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Selected player</div>
                      <h3 className="mt-1 text-lg font-black text-white">@{selectedUser?.username || 'player'}</h3>
                      <p className="mt-1 text-xs text-slate-500">{selectedUser?.firstName} {selectedUser?.lastName || ''} • {selectedUser?.id || '—'}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${activeEntitlement ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                      {activeEntitlement ? <Crown className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}
                      {activeEntitlement ? 'Premium active' : 'Standard access'}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <Detail label="Season" value="2026/27" />
                    <Detail label="Source" value={selectedEntitlement?.source || '—'} />
                    <Detail label="Activated" value={selectedEntitlement?.activatedAt ? formatDate(selectedEntitlement.activatedAt) : '—'} />
                  </div>

                  <div className="mt-4">
                    <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Admin note / audit reason</label>
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={500}
                      className="w-full rounded-xl border border-white/[0.07] bg-slate-950/80 px-3 py-2.5 text-xs text-white outline-none transition focus:border-amber-400/35"
                    />
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={handleGrant}
                      disabled={!selectedUserId || actionLoading || activeEntitlement}
                      className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Crown className="h-4 w-4" /> Grant season Premium
                    </button>
                    <button
                      onClick={handleRevoke}
                      disabled={!selectedUserId || actionLoading || !activeEntitlement}
                      className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2.5 text-xs font-black text-rose-200 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <UserRoundX className="h-4 w-4" /> Revoke access
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FeatureCard icon={<ShieldCheck className="h-4 w-4" />} title="Server-side entitlement" text="Access is keyed by user + season. UI state alone can never unlock Premium." />
                  <FeatureCard icon={<Activity className="h-4 w-4" />} title="Audited actions" text="Admin grants and revocations are written to the existing EFL UZ audit trail." />
                  <FeatureCard icon={<RefreshCw className="h-4 w-4" />} title="Revocable, not destructive" text="Revoking changes entitlement state but preserves the historical record and payment source." />
                  <FeatureCard icon={<LockKeyhole className="h-4 w-4" />} title="Private beta gate" text="Regular players receive no Premium UI while public visibility remains OFF." />
                </div>
              </div>
            )}

            {tab === 'checkout' && (
              <div className="space-y-4">
                <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.11] via-slate-950 to-slate-950 p-5 sm:p-6">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-amber-300/10 blur-3xl" />
                  <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
                        <Star className="h-3.5 w-3.5" /> Telegram Stars sandbox
                      </div>
                      <h3 className="mt-2 text-xl font-black text-white">One season. One payment.</h3>
                      <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">
                        The invoice is priced at exactly {priceStars} Stars and carries a server-created order ID. Premium activates only after Telegram sends a verified successful-payment webhook. On the production bot, completing checkout uses real Telegram Stars.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-300/25 bg-black/25 px-5 py-4 text-center shrink-0">
                      <div className="text-3xl font-black tracking-tight text-amber-300">{priceStars} ⭐</div>
                      <div className="mt-1 text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">2026/27 access</div>
                    </div>
                  </div>

                  <button
                    onClick={handleInvoice}
                    disabled={actionLoading}
                    className="relative z-10 mt-5 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 text-xs font-black text-slate-950 shadow-xl shadow-amber-950/25 transition hover:bg-amber-200 disabled:opacity-50"
                  >
                    {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
                    Create {priceStars}⭐ invoice for my admin account
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Step number="01" title="Create order" text="Server stores user, Telegram ID, season and exact Stars amount before generating the invoice." />
                  <Step number="02" title="Pre-checkout" text="Telegram account, XTR currency and 89-Star amount are validated before checkout is approved." />
                  <Step number="03" title="Activate" text="Only successful_payment grants the season entitlement; payment charge IDs are idempotent." />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const CareerStudio: React.FC<{
  career: PremiumCareerDto | null;
  loading: boolean;
  selectedUser: PremiumAdminUser | null;
  entitlement: PremiumEntitlementDto | null;
  unlockedAchievements: number;
}> = ({ career, loading, selectedUser, entitlement, unlockedAchievements }) => {
  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02]"><RefreshCw className="h-5 w-5 animate-spin text-amber-300" /></div>;
  }
  if (!career) {
    return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-white/[0.09] bg-white/[0.015] text-xs text-slate-600">Select a player to inspect Premium Career.</div>;
  }

  const o = career.overall;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-black text-white">@{selectedUser?.username || 'player'} Career</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${entitlement?.status === 'ACTIVE' ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>{entitlement?.status === 'ACTIVE' ? 'Premium active' : 'Preview only'}</span>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">{career.currentClub?.name || 'No active club'} • Season 2026/27 • {career.source.toUpperCase()} snapshot</p>
          </div>
          <div className="flex items-center gap-1.5">
            {career.form.length ? career.form.map((result, index) => <FormDot key={`${result}-${index}`} result={result} />) : <span className="text-[10px] text-slate-600">No form yet</span>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Metric icon={<Trophy className="h-3.5 w-3.5" />} label="Matches" value={o.matches} />
          <Metric icon={<Flame className="h-3.5 w-3.5" />} label="W-D-L" value={`${o.wins}-${o.draws}-${o.losses}`} />
          <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="Win rate" value={`${o.winRate}%`} accent />
          <Metric icon={<Target className="h-3.5 w-3.5" />} label="Goals / GD" value={`${o.goalsFor}:${o.goalsAgainst} / ${o.goalDifference >= 0 ? '+' : ''}${o.goalDifference}`} />
          <Metric icon={<BarChart3 className="h-3.5 w-3.5" />} label="Points / PPG" value={`${o.points} / ${o.pointsPerMatch}`} />
          <Metric icon={<Zap className="h-3.5 w-3.5" />} label="Goals per match" value={o.goalsPerMatch} />
          <Metric icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Clean sheets" value={o.cleanSheets} />
          <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Best unbeaten" value={`${o.longestUnbeatenRun} games`} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-4">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h4 className="text-xs font-black text-white">Competition breakdown</h4>
              <p className="mt-0.5 text-[9px] text-slate-600">Performance split across every official competition already played.</p>
            </div>
            <span className="text-[9px] font-mono text-slate-600">{career.competitions.length} comps</span>
          </div>
          <div className="space-y-2">
            {career.competitions.length ? career.competitions.map((comp) => (
              <div key={comp.competitionId} className="rounded-xl border border-white/[0.055] bg-slate-950/65 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black capitalize text-white">{comp.name}</div>
                    <div className="mt-1 text-[9px] text-slate-500">{comp.matches} matches • {comp.wins}-{comp.draws}-{comp.losses} • GD {comp.goalDifference >= 0 ? '+' : ''}{comp.goalDifference}</div>
                  </div>
                  <div className="text-right shrink-0"><div className="text-sm font-black text-emerald-300">{comp.winRate}%</div><div className="text-[8px] uppercase text-slate-600">win rate</div></div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-300" style={{ width: `${Math.max(4, comp.winRate)}%` }} /></div>
              </div>
            )) : <div className="rounded-xl border border-dashed border-white/[0.07] p-6 text-center text-[10px] text-slate-600">No confirmed competition results yet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h4 className="text-xs font-black text-white">Achievement cabinet</h4>
              <p className="mt-0.5 text-[9px] text-slate-600">Career milestones derived from official confirmed results.</p>
            </div>
            <span className="rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-2 py-1 text-[9px] font-black text-amber-300">{unlockedAchievements}/{career.achievements.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
            {career.achievements.map((item) => (
              <div key={item.id} className={`flex items-start gap-2.5 rounded-xl border p-3 ${item.unlocked ? 'border-amber-400/20 bg-amber-400/[0.055]' : 'border-white/[0.05] bg-slate-950/45 opacity-55'}`}>
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.unlocked ? 'bg-amber-300 text-slate-950' : 'bg-slate-900 text-slate-600'}`}>{item.unlocked ? <Medal className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}</div>
                <div><div className="text-[10px] font-black text-white">{item.label}</div><div className="mt-0.5 text-[9px] leading-relaxed text-slate-500">{item.description}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'amber' | 'sky' | 'emerald' | 'rose' | 'slate'; className?: string }> = ({ icon, label, value, tone, className = '' }) => {
  const toneClass = { amber: 'text-amber-300 border-amber-400/15', sky: 'text-sky-300 border-sky-400/15', emerald: 'text-emerald-300 border-emerald-400/15', rose: 'text-rose-300 border-rose-400/15', slate: 'text-slate-300 border-white/[0.06]' }[tone];
  return <div className={`rounded-2xl border bg-white/[0.025] px-3.5 py-3 ${toneClass} ${className}`}><div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] opacity-80">{icon}{label}</div><div className="mt-1 text-xl font-black tabular-nums text-white">{value}</div></div>;
};

const LabTabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black transition ${active ? 'bg-amber-300 text-slate-950 shadow-md shadow-amber-950/20' : 'text-slate-500 hover:bg-white/[0.04] hover:text-white'}`}>{icon}{label}</button>
);

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; accent?: boolean }> = ({ icon, label, value, accent }) => (
  <div className={`rounded-xl border p-3 ${accent ? 'border-amber-400/20 bg-amber-400/[0.055]' : 'border-white/[0.055] bg-slate-950/55'}`}><div className={`text-base font-black font-mono ${accent ? 'text-amber-300' : 'text-white'}`}>{value}</div><div className="mt-1 flex items-center gap-1 text-[9px] font-semibold text-slate-500">{icon}{label}</div></div>
);

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/[0.055] bg-slate-950/55 p-3"><div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-600">{label}</div><div className="mt-1 truncate text-[11px] font-bold text-white">{value}</div></div>
);

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <div className="rounded-2xl border border-white/[0.065] bg-white/[0.025] p-4"><div className="flex items-center gap-2 text-[11px] font-black text-white"><span className="text-amber-300">{icon}</span>{title}</div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">{text}</p></div>
);

const Step: React.FC<{ number: string; title: string; text: string }> = ({ number, title, text }) => (
  <div className="rounded-2xl border border-white/[0.065] bg-white/[0.025] p-4"><div className="text-[9px] font-black tracking-[0.16em] text-amber-300">{number}</div><div className="mt-1.5 text-[11px] font-black text-white">{title}</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{text}</p></div>
);

const FormDot: React.FC<{ result: 'W' | 'D' | 'L' }> = ({ result }) => {
  const cls = result === 'W' ? 'bg-emerald-400 text-slate-950' : result === 'D' ? 'bg-amber-300 text-slate-950' : 'bg-rose-400 text-white';
  return <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-[9px] font-black shadow-sm ${cls}`}>{result}</span>;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
