import { normalizeAiEntity } from './telegramAiEntities';
import { matchesAiCompetition } from './telegramAiDataService';
import type { AdminPlan } from './telegramAiAdminCatalog';

export interface ReminderSelection {
  competitionId: string;
  fromMatchday: number;
  toMatchday: number;
  fixtureIds?: string[];
}
export function isReplyReminderRequest(text: string): boolean {
  return /^(?:(?:shu|osha)\s+(?:(?:oyin|uchrashuv)\w*\s+)?)?(?:eslatma(?:ni)?\s+(?:yubor(?:gin|ing)?|jonat(?:gin|ing)?)|eslat(?:gin|ing)?)$/.test(normalizeAiEntity(text));
}
/** Legacy bot lists have a fixed header. Never interpret the quoted body as commands. */
export async function reminderSelectionFromLegacyHeader(text: string, read: (q:any)=>Promise<any>): Promise<ReminderSelection|undefined> {
  if (/oxirgi saqlangan malumot|toliq oqilmadi|toliq bolmasligi|mavjud nusxada|manbalar toliq/.test(normalizeAiEntity(text))) return;
  if (!/\boynalmagan\s+\d+\s+ta\b/.test(normalizeAiEntity(text))) return;
  const header = /^([^\n]+?) — (?:(\d+)–)?(\d+)-(?:tur|turlar)(?:\n|$)/.exec(text);
  if (!header) return;
  const page = await read({dataset:'competitions',limit:30});
  if (page.error || page.complete === false || page.nextOffset) return;
  const comps = (page.data || []).filter((c:any)=>matchesAiCompetition(header[1],c));
  if (comps.length !== 1) return;
  return {competitionId:comps[0].id,fromMatchday:Number(header[2] || header[3]),toMatchday:Number(header[3])};
}
export async function planReplyReminder(text: string, selection: ReminderSelection|undefined, read: (q:any)=>Promise<any>): Promise<AdminPlan|null> {
  if (!isReplyReminderRequest(text)) return null;
  if (!selection) throw Error('CLARIFY:Qaysi o‘yinlarga eslatma yuboray? Botning o‘yinlar ro‘yxatiga reply qiling yoki liga va turni yozing.');
  const {competitionId,fromMatchday,toMatchday,fixtureIds} = selection;
  if (!competitionId || !Number.isInteger(fromMatchday) || !Number.isInteger(toMatchday) || fromMatchday < 1 || toMatchday < fromMatchday || toMatchday > 100 || fixtureIds && (!fixtureIds.length || fixtureIds.length > 1000)) throw Error('CLARIFY:Reply qilingan o‘yinlar doirasi aniq emas. Ro‘yxatni qayta so‘rang.');
  const source = await read({dataset:'competitions',competition:competitionId,limit:1});
  const comp = source.data?.[0];
  if (source.error || source.complete === false || source.data?.length !== 1 || comp.id !== competitionId) throw Error('CLARIFY:Reply qilingan turnir hozir o‘qilmadi. Ro‘yxatni yangilang.');
  return {action:'matchday_remind',targetId:competitionId,body:{matchday:toMatchday,...(fromMatchday !== toMatchday ? {fromMatchday} : {}),...(fixtureIds ? {fixtureIds:[...new Set(fixtureIds)]} : {}),seasonId:comp.seasonId}};
}
