import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Bot, Shield, AlertTriangle, CheckCircle2, RefreshCw, Send, Sliders, Database, Info, Lock } from 'lucide-react';

export const AdminTelegramAiTab: React.FC = () => {
  const { user } = useAuth();
  const isOwner = user?.telegramId === '5209126900';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [redisAvailable, setRedisAvailable] = useState<boolean>(true);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form states
  const [enabled, setEnabled] = useState(false);
  const [allowedChatId, setAllowedChatId] = useState('');
  const [allowedThreadId, setAllowedThreadId] = useState('');
  const [rateLimitUser, setRateLimitUser] = useState(3);
  const [rateLimitTopic, setRateLimitTopic] = useState(15);
  const [maxDaily, setMaxDaily] = useState(500);

  // Test query runner
  const [testQuery, setTestQuery] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const loadData = async () => {
    if (!isOwner) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [cfgRes, diagRes] = await Promise.all([
        api.getTelegramAiConfig(),
        api.getTelegramAiDiagnostics().catch(() => null),
      ]);
      if (cfgRes?.success) {
        setConfig(cfgRes.config);
        setRedisAvailable(cfgRes.redisAvailable);
        setModelInfo(cfgRes.model);
        setEnabled(cfgRes.config.enabled);
        setAllowedChatId(cfgRes.config.allowedChatId !== null ? String(cfgRes.config.allowedChatId) : '');
        setAllowedThreadId(cfgRes.config.allowedThreadId !== null ? String(cfgRes.config.allowedThreadId) : '');
        setRateLimitUser(cfgRes.config.rateLimitUserPerMin || 3);
        setRateLimitTopic(cfgRes.config.rateLimitTopicPerMin || 15);
        setMaxDaily(cfgRes.config.maxDailyRequests || 500);
      }
      if (diagRes?.metrics) {
        setMetrics(diagRes.metrics);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || "Ma'lumotlarni yuklab bo'lmadi" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isOwner]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.updateTelegramAiConfig({
        enabled,
        allowedChatId: allowedChatId.trim() ? Number(allowedChatId.trim()) : null,
        allowedThreadId: allowedThreadId.trim() ? Number(allowedThreadId.trim()) : null,
        rateLimitUserPerMin: Number(rateLimitUser),
        rateLimitTopicPerMin: Number(rateLimitTopic),
        maxDailyRequests: Number(maxDaily),
      });
      if (res.success) {
        setConfig(res.config);
        setFeedback({ type: 'success', message: 'Telegram AI sozlamalari muvaffaqiyatli saqlandi' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Saqlashda xatolik yuz berdi' });
    } finally {
      setSaving(false);
    }
  };

  const handleRunTestQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await api.testTelegramAiQuery(testQuery.trim());
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ error: err.message || 'Test so‘rov bajarilmadi' });
    } finally {
      setTestLoading(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center max-w-2xl mx-auto my-6">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-3">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white mb-2">Asosiy Admin Ruxsati Talab Qilinadi</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Telegram guruhidagi AI yordamchini sozlash va boshqarish faqat tizimning asosiy admini (Telegram ID: <strong className="text-slate-200">5209126900</strong>) uchun ruxsat etilgan.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
        AI sozlamalari yuklanmoqda...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Telegram Guruh AI Yordamchisi (@efleagueuz)
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                {enabled ? 'FAOL (ON)' : "O'CHIQ (OFF)"}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Faqat belgilangan mavzuda ishlaydigan, natijalar bilan asoslangan AI yordamchi
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${feedback.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-rose-950/40 border-rose-800/60 text-rose-300'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Scope & Toggle */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Asosiy Holat va Doira</h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Ruxsat etilgan Chat ID</label>
              <input
                type="text"
                value={allowedChatId}
                onChange={(e) => setAllowedChatId(e.target.value)}
                placeholder="masalan: -100xxxxxxxxxx"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Rasmiy @efleagueuz superguruhining Telegram Chat ID raqami
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Ruxsat etilgan Thread ID (Topic)</label>
              <input
                type="text"
                value={allowedThreadId}
                onChange={(e) => setAllowedThreadId(e.target.value)}
                placeholder="masalan: 3503"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Guruhdagi belgilangan mavzu (topic) identifikatori. Telegram orqali <code className="text-emerald-400">/bind_ai_topic</code> yuborib avtomatik bog'lash tavsiya etiladi.
              </span>
            </div>

            <div className="pt-2">
              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between text-slate-400">
                  <span>AI holati bazasi:</span>
                  <span className={`font-semibold ${redisAvailable ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {redisAvailable ? 'Ulangan (Online)' : 'Uzilgan (Fail-Closed)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Bugungi so‘rovlar:</span>
                  <span className="font-mono text-slate-200">
                    {metrics?.todayRequests ?? 0} / {maxDaily}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Rate Limits & Quota */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Database className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">So'rov Limitlari va Kesh</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Foydalanuvchi limiti (so'rov / minut)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={rateLimitUser}
                onChange={(e) => setRateLimitUser(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Bitta o'yinchi minutiga ko'pi bilan yubora oladigan so'rovlar soni (standart: 3)</span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Mavzu umumiy limiti (so'rov / minut)
              </label>
              <input
                type="number"
                min={5}
                max={60}
                value={rateLimitTopic}
                onChange={(e) => setRateLimitTopic(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Butun mavzu bo'yicha minutiga maksimal so'rovlar soni (standart: 15)</span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Kunlik maksimal so'rovlar soni
              </label>
              <input
                type="number"
                min={50}
                max={5000}
                value={maxDaily}
                onChange={(e) => setMaxDaily(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Bepul kvotani himoyalash uchun kunlik yuqori chegara (standart: 500)</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Sozlamalarni Saqlash
          </button>
        </div>
      </form>

      {/* Model & Billing Notice */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-white">Model va Billing Eslatmasi</h4>
            <p className="text-[11px] text-slate-300">
              Joriy model: <strong className="text-sky-300">{modelInfo?.name || 'gemini-3.8-flash'}</strong> • API kalit:{' '}
              <span className={modelInfo?.apiKeyConfigured ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {modelInfo?.apiKeyConfigured ? 'Mavjud' : 'Kiritilmagan'}
              </span>
            </p>
            <p className="text-[11px] text-amber-300/90 pt-1">
              {modelInfo?.billingNotice || "API kaliti mavjudligi bepul kvotani kafolatlamaydi. Billing tarifi va kvotalarni Google Cloud Console orqali tekshirish lozim."}
            </p>
          </div>
        </div>
      </div>

      {/* Telegram Binding Instructions Card */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          Telegram Guruhida Bog'lash Ko'rsatmasi
        </h4>
        <div className="text-xs text-slate-300 space-y-2">
          <p>
            1. Telegram guruhidagi AI yordamchi uchun ochilgan mavzuni (topic) oching: <code className="text-emerald-300">https://t.me/efleagueuz/3503</code>
          </p>
          <p>
            2. Asosiy admin (<code className="text-slate-200">@texnoadmin</code> / ID: 5209126900) hisobidan shu mavzuda <code className="text-emerald-300 font-bold">/bind_ai_topic</code> buyrug'ini yuboring.
          </p>
          <p>
            3. Bot avtomatik ravishda haqiqiy Chat ID va Thread ID'ni aniqlab saqlaydi. Holatni tekshirish uchun <code className="text-emerald-300 font-bold">/ai_status</code> buyrug'ini yuborishingiz mumkin.
          </p>
        </div>
      </div>

      {/* Diagnostic Query Tester */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          Diagnostika: Faktlar va Grounding Tekshiruvi
        </h4>
        <p className="text-[11px] text-slate-400">
          Telegram guruhiga xabar yubormasdan, serverdagi faktlar va turnir ma'lumotlari qanday olinishini tekshirib ko'ring:
        </p>

        <form onSubmit={handleRunTestQuery} className="flex gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="Masalan: Inter bilan Milan uchrashuvi haqida nima deysan?"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={testLoading || !testQuery.trim()}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            {testLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Tekshirish
          </button>
        </form>

        {testResult && (
          <div className="mt-3 p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2">
            {testResult.error ? (
              <p className="text-rose-400">{testResult.error}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span>Aniqlangan klublar: <strong className="text-emerald-300">{testResult.detectedClubs?.join(', ') || 'Yo‘q'}</strong></span>
                  <span>•</span>
                  <span>Turnirlar: <strong className="text-emerald-300">{testResult.detectedCompetitions?.join(', ') || 'Umumiy'}</strong></span>
                  <span>•</span>
                  <span>Kesh holati: <strong className={testResult.hasStaleData ? 'text-amber-400' : 'text-emerald-400'}>{testResult.hasStaleData ? 'Eskirgan snapshot (Stale)' : 'Yangi (Fresh)'}</strong></span>
                </div>
                {testResult.factualAnswer && <p className="whitespace-pre-wrap text-emerald-300">Aniq javob: {testResult.factualAnswer}</p>}
                {testResult.dataDiagnostics && <div className="text-slate-400 space-y-1">
                  <p>Ma’lumot olish: {testResult.dataDiagnostics.durationMs} ms · {testResult.dataDiagnostics.fixturesCount} o‘yin</p>
                  {(testResult.dataDiagnostics.failedDatasets?.length > 0 || testResult.dataDiagnostics.missingDatasets?.length > 0) && <details>
                    <summary className="cursor-pointer text-amber-400">Yetishmagan kesh: {testResult.dataDiagnostics.missingDatasets?.length || 0} · O‘qish xatosi: {testResult.dataDiagnostics.failedDatasets?.length || 0}</summary>
                    <ul className="mt-1 space-y-1 break-all">{Array.from(new Set<string>([...(testResult.dataDiagnostics.missingDatasets || []), ...(testResult.dataDiagnostics.failedDatasets || [])])).map(key => <li key={key}>{key.replace(/^efluz:v1:/, '')}</li>)}</ul>
                  </details>}
                </div>}
                <div className="mt-2 pt-2 border-t border-slate-900">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Server Faktlar Konteksti:</span>
                  <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800 max-h-48 overflow-y-auto">
                    {testResult.factsSummary}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
