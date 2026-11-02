import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { Bell, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';

const copy = {
  uz: { title: 'Bildirishnomalar', note: 'Ilovadagi bildirishnomalarni boshqaring. Telegramga yuborilgan xabarlar o‘zgarmaydi.', types: 'Bildirishnoma turlari', more: 'Oldingi bildirishnomalar', recipients: 'Qabul qiluvchilar', recent: 'Yuborilgan xabarlar', search: 'Yuborilgan xabarni qidirish', visible: 'Ko‘rinadi', hidden: 'Yashirilgan', hide: 'Yashirish', show: 'Ko‘rsatish', remove: 'O‘chirish', confirm: 'Bu xabar barcha qabul qiluvchilarning bildirishnomalaridan o‘chiriladi.', cancel: 'Bekor qilish', empty: 'Bildirishnoma topilmadi', error: 'Amal bajarilmadi. Qayta urinib ko‘ring.', refresh: 'Yangilash' },
  ru: { title: 'Уведомления', note: 'Управление уведомлениями в приложении. Отправленные сообщения Telegram не изменяются.', types: 'Типы уведомлений', more: 'Предыдущие уведомления', recipients: 'Получатели', recent: 'Отправленные сообщения', search: 'Поиск отправленного сообщения', visible: 'Видно', hidden: 'Скрыто', hide: 'Скрыть', show: 'Показать', remove: 'Удалить', confirm: 'Сообщение будет удалено из уведомлений всех получателей.', cancel: 'Отмена', empty: 'Уведомлений нет', error: 'Не удалось выполнить действие. Попробуйте ещё раз.', refresh: 'Обновить' },
  en: { title: 'Notifications', note: 'Manage in-app notifications. Previously sent Telegram messages are unchanged.', types: 'Notification types', more: 'Older notifications', recipients: 'Recipients', recent: 'Sent messages', search: 'Search sent messages', visible: 'Visible', hidden: 'Hidden', hide: 'Hide', show: 'Show', remove: 'Delete', confirm: 'This message will be removed from every recipient’s notification list.', cancel: 'Cancel', empty: 'No notifications found', error: 'Action failed. Please try again.', refresh: 'Refresh' },
};
const labels: Record<string, [string, string, string]> = {
  NEW_MATCHDAY: ['Yangi tur', 'Новый тур', 'New matchday'],
  UPCOMING_MATCH: ['Navbatdagi o‘yin', 'Предстоящий матч', 'Upcoming match'],
  CUSTOM_ALERT: ['Admin xabari', 'Сообщение администратора', 'Admin message'],
  MATCH_SCHEDULED: ['O‘yin belgilandi', 'Матч назначен', 'Match scheduled'],
  RESULT_SUBMITTED: ['Natija yuborildi', 'Результат отправлен', 'Result submitted'],
  RESULT_CONFIRMED: ['Natija tasdiqlandi', 'Результат подтверждён', 'Result confirmed'],
  DISPUTE_OPENED: ['Nizo ochildi', 'Спор открыт', 'Dispute opened'],
  DISPUTE_RESOLVED: ['Nizo hal qilindi', 'Спор решён', 'Dispute resolved'],
  CLUB_ASSIGNED: ['Klub biriktirildi', 'Клуб назначен', 'Club assigned'],
  NEXT_ROUND_MATCH: ['Keyingi tur', 'Следующий тур', 'Next round'],
  QUALIFICATION_CONFIRMED: ['Yo‘llanma tasdiqlandi', 'Квалификация подтверждена', 'Qualification confirmed'],
  COMPETITION_UPDATE: ['Turnir yangiligi', 'Обновление турнира', 'Competition update'],
  SYSTEM: ['Tizim xabari', 'Системное сообщение', 'System message'],
};

export function AdminNotificationsTab() {
  const { language } = useI18n();
  const c = copy[language] || copy.uz;
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAdminNotifications>> | null>(null);
  const [reminderHealth, setReminderHealth] = useState<Awaited<ReturnType<typeof api.getLeagueReminderHealth>> | null>(null);
  const [healthError, setHealthError] = useState(false);
  const loadHealth = useCallback(async () => { try { setReminderHealth(await api.getLeagueReminderHealth()); setHealthError(false); } catch { setHealthError(true); } }, []);
  useEffect(() => { void loadHealth(); }, [loadHealth]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(async () => { setData(await api.getAdminNotifications()); }, []);
  useEffect(() => { let active = true; api.getAdminNotifications().then(result => { if (active) setData(result); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, []);
  const act = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id); setError(false);
    try { await operation(); if (id !== 'more' && id !== 'refresh') await load(); setDeleting(null); } catch { setError(true); } finally { setBusy(null); }
  };
  const loadMore = async () => {
    if (!data?.nextCursor) return;
    const page = await api.getAdminNotifications(data.nextCursor);
    setData(previous => previous ? { ...page, notifications: [...previous.notifications, ...page.notifications].filter((item, index, all) => all.findIndex(n => n.id === item.id) === index) } : page);
  };
  const label = (type: string) => labels[type]?.[language === 'ru' ? 1 : language === 'en' ? 2 : 0] || type.replaceAll('_', ' ');
  const notifications = data?.notifications.filter(n => [n.title, n.message].some(value => value?.toLowerCase().includes(search.toLowerCase()))) || [];
  return <section className="space-y-5">
    <div className="glass-card p-5 rounded-2xl">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold flex items-center gap-2"><Bell size={20} />{c.title}</h2><button aria-label={c.refresh} disabled={!!busy} onClick={() => act('refresh', async () => { await Promise.all([load(), loadHealth()]); })} className="p-2 rounded-xl glass-card"><RefreshCw size={18} /></button></div>
      <p className="text-sm text-slate-400 mt-2">{c.note}</p>
      {error && <p role="alert" className="mt-3 text-red-400">{c.error}</p>}
    </div>
    <div className="glass-card p-5 rounded-2xl space-y-2">
      <h3 className="font-bold">{language === 'ru' ? 'Напоминания о старых играх' : language === 'en' ? 'Outstanding game reminders' : 'Eski o‘yinlar eslatmalari'}</h3>
      <p className="text-sm text-slate-400">{language === 'ru' ? 'Ежедневно, 09:00–21:00 по Ташкенту. Одно сообщение на игрока в каждой лиге.' : language === 'en' ? 'Daily, 09:00–21:00 Tashkent. One message per player in each league.' : 'Har kuni 09:00–21:00 (Toshkent). Har bir ligada o‘yinchiga bitta yig‘ma xabar.'}</p>
      {healthError ? <p role="alert" className="text-red-400 text-sm">{c.error}</p> : reminderHealth ? <>
        <p className="text-sm">{({uz:{DONE:'Navbatga qo‘yish tugadi',PENDING:'Davom etmoqda',RETRY_PENDING:'Xato: qayta urinish kutilmoqda',NOT_RUN:'Hali ishga tushmagan'},ru:{DONE:'Постановка в очередь завершена',PENDING:'Выполняется',RETRY_PENDING:'Ожидается повтор после ошибки',NOT_RUN:'Ещё не запускалось'},en:{DONE:'Enqueue complete',PENDING:'In progress',RETRY_PENDING:'Retry pending after error',NOT_RUN:'Not run yet'}}[language] as Record<string,string>)[reminderHealth.status] || reminderHealth.status}</p>
        <p className="text-xs text-slate-400">{language === 'uz' ? 'Navbatga qo‘yildi' : language === 'ru' ? 'В очереди' : 'Queued'}: {reminderHealth.queued || 0} · {language === 'uz' ? 'Takror / o‘chirilgan' : language === 'ru' ? 'Дубликат / отключено' : 'Duplicate / disabled'}: {reminderHealth.skipped || 0}</p>
        {reminderHealth.delivery && <p className="text-xs text-slate-400">{language === 'ru' ? 'Доставлено / Ошибки / Ожидают / Пропущено' : language === 'en' ? 'Delivered / Failed / Pending / Skipped' : 'Yetkazildi / Xato / Kutilmoqda / O‘tkazildi'}: {reminderHealth.delivery.sent} / {reminderHealth.delivery.failed} / {reminderHealth.delivery.pending} / {reminderHealth.delivery.skipped}</p>}
        {!!reminderHealth.delivery?.uncertain && <p role="alert" className="text-amber-400 text-sm">{language === 'ru' ? 'Доставка не подтверждена. Проверьте Telegram перед повтором.' : language === 'en' ? 'Delivery uncertain. Check Telegram before retrying.' : 'Yetkazilgani noma’lum. Qayta yuborishdan oldin Telegramni tekshiring.'}</p>}
        {reminderHealth.updatedAt && <p className="text-xs text-slate-400">{new Date(reminderHealth.updatedAt).toLocaleString(language === 'uz' ? 'uz-UZ' : language, {timeZone:'Asia/Tashkent'})} · {reminderHealth.lastSliceMs || 0} ms</p>}
        {reminderHealth.lastError && <p role="alert" className="text-red-400 text-sm">{reminderHealth.lastError}</p>}
      </> : <RefreshCw className="animate-spin" aria-label={c.refresh} />}
    </div>
    <div className="glass-card p-5 rounded-2xl space-y-3">
      <h3 className="font-bold">{c.types}</h3>
      {data?.types.map(item => <div key={item.type} className="flex items-center justify-between gap-3">
        <span className="text-sm">{label(item.type)}</span>
        <button disabled={!!busy} aria-pressed={item.visible} onClick={() => act('type:' + item.type, () => api.setNotificationTypeVisibility(item.type, !item.visible))} className="text-xs px-3 py-2 rounded-xl glass-card flex gap-2 items-center">{item.visible ? <Eye size={14} /> : <EyeOff size={14} />}{item.visible ? c.visible : c.hidden}</button>
      </div>)}
    </div>
    <div className="glass-card p-5 rounded-2xl space-y-4">
      <h3 className="font-bold">{c.recent}</h3>
      <input aria-label={c.search} placeholder={c.search} value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-xl px-3 py-2 bg-slate-800/50 border border-slate-600/30 text-sm" />
      {!data && !error && <RefreshCw className="animate-spin" aria-label={c.refresh} />}
      {data && !notifications.length && <p className="text-sm text-slate-400">{c.empty}</p>}
      {notifications.map(n => {
        const typeVisible = data?.types.find(item => item.type === n.type)?.visible !== false;
        return <article key={n.id} className="border border-slate-600/30 rounded-xl p-4 space-y-2">
          <div className="flex justify-between gap-2"><strong className="text-sm">{n.title}</strong><span className="text-xs text-slate-400">{n.visibility === 'hidden' || !typeVisible ? c.hidden : c.visible}</span></div>
          <p className="text-sm break-words">{n.message}</p><p className="text-xs text-slate-400 break-all">{c.recipients}: {n.recipientCount} · {new Date(n.createdAt).toLocaleString(language === 'uz' ? 'uz-UZ' : language)}</p>
          <div className="flex gap-2 flex-wrap">
            <button disabled={!!busy || !typeVisible} onClick={() => act(n.id, () => api.setNotificationVisibility(n.id, n.visibility === 'hidden' ? 'visible' : 'hidden'))} className="glass-card text-xs px-3 py-2 rounded-lg">{n.visibility === 'hidden' ? c.show : c.hide}</button>
            <button disabled={!!busy} onClick={() => setDeleting(n.id)} className="text-red-400 text-xs px-3 py-2 rounded-lg flex gap-1 items-center"><Trash2 size={14} />{c.remove}</button>
          </div>
          {deleting === n.id && <div className="space-y-2"><p className="text-sm">{c.confirm}</p><div className="flex gap-3"><button disabled={!!busy} onClick={() => act(n.id, () => api.setNotificationVisibility(n.id, 'deleted'))} className="text-red-400 font-bold text-sm">{c.remove}</button><button disabled={!!busy} onClick={() => setDeleting(null)} className="text-sm">{c.cancel}</button></div></div>}
        </article>;
      })}
      {data?.nextCursor && <button disabled={!!busy} onClick={() => act('more', loadMore)} className="glass-card px-4 py-2 rounded-xl text-sm">{c.more}</button>}
    </div>
  </section>;
}
