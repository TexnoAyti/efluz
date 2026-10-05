import { normalizeAiEntity } from './telegramAiEntities';

/** Ordered explicit intents; score removal always precedes match deletion. */
export function detectNaturalAdminAction(text: string): string|null {
  const command = text.replace(/^\/ai_(?:admin|read)(?:@[A-Za-z0-9_]+)?\s*/i, '').replace(/"[^"]*"|“[^”]*”/g, ' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0];
  const q = normalizeAiEntity(command.replace(/@\s*[A-Za-z0-9_]+/g, ' '));
  const remove = /\b(?:ochir\w*|olib tashla\w*|bekor qil\w*)\b/.test(q);
  if (/ko?rsat|korib chiq|holati|royxat|statistika/.test(q)) {
    if (/foydalanuvchilar\w*|userlar\w*/.test(q)) return 'users';
    if (/ai sozlama\w*|ai holati/.test(q)) return 'ai_settings';
    if (/premium\w*.*(?:holat|royxat|statistika)/.test(q)) return 'premium_overview';
    if (/elonlar\w*|yuborilgan xabar\w*/.test(q)) return 'broadcasts';
    if (/xabarnomalar\w*/.test(q) && !/yashir|ochir/.test(q)) return 'notification_messages';
    if (/baza\w*|read model|kesh\w*/.test(q) && !/yangila/.test(q)) return 'health';
    if (/mavsum\w*.*holat/.test(q)) return 'season_control';
  }
  if (/\b(?:natija\w*|hisob\w*)\b/.test(q)) {
    if (remove) return 'result_clear';
    if (/\brad et\w*\b/.test(q)) return 'result_reject';
    if (/\btasdiqla\w*\b/.test(q)) return 'result_approve';
  }
  if (/\b\d{1,2}\s*[:-]\s*\d{1,2}\b/.test(command) && !/\d{4}-\d{2}-\d{2}T/.test(command) && /\b(?:qil\w*|qoy\w*|saqla\w*|yoz\w*|ozgartir\w*|tasdiqla\w*)\b/.test(q)) return /tasdiqla/.test(q) ? 'result_approve' : 'result_edit';
  if (/\b(?:oyin\w*|uchrashuv\w*)\b/.test(q)) {
    if (remove) return 'fixture_delete';
    if (/qayta och/.test(q)) return 'fixture_reopen';
    if (/eslatma\w*|eslat\w*/.test(q) && /yubor|jonat|eslat/.test(q)) return 'fixture_remind';
    if (/muddat\w*|deadline/.test(q) && /ozgartir|belgila/.test(q)) return 'fixture_deadline';
    if (/yarat\w*|generatsiya qil/.test(q)) return 'fixtures_generate';
  }
  if (/\b(?:klub\w*|jamoa\w*)\b/.test(q) && /\b(?:boshat\w*|egasidan ol\w*|biriktirishni bekor qil)\b/.test(q)) return 'club_release';
  if (/\bblokdan chiqar\w*\b/.test(q)) return 'user_unsuspend';
  if (/\bblokla\w*\b/.test(q)) return 'user_suspend';
  if (/\badmin\w*\b/.test(q) && /\b(?:qil\w*|ber\w*|ol\w*|ochir\w*|bekor qil\w*)\b/.test(q)) return remove || /\bol\w*\b/.test(q) ? 'user_role_remove' : 'user_role';
  if (/\bpremium\w*\b/.test(q) && /\b(?:ber\w*|ula\w*|ol\w*|ochir\w*|bekor qil\w*)\b/.test(q)) return remove || /\bol\w*\b/.test(q) ? 'premium_revoke' : 'premium_grant';
  if (/\bfoydalanuvchi\w*\b/.test(q) && remove) return 'user_delete';
  if (/\b(?:jadval\w*|standings)\b/.test(q) && /qayta hisobla\w*|qayta qur\w*|tikla\w*/.test(q)) return 'standings_rebuild';
  if (/\b(?:kub(?:ok|og)\w*|qura\w*)\b/.test(q) && /juftlik\w*.*mosla\w*|reconcile/.test(q)) return 'cup_reconcile';
  if (/\bqura\w*\b/.test(q) && /yarat|tashla|korib chiq|tekshir/.test(q)) return 'cup_preview';
  if (/\b(?:kub(?:ok|og)\w*|bosqich\w*)\b/.test(q) && /keyingi.*(?:otkaz|ot)|oldinga otkaz/.test(q)) return 'cup_advance';
  if (/\b(?:tur\w*|matchday)\b/.test(q) && /keyingi.*(?:otkaz|ot)|oldinga otkaz/.test(q)) return 'matchday_advance';
  if (/\b(?:tur\w*|matchday)\b/.test(q) && /\b(?:tanla\w*|qoy\w*|otkaz\w*)\b/.test(q)) return 'matchday_select';
  if (/\bai\b/.test(q) && /\b(?:yoq\w*|ochir\w*)\b/.test(q)) return /ochir/.test(q) ? 'ai_disable' : 'ai_enable';
  if (/\b(?:xabarnoma\w*|bildirishnoma\w*|notifikatsiya\w*|notification\w*)\b/.test(q) && /\b(?:yashir\w*|korsat\w*|ochir\w*)\b/.test(q)) return 'notification_control';
  if (/\b(?:elon\w*|xabar\w*)\b/.test(q) && /\b(?:yubor\w*|jonat\w*)\b/.test(q) && !/eslat/.test(q)) return 'broadcast';
  if (/\b(?:read model|kesh\w*|snapshot\w*)\b/.test(q) && /\b(?:yangila\w*|qayta qur\w*)\b/.test(q)) return 'read_model_rebuild';
  if (/\b(?:sinxronla\w*|sync qil\w*)\b/.test(q)) return 'sync';
  if (/\b(?:mavsum\w*)\b/.test(q) && /arxivla/.test(q)) return 'season_archive';
  if (/\b(?:keyingi|yangi) mavsum\w*\b/.test(q) && /yarat/.test(q)) return 'season_rollover';
  if (/\b(?:deadline|muddat\w*)\b/.test(q) && /tekshir/.test(q)) return 'deadline_sweep';
  if (/\b(?:xabarnoma\w*|bildirishnoma\w*|notifikatsiya\w*|notification\w*)\b/.test(q) && /navbat\w*/.test(q) && /qayta yubor|ishla|yubor/.test(q)) return 'notification_queue';
  return null;
}
