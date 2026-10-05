import { detectNaturalAdminAction } from './telegramAiAdminLanguage';
import { adminPlanSchema, type AdminPlan } from './telegramAiAdminCatalog';
import { normalizeAiEntity, resolveAiClubs } from './telegramAiEntities';
import { createAiTournamentReader } from './telegramAiDataService';
import { findConversationCompetitions, requestedMatchday } from './telegramAiConversationCommands';
import { detectAiCupStage } from './telegramAiCupStage';
import { createAiSnapshotReader } from './telegramAiSnapshotReader';
import { getAdminUserDirectory } from './adminUserDirectory';
import { withinAiDeadline } from './telegramAiDeadline';
import type { Club, Competition, User } from '../../types';

const clarify = (message: string): never => { throw new Error('CLARIFY:' + message); };
const maskUser = (text: string) => text.replace(/@\s*[A-Za-z0-9_]+/g, ' ');
const reason = (text: string) => /(?:sabab|izoh)\s*:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
export interface NaturalPlannerDependencies {
  read: (query: any) => Promise<any>;
  users: () => Promise<Pick<User,'id'|'username'|'telegramId'>[]>;
}

async function pages(read: NaturalPlannerDependencies['read'], query: any): Promise<any[]> {
  const first = await read({ ...query, limit: 30 });
  if (first.error) clarify('So‘ralgan ma’lumot bazada aniqlanmadi. Klub, turnir yoki IDni tekshiring.');
  const rows = [...(first.data || [])];
  for (let offset = 30; offset < (first.total || 0) && offset < 10000; offset += 30) {
    const next = await read({ ...query, offset, limit: 30 });
    if (next.error || !next.data?.length) clarify('Ro‘yxat to‘liq o‘qilmadi. Hozir amalni aniq rejalashtirib bo‘lmaydi.');
    rows.push(...next.data);
  }
  return rows;
}
async function userId(text: string, deps: NaturalPlannerDependencies): Promise<string> {
  const request = text.replace(/^\/ai_admin(?:@[A-Za-z0-9_]+)?\s*/i, '');
  const names = [...request.matchAll(/@\s*([^\s,;:!?“”"‘’'`]+)/g)].map(m => m[1]);
  const ids = [...request.matchAll(/\buser-\d+\b/g)].map(m => m[0]);
  if (names.length + ids.length !== 1) clarify('Qaysi foydalanuvchi? Bitta @username yoki user-123456 ko‘rinishidagi ID yozing.');
  if (ids.length) return ids[0];
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(names[0])) clarify('Telegram username noto‘g‘ri. Bitta to‘liq @username yozing.');
  let users: Awaited<ReturnType<NaturalPlannerDependencies['users']>>;
  try { users = await deps.users(); } catch { return clarify('Foydalanuvchilar ro‘yxati hozir o‘qilmadi. Aniq user-ID yozing yoki baza tiklangach urinib ko‘ring.'); }
  const matches = users.filter(u => (u.username || '').replace(/^@/, '').toLowerCase() === names[0].toLowerCase());
  if (matches.length !== 1) clarify(matches.length ? 'Username bir nechta akkauntga mos keldi. Aniq user-ID yozing.' : 'Bu username bilan foydalanuvchi topilmadi. Avval botga kirganligini yoki username yozilishini tekshiring.');
  return matches[0].id;
}


/** Score order always follows the two explicitly named clubs, even with a fixture ID. */
export function resolveAdminScore(text: string, clubs: Club[], fixture: {homeClubId:string;awayClubId:string}) {
  const scores = [...text.matchAll(/\b(\d{1,2})\s*[:-]\s*(\d{1,2})\b/g)];
  if (scores.length !== 1) clarify('Qaysi hisobni saqlay yoki tasdiqlay? Masalan: “Inter — Milan 10-tur natijasini 2-1 qil”.');
  if (clubs.length !== 2 || new Set(clubs.map(c=>c.id)).size !== 2 || !clubs.every(c=>[fixture.homeClubId,fixture.awayClubId].includes(c.id)))
    clarify('Hisobni qaysi jamoaga tegishli ekanini aniqlash uchun ikkala jamoa nomini yozing. Masalan: “Nottingham Forest 5-1 Arsenal 11-tur natijasini kirit”.');
  const [a,b] = [Number(scores[0][1]),Number(scores[0][2])];
  const reversed = clubs[0].id === fixture.awayClubId;
  return {homeScore:reversed?b:a,awayScore:reversed?a:b};
}

/** Pure planning: uses cached read models and verified user lookup, never executes a write. */
export async function planNaturalAdminRequest(text: string, deps: NaturalPlannerDependencies): Promise<AdminPlan|null> {
  text = text.replace(/^\/ai_(?:admin|read)(?:@[A-Za-z0-9_]+)?\s*/i, '');
  const action = detectNaturalAdminAction(text);
  if (!action) return null;
  const clean = maskUser(text).replace(/"[^"]*"|“[^”]*”/g, ' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0];
  const q = normalizeAiEntity(clean), note = reason(text);
  const make = (action: string, targetId?: string, body: Record<string,unknown> = {}) => adminPlanSchema.parse({ action, ...(targetId ? { targetId } : {}), body });
  if (['users','ai_settings','premium_overview','broadcasts','notification_messages','health','season_control'].includes(action)) {
    const search = /@\s*([A-Za-z0-9_]+)/.exec(text)?.[1];
    return make(action, undefined, action === 'users' ? { limit: 10, ...(search ? { search } : {}) } : {});
  }
  // Explicitly contradictory or multiple writes must not silently become the first action.
  if (/\b(?:qilma\w*|ochirma\w*|yuborma\w*|biriktirma\w*)\b/.test(q) || /\b(?:ochir|blokla|ber|yubor|biriktir|qulfla|yarat|hisobla)\w*\b.*\b(?:va|keyin|song)\s+.*\b(?:ochir|blokla|ber|yubor|biriktir|qulfla|yarat)\w*\b/.test(q))
    clarify('Bitta aniq amalni yozing. Bir nechta yoki inkor qilingan amalni birgalikda bajarmayman.');
  if (['user_role','user_role_remove','user_suspend','user_unsuspend','user_delete','premium_grant','premium_revoke'].includes(action)) {
    const id = await userId(text, deps);
    const expectedUsername = /@\s*([A-Za-z0-9_]+)/.exec(text)?.[1];
    const identity = expectedUsername ? { expectedUsername } : {};
    if (action.startsWith('premium_')) return make(action, undefined, { userId: id, ...identity, ...(note ? { note } : {}) });
    if (action === 'user_delete') return make(action, id, { ...identity, ...(note ? { reason: note } : {}) });
    if (action === 'user_suspend' || action === 'user_unsuspend') return make('user_suspend', id, { ...identity, isSuspended: action === 'user_suspend', ...(note ? { reason: note } : {}) });
    if (action === 'user_role_remove') return make('user_role', id, { ...identity, isAdmin: false });
    const comps: Competition[] = await pages(deps.read, { dataset: 'competitions' });
    const leagues = findConversationCompetitions(clean, comps).filter(c => c.type === 'LEAGUE');
    const all = /\b(?:barcha ligalar\w*|hamma ligalar\w*|barcha ruxsat\w*|asosiy admin)\b/.test(q);
    if (all && /\bfaqat\b/.test(q)) clarify('Faqat tanlangan ligami yoki barcha ligalarmi? Ruxsatni aniq yozing.');
    if (!all && !leagues.length) clarify('Admin qaysi ligani boshqarsin? Masalan: “@username faqat La Liga uchun admin qil”.');
    return make('user_role', id, { ...identity, isAdmin: true, adminPermissions: { scope: all ? 'ALL' : 'LEAGUES', leagueIds: all ? [] : [...new Set(leagues.map(c => c.leagueId))] } });
  }
  if (action === 'ai_enable' || action === 'ai_disable') return make('ai_config', undefined, { enabled: action === 'ai_enable' });
  if (['sync','notification_queue','read_model_rebuild','deadline_sweep'].includes(action)) return make(action);
  if (action === 'season_archive' || action === 'season_rollover') {
    const season = /\bseason-\d{4}-\d{2}\b/.exec(text)?.[0];
    if (!season) clarify('Qaysi mavsum? season-2026-27 ko‘rinishidagi aniq mavsum IDni yozing.');
    return make(action, undefined, { seasonId: season, confirmation: action === 'season_archive' ? 'ARCHIVE_COMPLETED_SEASON' : 'CREATE_NEXT_SEASON_SHELL' });
  }
  if (action === 'notification_control') {
    const id = /\bid\s*[:=]\s*([A-Za-z0-9_:-]+)/i.exec(text)?.[1];
    if (!id) clarify('Qaysi xabarnoma? Admin paneldagi xabar IDni “id: ...” bilan yozing.');
    const visible = /korsat/.test(q), deleted = /ochir/.test(q);
    if (/\bturi\b|\btype\b/.test(q)) return make('notification_type', id, { visible });
    return make(/\bbitta\b|\bshaxsiy\b/.test(q) ? 'notification_item' : 'notification_message', id, { visibility: deleted ? 'deleted' : visible ? 'visible' : 'hidden' });
  }
  if (action === 'broadcast') {
    const title = /(?:sarlavha)\s*:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
    const body = /(?:matn)\s*:\s*([\s\S]+)/i.exec(text)?.[1]?.trim();
    if (!title || !body) clarify('Xabar sarlavhasi, matni va kimga yuborishni yozing. Masalan: “Hammaga e’lon yubor\nSarlavha: Yangi tur\nMatn: 10-tur ochildi”.');
    const comps: Competition[] = await pages(deps.read, { dataset: 'competitions' });
    const leagues = findConversationCompetitions(clean.split(/sarlavha\s*:/i)[0], comps).filter(c => c.type === 'LEAGUE');
    const audience = /\bhammaga\b|\bbarcha foydalanuvchi\w*\b/.test(q) ? 'ALL_USERS' : leagues.length === 1 ? 'LEAGUE_OWNERS' : /\bklub egalari\w*\b/.test(q) ? 'CLUB_OWNERS' : null;
    if (!audience && /@\s*[A-Za-z0-9_]+|\buser-\d+\b/.test(clean + text.split(/sarlavha\s*:/i)[0])) {
      const head=text.split(/sarlavha\s*:/i)[0];
      const id=await userId(head,deps);
      const expectedUsername=/@\s*([A-Za-z0-9_]+)/.exec(head)?.[1];
      return make('broadcast',undefined,{title,body,targetAudience:'SELECTED_RECIPIENTS',selectedUserIds:[id],...(expectedUsername ? {expectedUsername} : {})});
    }
    if (!audience) clarify('Kimga yuboray: hammaga, klub egalariga, qaysi liga egalariga yoki bitta @username ga?');
    return make('broadcast', undefined, { title, body, targetAudience: audience, ...(audience === 'LEAGUE_OWNERS' ? { targetLeagueId: leagues[0].leagueId } : {}) });
  }
  const needsClubs = action === 'club_release' || action.startsWith('result_') || action.startsWith('fixture_');
  const clubs: Club[] = needsClubs ? await pages(deps.read, { dataset: 'clubs' }) : [];
  const selected: {clubs:Club[];clarification?:string} = needsClubs ? resolveAiClubs(clean, clubs) : {clubs:[]};
  if (selected.clarification) clarify(selected.clarification);
  if (action === 'club_release') {
    if (selected.clubs.length !== 1) clarify('Qaysi bitta klubni egasidan bo‘shatay? Klub nomini yozing.');
    return make('club_release', selected.clubs[0].id);
  }
  const comps: Competition[] = await pages(deps.read, { dataset: 'competitions' });
  const named = findConversationCompetitions(clean, comps);
  if (action.startsWith('fixture_') && action !== 'fixtures_generate' || action.startsWith('result_')) {
    const fixtureId = /\b(?:fixture|oyin|uchrashuv)?\s*id\s*[:=]\s*([A-Za-z0-9_:-]+)/i.exec(text)?.[1];
    if (!fixtureId && !selected.clubs.length) clarify('Qaysi o‘yin? Jamoalar nomi va tur/bosqichni yoki o‘yin IDni yozing.');
    if (selected.clubs.length > 2 || named.length > 1) clarify('Bitta o‘yin va bitta turnirni tanlang.');
    const matches = await pages(deps.read, { dataset: 'fixtures', ...(fixtureId ? { fixtureId } : { club: selected.clubs[0].id, ...(selected.clubs[1] ? { opponent: selected.clubs[1].id } : {}) }), ...(named.length ? { competition: named[0].id } : {}), ...(requestedMatchday(clean) ? { matchday: requestedMatchday(clean) } : {}), ...(detectAiCupStage(clean) ? { stage: detectAiCupStage(clean) } : {}) });
    if (matches.length !== 1) clarify(matches.length ? `Bir nechta o‘yin topildi. Qaysi biri? ${matches.slice(0,4).map(f => `${f.home} — ${f.away}, ${f.competition}, ${f.roundName || f.matchday + '-tur'}`).join('; ')}. Tur yoki turnirni yozing.` : 'So‘ralgan o‘yin saqlangan bazada topilmadi. Tur, turnir yoki IDni tekshiring.');
    const fixture = matches[0];
    let body: Record<string,unknown> = note ? { notes: note } : {};
    if (action === 'result_edit' || action === 'result_approve') {
      body = { ...body, ...resolveAdminScore(text, selected.clubs, fixture), ...(action === 'result_edit' ? { status: 'CONFIRMED' } : {}) };
    }
    if (action === 'fixture_delete') {
      if (!note || note.length < 3) clarify('O‘yinning o‘zini o‘chirish uchun sabab yozing: “sabab: ...”. Faqat hisobni o‘chirish uchun “natijasini o‘chir” deng.');
      body = { reason: note };
    }
    if (action === 'fixture_deadline') {
      const date = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/.exec(text)?.[0];
      if (!date || !Number.isFinite(Date.parse(date))) clarify('Aniq sana, vaqt va vaqt zonasini yozing. Masalan: 2026-10-06T21:00:00+05:00.');
      body.deadlineAt = date;
    }
    return make(action, fixture.id, body);
  }
  if (named.length !== 1) clarify('Qaysi liga yoki kubok? Bitta turnir nomini yozing; oldingi suhbatdan taxmin qilmayman.');
  const comp = named[0];
  if (action === 'matchday_select') {
    const round = requestedMatchday(clean);
    if (!round || round > 100) clarify('Qaysi tur? 1–100 orasidagi tur raqamini yozing.');
    return make('matchday_control', comp.id, { action: 'SELECT', matchday: round });
  }
  if (action === 'fixtures_generate') return ['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type) ? make(action, undefined, { competitionId: comp.id }) : make('cup_preview', comp.id);
  if (action === 'cup_preview' || action === 'cup_advance' || action === 'cup_reconcile') {
    if (['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type)) clarify('Bu amal uchun kubok yoki pley-off musobaqasini yozing.');
    return make(action, comp.id, action === 'cup_reconcile' && note ? { reason: note } : {});
  }
  if (action === 'matchday_advance' && !['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type)) return make('cup_advance', comp.id);
  return make(action, comp.id);
}

export async function parseNaturalAdminPlan(text: string, signal: AbortSignal): Promise<AdminPlan|null> {
  if (!detectNaturalAdminAction(text)) return null;
  return planNaturalAdminRequest(text, {
    read: createAiTournamentReader(signal).read,
    users: async () => {
      const cached = await createAiSnapshotReader(signal).read<User>('efluz:v1:admin:user-directory');
      if (cached.available) return cached.data;
      return withinAiDeadline(signal, () => getAdminUserDirectory());
    },
  });
}
