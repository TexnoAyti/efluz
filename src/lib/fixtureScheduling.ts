export const SCHEDULE_TIME_ZONE = 'Asia/Tashkent';
export function toTashkentInput(iso?: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fromTashkentInput(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Sana va vaqtni to‘g‘ri kiriting.');
  const date = new Date(`${value}:00+05:00`);
  if (!Number.isFinite(date.getTime()) || toTashkentInput(date.toISOString()) !== value) throw new Error('Sana va vaqtni to‘g‘ri kiriting.');
  return date.toISOString();
}
