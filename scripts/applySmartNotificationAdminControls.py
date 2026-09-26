from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing marker: {label}')
    return text.replace(old, new, 1)

# 1) Central smart-notification settings gate
p = Path('src/server/services/smartNotificationService.ts')
s = p.read_text()
s = replace_once(
    s,
    "import { scheduleNotificationQueueDrain } from './telegramNotificationQueue';\n",
    "import { scheduleNotificationQueueDrain } from './telegramNotificationQueue';\nimport { isSmartNotificationEventEnabled, SmartNotificationEvent } from './smartNotificationSettingsService';\n",
    'smart service settings import'
)
marker = "const SMART_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;\n"
helper = r'''const SMART_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

function inferSmartEvent(eventId: string): SmartNotificationEvent | null {
  const value = String(eventId || '').toLowerCase();
  if (value.includes(':verify:')) return 'resultVerification';
  if (value.includes(':confirmed')) return 'resultConfirmed';
  if (value.includes(':disputed')) return 'resultDisputed';
  if (value.startsWith('next-fixture:')) return 'nextOpponent';
  if (value.startsWith('matchday-open:')) return 'matchdayOpened';
  if (value.startsWith('cup-advance:') || value.startsWith('cup-champion:')) return 'cupProgress';
  if (value.includes('qualification') || value.includes('qualified')) return 'qualification';
  if (value.includes('european') || value.includes('league-phase') || value.includes('playoff')) return 'europeanOutcome';
  return null;
}
'''
s = replace_once(s, marker, helper, 'smart event inference')
gate_marker = "): Promise<boolean> {\n  const client = getUpstashClient();\n"
gate_replacement = "): Promise<boolean> {\n  const event = inferSmartEvent(params.eventId);\n  if (!(await isSmartNotificationEventEnabled(params.seasonId, event))) {\n    console.info('[SMART_NOTIFY_DISABLED]', JSON.stringify({ event, eventId: params.eventId, seasonId: params.seasonId }));\n    return false;\n  }\n\n  const client = getUpstashClient();\n"
s = replace_once(s, gate_marker, gate_replacement, 'smart enqueue gate')
p.write_text(s)

# 2) Admin API endpoints
p = Path('src/server/routes/admin.routes.ts')
s = p.read_text()
import_marker = "import { handleFirestoreError } from '../firebase/firestoreErrorHandler';\n"
settings_import = "import { handleFirestoreError } from '../firebase/firestoreErrorHandler';\nimport {\n  getSmartNotificationSettings,\n  updateSmartNotificationSettings,\n  DEFAULT_SMART_NOTIFICATION_EVENTS,\n} from '../services/smartNotificationSettingsService';\n"
s = replace_once(s, import_marker, settings_import, 'admin settings import')
router_marker = "adminRouter.use(requireAdmin);\n"
routes = r'''adminRouter.use(requireAdmin);

const smartNotificationSettingsSchema = z.object({
  seasonId: z.string().min(1).optional(),
  enabled: z.boolean(),
  events: z.object({
    resultVerification: z.boolean(),
    resultConfirmed: z.boolean(),
    resultDisputed: z.boolean(),
    nextOpponent: z.boolean(),
    matchdayOpened: z.boolean(),
    cupProgress: z.boolean(),
    qualification: z.boolean(),
    europeanOutcome: z.boolean(),
  }),
});

adminRouter.get('/telegram/smart-settings', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const settings = await getSmartNotificationSettings(seasonId);
    res.json({ settings, defaults: DEFAULT_SMART_NOTIFICATION_EVENTS, source: 'redis-or-defaults' });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'SMART_NOTIFICATION_SETTINGS_UNAVAILABLE' });
  }
});

adminRouter.put('/telegram/smart-settings', async (req: Request, res: Response) => {
  const parsed = smartNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_SMART_NOTIFICATION_SETTINGS', details: parsed.error.flatten() });
    return;
  }
  try {
    const settings = await updateSmartNotificationSettings({
      ...parsed.data,
      updatedBy: req.user!.id,
    });
    res.json({ success: true, settings });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'SMART_NOTIFICATION_SETTINGS_SAVE_FAILED' });
  }
});
'''
s = replace_once(s, router_marker, routes, 'admin smart settings routes')
p.write_text(s)

# 3) Front-end API methods
p = Path('src/lib/api.ts')
s = p.read_text()
api_marker = "  async getNotificationRecipients("
idx = s.find(api_marker)
if idx < 0:
    raise SystemExit('Missing marker: api getNotificationRecipients')
api_methods = r'''  async getSmartNotificationSettings(seasonId = 'season-2026-27'): Promise<{ settings: any; defaults: any; source: string }> {
    return request(`/api/admin/telegram/smart-settings?seasonId=${encodeURIComponent(seasonId)}`, {
      cacheTtlMs: 5000,
    });
  },

  async updateSmartNotificationSettings(payload: {
    seasonId?: string;
    enabled: boolean;
    events: Record<string, boolean>;
  }): Promise<{ success: boolean; settings: any }> {
    invalidateClientCache('/api/admin/telegram/smart-settings');
    return request('/api/admin/telegram/smart-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

'''
s = s[:idx] + api_methods + s[idx:]
p.write_text(s)

# 4) Admin Telegram UI controls
p = Path('src/components/admin/AdminTelegramTab.tsx')
s = p.read_text()
interface_marker = "interface BroadcastRecord {\n"
settings_interface = r'''interface SmartNotificationSettings {
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
'''
s = replace_once(s, interface_marker, settings_interface, 'telegram settings interface')
state_marker = "  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastRecord | null>(null);\n"
state_insert = r'''  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastRecord | null>(null);

  const [smartSettings, setSmartSettings] = useState<SmartNotificationSettings | null>(null);
  const [isLoadingSmartSettings, setIsLoadingSmartSettings] = useState(true);
  const [isSavingSmartSettings, setIsSavingSmartSettings] = useState(false);
'''
s = replace_once(s, state_marker, state_insert, 'telegram settings state')
effect_marker = "  useEffect(() => {\n    loadRecipients();\n    loadBroadcasts();\n  }, [audience, selectedLeagueId]);\n"
effect_insert = r'''  useEffect(() => {
    loadRecipients();
    loadBroadcasts();
  }, [audience, selectedLeagueId]);

  useEffect(() => {
    loadSmartSettings();
  }, []);
'''
s = replace_once(s, effect_marker, effect_insert, 'telegram settings effect')
function_marker = "  // Filtered visible recipients\n"
functions = r'''  async function loadSmartSettings() {
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

  // Filtered visible recipients
'''
s = replace_once(s, function_marker, functions, 'telegram settings functions')
jsx_marker = "      <div className=\"grid grid-cols-1 lg:grid-cols-12 gap-6\">\n"
settings_panel = r'''      <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
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
'''
s = replace_once(s, jsx_marker, settings_panel, 'telegram settings panel')
p.write_text(s)

print('Smart notification admin controls patched successfully')
