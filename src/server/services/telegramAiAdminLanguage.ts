import { normalizeAiEntity } from './telegramAiEntities';
import { detectExtendedAdminControl } from './telegramAiControlLanguage';

function adminCommandText(text: string): string {
  return normalizeAiEntity(text.replace(/^\/ai_(?:admin|read)(?:@[A-Za-z0-9_]+)?\s*/i, '')
    .replace(/@\s*[A-Za-z0-9_]+/g, ' ').replace(/"[^"]*"|“[^”]*”/g, ' ')
    .split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0].replace(/[;\n]+/g, ' keyin '));
}

export function isNaturalCupStart(text: string): boolean {
  const q = normalizeAiEntity(text);
  return !/\b(?:boshlama\w*|tushirma\w*|berma\w*)\b/.test(q) && /\b(?:start\s*ber(?:gin|ing)?|boshla(?:gin|ng)?|boshlat(?:gin|ing)?|boshlab\s*ber(?:gin|ing)?|ishga\s*tushir(?:gin|ing)?)\b/.test(q);
}

/** Applies before EVERY native write parser, including club assignment. */
export function assertSingleNaturalAdminRequest(text: string): void {
  const q = adminCommandText(text);
  if (/\b\d{1,3}\s*turgacha\b/.test(q))
    throw new Error('CLARIFY:Bu buyruq bir nechta turga tegishli. O‘zgartirish uchun bitta aniq turni yozing; “turgacha” faqat ro‘yxatni ko‘rishda ishlaydi.');
  if (/\b(?:qilma\w*|ochirma\w*|yuborma\w*|biriktirma\w*|berma\w*|ulama\w*|boshatma\w*|chiqarma\w*|otkazma\w*|yozma\w*|toxtatma\w*|yangilama\w*|belgilama\w*|ozgartirma\w*|qaytarma\w*|tozalama\w*|tushirma\w*)\b/.test(q) || /\b(?:do not|dont|never)\s+(?:assign|release|delete|remove|give)\b/.test(q) || /(?:^|\s)не\s+(?:назнач|удал|освобод)[\p{L}]*/u.test(q) ||
      /\b(?:ochir|blokla|ber|yubor|biriktir|qulfla|yarat|hisobla|boshat|chiqar|ula|otkaz|qil|belgila|ozgartir|yangila|toxtat|qaytar|tozala|tushir)\w*\b.*\b(?:va|keyin|song|hamda)\s+.*\b(?:ochir|blokla|ber|yubor|biriktir|qulfla|yarat|boshat|chiqar|ula|otkaz|qil|belgila|ozgartir|yangila|toxtat|qaytar|tozala|tushir)\w*\b/.test(q)) {
    throw new Error('CLARIFY:Bitta aniq amalni yozing. Bir nechta yoki inkor qilingan amalni birgalikda bajarmayman.');
  }
}

/** Ordered explicit intents; score removal always precedes match deletion. */
export function detectNaturalAdminAction(text: string): string|null {
  const command = text.replace(/^\/ai_(?:admin|read)(?:@[A-Za-z0-9_]+)?\s*/i, '').replace(/"[^"]*"|“[^”]*”/g, ' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0];
  const q = normalizeAiEntity(command.replace(/@\s*[A-Za-z0-9_]+/g, ' '));
  const extended = detectExtendedAdminControl(command);
  if (extended) return extended;
  if (/\b(?:no show|kelmaganlik\w*|kelmagan\w*)\b/.test(q) && /hal qil|hal et|texnik|rad et|resolve/.test(q)) return 'no_show_resolve';
  if (/\b(?:nizo\w*|bahs\w*)\b/.test(q) && /hal qil|hal et|resolve/.test(q)) return 'dispute_resolve';
  if (/\b(?:ariza\w*|submission\w*)\b/.test(q) && /ochir|olib tashla/.test(q)) return 'submission_delete';
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
    if (/\b(?:kirit\w*|saqla\w*|yoz\w*|ozgartir\w*|qil\w*)\b/.test(q)) return 'result_edit';
  }
  if (/\b(?:pley.?off|knockout|knokaut)\b/.test(q) && /yarat\w*|generatsiya|tuz\w*/.test(q)) return 'knockout_generate';
  if (/\b\d{1,2}\s*[:–—−-]\s*\d{1,2}\b/.test(command) && !/\d{4}-\d{2}-\d{2}T/.test(command) && /\b(?:qil\w*|qoy\w*|saqla\w*|kirit\w*|qosh\w*|yoz\w*|ozgartir\w*|tasdiqla\w*)\b/.test(q)) return /tasdiqla/.test(q) ? 'result_approve' : 'result_edit';
  if (/\b(?:oyin\w*|uchrashuv\w*)\b/.test(q)) {
    if (remove) return 'fixture_delete';
    if (/qayta och/.test(q)) return 'fixture_reopen';
    if (/eslatma\w*|eslat\w*/.test(q) && /yubor|jonat|eslat/.test(q)) return 'fixture_remind';
    if (/muddat\w*|deadline/.test(q) && /ozgartir|belgila/.test(q)) return 'fixture_deadline';
    if (/yarat\w*|generatsiya qil/.test(q)) return 'fixtures_generate';
  }
  if (/\begasini\b/.test(q) && /\b(?:chiqar\w*|boshat\w*)\b/.test(q)) return 'club_release';
  if (/\b(?:boshat\w*|egasidan ol\w*|biriktirishni bekor qil\w*)\b/.test(q) ||
      /\b(?:klubdan|jamoadan|klubidan|jamoasidan|klub egasini|jamoa egasini)\b/.test(q) && /\b(?:chiqar\w*|ol\w*|ochir\w*)\b/.test(q) ||
      /\b(?:egasini|egasidan|egaligini|biriktirishni)\b/.test(q) && remove) return 'club_release';
  if (/\bblokdan chiqar\w*\b/.test(q)) return 'user_unsuspend';
  if (/\bblokla\w*\b/.test(q)) return 'user_suspend';
  if (/@\s*[A-Za-z0-9_]+|\buser-\d+\b/.test(command) && /\bchiqar\w*\b/.test(q)) return 'club_release';
  if (/\badmin\w*\b/.test(q) && /\b(?:qil\w*|ber\w*|ol\w*|ochir\w*|bekor qil\w*)\b/.test(q)) return remove || /\bol\w*\b/.test(q) ? 'user_role_remove' : 'user_role';
  if (/\bpremium\w*\b/.test(q) && /\b(?:ber\w*|ula\w*|ol\w*|ochir\w*|bekor qil\w*)\b/.test(q)) return remove || /\bol\w*\b/.test(q) ? 'premium_revoke' : 'premium_grant';
  if (/\bfoydalanuvchi\w*\b/.test(q) && remove) return 'user_delete';
  if (/\b(?:yevropa|european)\b/.test(q) && /jadval\w*.*(?:qayta|hisob)|qayta.*(?:yevropa|european)/.test(q)) return 'european_rebuild';
  if (/\b(?:jadval\w*|standings)\b/.test(q) && /qayta hisobla\w*|qayta qur\w*|tikla\w*/.test(q)) return 'standings_rebuild';
  if (/\b(?:juftlik\w*|o\s*yinlar\w*|fixture\w*)\b/.test(q) && /yetishmayotgan|qolib ketgan|tikla\w*|restore/.test(q)) return 'fixtures_restore';
  if (/\b(?:jadval\w*|fixture\w*|o\s*yinlar\w*)\b/.test(q) && /reset|tozalab qayta|boshidan yarat|qayta yarat/.test(q)) return 'fixtures_reset';
  if (/\b(?:saralash\w*|qualification\w*)\b/.test(q) && /hisobla\w*|bahola\w*|evaluate/.test(q)) return 'qualifications_evaluate';
  if (/\b(?:kub(?:ok|og)\w*|cup|copa|pokal)\b/.test(q) && (isNaturalCupStart(q) || /(?:bosqich\w*.*(?:och|qulf)|(?:och|qulf).*bosqich)/.test(q))) return 'cup_round';
  if (/\b(?:kub(?:ok|og)\w*|cup)\b/.test(q) && /g.olib\w*.*(?:otkaz|keyingi)|winner.*(?:advance|otkaz)/.test(q)) return 'cup_winner_advance';
  if (/\b(?:kub(?:ok|og)\w*|qura\w*)\b/.test(q) && /juftlik\w*.*mosla\w*|reconcile/.test(q)) return 'cup_reconcile';
  if (/\bqura\w*\b/.test(q) && /yarat|tashla|korib chiq|tekshir/.test(q)) return 'cup_preview';
  if (/\b(?:kub(?:ok|og)\w*|bosqich\w*)\b/.test(q) && /keyingi.*(?:otkaz|ot)|oldinga otkaz/.test(q)) return 'cup_advance';
  if (/\b(?:tur\w*|matchday)\b/.test(q) && /keyingi.*(?:otkaz|ot)|oldinga otkaz/.test(q)) return 'matchday_advance';
  if (/\b(?:tur\w*|matchday)\b/.test(q) && /hozir.*och|majburiy.*och|ochib ber/.test(q)) return 'matchday_open_now';
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
  // Native ownership commands do not need a model to interpret Uzbek suffixes.
  // Other nouns (premium/admin/results/messages) have already won above.
  if (/\bbiriktir\w*\b/.test(q) && !/\bbiriktirish\w*\b/.test(q) ||
      /@\s*[A-Za-z0-9_]+|\buser-\d+\b/.test(command) && /\b(?:ber\w*|ula\w*|tayinla\w*|otkaz\w*|yoz\w*)\b/.test(q)) return 'club_assign';
  // "Arsenalni o‘chir" is ambiguous: never silently delete a club or release it.
  if (remove) return 'club_remove_clarify';
  return null;
}
