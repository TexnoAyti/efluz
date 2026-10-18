import React from 'react';
import { useI18n } from '../i18n';
import { CupTieBreakScores, cupScoreMetadata } from '../lib/cupResult';

export function CupTieBreakFields({ value, onChange, homeScore, awayScore, homeLabel, awayLabel }: {
  value: CupTieBreakScores; onChange: (value: CupTieBreakScores) => void;
  homeScore: number; awayScore: number; homeLabel: string; awayLabel: string;
}) {
  const { language } = useI18n();
  const copy = {
    uz: { extra: 'Qo‘shimcha vaqt o‘ynaldi', total: 'Qo‘shimcha vaqtdan keyingi umumiy hisob', penalties: 'Penaltilar seriyasi', hint: 'Penaltilarni asosiy hisobga qo‘shmang. Ikkala o‘yinchi barcha hisoblarni bir xil yuborishi kerak.' },
    ru: { extra: 'Было дополнительное время', total: 'Общий счёт после дополнительного времени', penalties: 'Серия пенальти', hint: 'Пенальти не прибавляются к счёту. Оба игрока должны отправить одинаковые результаты.' },
    en: { extra: 'Extra time was played', total: 'Total score after extra time', penalties: 'Penalty shootout', hint: 'Do not add penalties to the match score. Both players must submit matching scores for every stage.' },
  }[language];
  const scores = cupScoreMetadata(value);
  const field = (key: keyof CupTieBreakScores, label: string) => <label className="block text-xs font-semibold">{label}<input type="number" min={0} max={99} required value={scores[key] ?? 0} onChange={(event) => onChange({ ...scores, [key]: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-center text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>;
  return <div className="space-y-3 rounded-2xl border border-slate-300 p-4 text-sm dark:border-slate-700">
    <label className="flex items-center gap-2"><input type="checkbox" checked={scores.homeExtraTimeScore != null} onChange={(event) => onChange({ ...scores, homeExtraTimeScore: event.target.checked ? homeScore : null, awayExtraTimeScore: event.target.checked ? awayScore : null })} />{copy.extra}</label>
    {scores.homeExtraTimeScore != null && <div><p className="mb-2 text-xs">{copy.total}</p><div className="grid grid-cols-2 gap-3">{field('homeExtraTimeScore', homeLabel)}{field('awayExtraTimeScore', awayLabel)}</div></div>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={scores.homePenaltyScore != null} onChange={(event) => onChange({ ...scores, homePenaltyScore: event.target.checked ? 0 : null, awayPenaltyScore: event.target.checked ? 0 : null })} />{copy.penalties}</label>
    {scores.homePenaltyScore != null && <div className="grid grid-cols-2 gap-3">{field('homePenaltyScore', homeLabel)}{field('awayPenaltyScore', awayLabel)}</div>}
    <p className="text-xs opacity-75">{copy.hint}</p>
  </div>;
}

export function CupScoreSummary({ scores }: { scores: CupTieBreakScores }) {
  const { language } = useI18n();
  return <>
    {scores.homeExtraTimeScore != null && <span className="block">{language === 'uz' ? 'Qo‘shimcha vaqtdan keyin' : language === 'ru' ? 'После доп. времени' : 'After extra time'}: {scores.homeExtraTimeScore}–{scores.awayExtraTimeScore}</span>}
    {scores.homePenaltyScore != null && <span className="block">{language === 'uz' ? 'Penaltilar' : language === 'ru' ? 'Пенальти' : 'Penalties'}: {scores.homePenaltyScore}–{scores.awayPenaltyScore}</span>}
  </>;
}
