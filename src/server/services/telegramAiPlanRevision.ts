import { adminPlanSchema, type AdminPlan } from './telegramAiAdminCatalog';

export type AiPlanRevision = { kind: 'score'; first: number; second: number } |
  { kind: 'round' | 'hours'; value: number } | { kind: 'username' | 'message'; value: string };

/** Bounded corrections to one delivered pending plan; never arbitrary actions. */
export function parseAiPlanRevision(text: string): AiPlanRevision | null {
  if (text.length > 800 || /[\n;]/.test(text) || /^[\/]/.test(text.trim())) return null;
  const raw = text.trim().replace(/^(?:yo[‘’ʻʼ'`]?q|aslida)\s*[,!:]?\s*/i, '').replace(/\s+(?:bo[‘’ʻʼ'`]?lsin|edi|qil|qiling|qo[‘’ʻʼ'`]?y|qo[‘’ʻʼ'`]?ying)\s*[.!]?$/i, '').trim();
  const score = /^(?:(?:hisob(?:ni)?|natija(?:ni)?)\s*[:=]?\s*)?(\d{1,2})\s*[:-]\s*(\d{1,2})$/.exec(raw);
  if (score) return { kind: 'score', first: Number(score[1]), second: Number(score[2]) };
  const round = /^(?:tur(?:ni)?\s*[:=]?\s*(\d{1,3})|(\d{1,3})\s*-?\s*tur(?:ni)?)$/i.exec(raw);
  if (round) return { kind: 'round', value: Number(round[1] || round[2]) };
  const hours = /^(?:muddat(?:ni)?\s*[:=]?\s*)?(\d{1,3})\s*soat(?:ga)?$/i.exec(raw);
  if (hours) return { kind: 'hours', value: Number(hours[1]) };
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw)) return { kind: 'username', value: raw };
  const body = /^(?:matn(?:ni)?)\s*[:=]?\s*(?:"([^"\n]+)"|“([^”\n]+)”)$/i.exec(raw);
  if (body) return { kind: 'message', value: body[1] || body[2] };
  return null;
}

export function reviseAiAdminPlan(plan: AdminPlan, revision: AiPlanRevision, scoreHomeFirst?: boolean): AdminPlan {
  const next = structuredClone(plan);
  const reject = (message: string): never => { throw new Error('CLARIFY:' + message); };
  if (revision.kind === 'score') {
    if (!['result_edit', 'result_approve'].includes(plan.action)) reject('Bu reja hisob kiritish uchun emas. O‘yin va kerakli amalni to‘liq yozing.');
    if (scoreHomeFirst === undefined) reject('Hisob tartibini aniqlash uchun ikkala jamoa nomi va hisobni to‘liq yozing.');
    Object.assign(next.body, { homeScore: scoreHomeFirst ? revision.first : revision.second, awayScore: scoreHomeFirst ? revision.second : revision.first });
  } else if (revision.kind === 'round') {
    if (revision.value < 1 || revision.value > 100) reject('Tur raqamini 1–100 orasida yozing.');
    const field = ({ matchday_control: 'matchday', cup_round: 'roundNumber', matchday_remind: 'matchday', matchday_timer: 'currentMatchday' } as Record<string, string>)[plan.action];
    if (!field) reject('Bu rejadagi turni qisqa javob bilan o‘zgartirib bo‘lmaydi. Topshiriqni to‘liq yozing.');
    next.body[field] = revision.value;
    delete next.body.expectedUpdatedAt;
  } else if (revision.kind === 'hours') {
    if (revision.value < 1 || revision.value > 720) reject('Muddatni 1–720 orasida butun soat bilan yozing.');
    if (plan.action !== 'matchday_timer' && !(plan.action === 'matchday_control' && ['EXTEND', 'RESTART'].includes(String(plan.body.action))))
      reject('Bu reja muddat belgilash uchun emas. Topshiriqni to‘liq yozing.');
    next.body.durationHours = revision.value;
  } else if (revision.kind === 'username') {
    if (plan.action !== 'club_assign') reject('Username’ni qisqa javob bilan faqat klub biriktirish rejasida almashtiraman. Boshqa amalni to‘liq yozing.');
    next.body.targetUserId = revision.value;
    next.body.expectedUsername = revision.value.slice(1);
  } else {
    if (plan.action !== 'broadcast') reject('Bu reja xabar yuborish uchun emas. Topshiriqni to‘liq yozing.');
    next.body.body = revision.value;
  }
  return adminPlanSchema.parse(next);
}

/** Replacement and invalidation are one transaction, racing confirmations safely.
 * A replacement is not confirmable through the latest pointer until delivered. */
export const AI_ADMIN_PLAN_REPLACE_LUA = `
local raw = redis.call('GET', KEYS[1])
local latest = redis.call('GET', KEYS[3])
if not raw or not latest then return 0 end
local p = cjson.decode(raw)
local l = cjson.decode(latest)
local n = cjson.decode(ARGV[6])
if p.state ~= 'pending' or p.expiresAt <= tonumber(ARGV[1]) or p.owner ~= tonumber(ARGV[2]) or p.chat ~= tonumber(ARGV[3]) or p.thread ~= tonumber(ARGV[4]) or l.token ~= ARGV[5] then return 0 end
if n.owner ~= p.owner or n.chat ~= p.chat or n.thread ~= p.thread or n.state ~= 'pending' or n.expiresAt <= tonumber(ARGV[1]) then return 0 end
if not redis.call('SET', KEYS[2], ARGV[6], 'NX', 'EX', 300) then return 0 end
p.state = 'cancelled'
redis.call('SET', KEYS[1], cjson.encode(p), 'KEEPTTL')
return 1
`;
