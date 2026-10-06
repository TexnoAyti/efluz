import { normalizeAiEntity } from './telegramAiEntities';
import { matchesAiCompetition } from './telegramAiDataService';
import { adminPlanSchema, type AdminPlan } from './telegramAiAdminCatalog';
import type { Competition } from '../../types';

export function detectExtendedAdminControl(text: string): string | null {
  const q = normalizeAiEntity(text.split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0]);
  const view = /korsat|korib chiq|tekshir|holati|royxat|qancha/.test(q);
  if (/\bai\b/.test(q) && /limit|kvota/.test(q)) return /qil\w*|belgila\w*|ozgartir\w*|qoy\w*/.test(q) ? 'ai_limits' : view ? 'ai_settings' : null;
  if (/broadcast|elon\w*|yuborilgan xabar\w*/.test(q) && /qayta yubor|qayta urin|retry/.test(q)) return 'broadcast_retry';
  if (/qabul qiluvchi\w*|recipient\w*/.test(q) && /yangila/.test(q)) return 'recipients_refresh';
  if (/read metrics|oqish statistikasi|reads statistikasi/.test(q)) return /nolga tushir|reset|tozala/.test(q) ? 'metrics_reset' : view ? 'metrics' : null;
  if (/audit|amal\w* tarixi/.test(q) && view) return 'audit';
  if (/umumiy holat|admin overview|platforma holati/.test(q) && view) return 'overview';
  if (/tasdiq kutayotgan natija\w*|tasdiqlanmagan natija\w*|pending results/.test(q) && view) return 'pending_results';
  if (/bahslar\w*|disputes|bahsli natijalar\w*/.test(q) && view) return 'disputes';
  if (/xabarnoma\w* tur\w*|notification types/.test(q) && view && !/yashir|ochir/.test(q)) return 'notification_types';
  if (/klub\w* qabul|qabul navbati|admission/.test(q) && view) return 'admission';
  if (/yevropa\w*|european/.test(q) && /saralash|qualification/.test(q) && /korib chiq|preview|korsat/.test(q)) return 'european_preview';
  if (/tur\w*|matchday|liga\w*|avtomatik rejim|auto rejim|eslatma\w*/.test(q) && !/\b(?:oyin\w*|uchrashuv\w*)\b/.test(q)) {
    if (/pauza\w*|tanaffus\w*|toxtat\w*/.test(q)) return 'matchday_pause';
    if (/avtomatik rejim\w*|auto rejim\w*/.test(q) && /qaytar|otkaz|qil/.test(q)) return 'matchday_auto';
    if (/eslatma\w*|eslat\w*/.test(q) && /yubor|jonat/.test(q)) return 'matchday_remind';
    if (/muddat\w*|timer/.test(q) && /qil\w*|belgila\w*|ozgartir\w*/.test(q) && !/uzaytir/.test(q)) return 'matchday_timer';
    if (/tur\w*|matchday/.test(q) && /holati|boshqaruv holati/.test(q) && view) return 'matchday_status';
  }
  if (/kub(?:ok|og)\w*|cup/.test(q) && /holati|health/.test(q) && view) return 'cup_health';
  return null;
}
const clarify = (text: string): never => { throw new Error('CLARIFY:' + text); };
/** Extended native plans use existing endpoints; this function never executes. */
export async function planExtendedAdminControl(text: string, read: (q: any) => Promise<any>): Promise<AdminPlan | null> {
  const action = detectExtendedAdminControl(text);
  if (!action) return null;
  const q = normalizeAiEntity(text);
  const make = (action: string, targetId?: string, body: Record<string, unknown> = {}) => adminPlanSchema.parse({ action, ...(targetId ? { targetId } : {}), body });
  if (action === 'ai_limits') {
    const kinds = [ /foydalanuvchi\w*|user\w*/.test(q) ? 'rateLimitUserPerMin' : '', /mavzu\w*|topic\w*|guruh\w*/.test(q) ? 'rateLimitTopicPerMin' : '', /kunlik|kuniga|daily/.test(q) ? 'maxDailyRequests' : '' ].filter(Boolean);
    if (kinds.length !== 1) clarify('Qaysi bitta AI limiti: foydalanuvchi/daqiqa, mavzu/daqiqa yoki kunlik?');
    const numbers = q.match(/\b\d+\b/g) || [];
    if (numbers.length !== 1 || /\d+[.,]\d+|(?:^|\s)-\s*\d+/.test(text)) clarify('Limit uchun bitta musbat butun son yozing. Masalan: “AI foydalanuvchi limitini 5 qil”.');
    const n = Number(numbers[0]), range = kinds[0] === 'maxDailyRequests' ? [10, 5000] : kinds[0] === 'rateLimitTopicPerMin' ? [1, 60] : [1, 20];
    if (n < range[0] || n > range[1]) clarify(`Bu limit ${range[0]}–${range[1]} orasida bo‘lishi kerak. O‘zimcha boshqa songa almashtirmayman.`);
    return make('ai_config', undefined, { [kinds[0]]: n });
  }
  if (action === 'broadcast_retry') {
    const ids = [...text.matchAll(/\bid\s*[:=]\s*([A-Za-z0-9_:-]+)/gi)];
    if (ids.length !== 1) clarify('Qaysi bitta yuborilgan e’lon? “id: ...” bilan xabar yuborish ishining ID’sini yozing.');
    return make(action, ids[0][1]);
  }
  if (!action.startsWith('matchday_') && action !== 'cup_health') return make(action);
  const page: any = await read({ dataset: 'competitions', limit: 30 });
  if (page.error || page.nextOffset) clarify('Musobaqalar ro‘yxati to‘liq o‘qilmadi. Turnir nomini tekshiring.');
  const found = (page.data || []).filter((c: Competition) => matchesAiCompetition(text, c));
  if (found.length !== 1) clarify('Qaysi bitta liga yoki kubok? Turnir nomini aniq yozing.');
  const comp = found[0];
  if (action === 'cup_health') {
    if (['LEAGUE', 'EUROPEAN_LEAGUE_PHASE'].includes(comp.type)) clarify('Kubok holatini tekshirish uchun kubok nomini yozing.');
    return make(action, comp.id);
  }
  if (!['LEAGUE', 'EUROPEAN_LEAGUE_PHASE'].includes(comp.type)) clarify('Bu tur boshqaruvi liga uchun. Kubok bosqichini ochish yoki qulflashni aniq yozing.');
  if (action === 'matchday_pause' || action === 'matchday_auto') return make('matchday_override', comp.id, { overrideStatus: action === 'matchday_pause' ? 'PAUSED' : 'AUTO' });
  if (action === 'matchday_status') return make(action, comp.id);
  const round = /\b(\d{1,3})\s*tur(?:ni|ga|da|dagi)?\b|\b(?:tur|matchday)\s*(\d{1,3})\b/.exec(q);
  if (action === 'matchday_remind') {
    const n = round ? Number(round[1] || round[2]) : /joriy tur/.test(q) ? comp.currentMatchday : undefined;
    if (!Number.isInteger(n) || n < 1 || n > 100) clarify('Qaysi turga eslatma yuboray? Tur raqamini yoki “joriy tur” deb yozing.');
    return make(action, comp.id, { matchday: n });
  }
  const hours = /\b(\d+)\s*soat\w*\b/.exec(q);
  if (!hours || Number(hours[1]) < 1 || Number(hours[1]) > 720 || /\d+[.,]\d+|(?:^|\s)-\s*\d+/.test(text)) clarify('Muddatni 1–720 orasida butun soat bilan yozing. Masalan: “APL tur muddatini 30 soat qil”.');
  const n = round ? Number(round[1] || round[2]) : undefined;
  if (n !== undefined && (n < 1 || n > 100)) clarify('Tur raqami 1–100 orasida bo‘lsin.');
  return make(action, comp.id, { durationHours: Number(hours[1]), ...(n ? { currentMatchday: n } : {}) });
}
