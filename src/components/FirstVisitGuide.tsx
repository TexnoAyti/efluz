import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Search, Shield, Trophy, Bell, Swords, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { findGuideTarget, guidePlacement, type GuideRect, type GuideStatus } from '../lib/firstVisitGuide';
import './first-visit-guide.css';

const content = {
  uz: { label: 'EFL UZ bo‘yicha yo‘riqnoma', step: 'qadam', next: 'Keyingi', back: 'Orqaga', skip: 'O‘tkazib yuborish', done: 'Boshlaymiz', again: 'Yordam kerak bo‘lsa, yuqoridagi “?” tugmasini bosing.', steps: [
    ['Bosh sahifa', 'Navbatdagi raqib, o‘yin vaqti va so‘nggi natijalar shu yerda. Klubingiz bo‘lsa, eng yaqin uchrashuv birinchi ko‘rinadi.'],
    ['Turnirlar va klub tanlash', 'Ligalar, kuboklar va yevrokuboklar shu bo‘limda. Liga ichidan klublar, o‘yinlar va turnir jadvalini oching. Klub tanlash qabul holati va sizga berilgan ruxsatga bog‘liq.'],
    ['Sizning klubingiz', 'Tanlagan klublaringiz, o‘yinlaringiz va statistikangiz shu yerda. Bir nechta klubingiz bo‘lsa, ular orasida almashishingiz mumkin.'],
    ['Hisob qanday kiritiladi?', 'O‘yin tugagach, klub bo‘limidagi uchrashuvdan “Hisobni kiritish”ni oching. Natijani yuboring; raqib tasdiqlagach hisob rasmiylashadi. Tur yopiq bo‘lsa, uning ochilishini kuting.'],
    ['Klubni tez toping', 'Qidiruvga klub nomini yozing va natijani bosing — o‘sha klubning sahifasi ochiladi. Unda barcha turnirlardagi o‘yinlar va natijalarni ko‘rasiz.'],
    ['Muhim xabarlar', 'Natija tasdig‘i, uchrashuvlar va turnir yangiliklari shu yerga keladi. Xabarlarni kuzatib boring — navbatdagi amalni o‘tkazib yubormaysiz.'],
  ] },
  ru: { label: 'Знакомство с EFL UZ', step: 'шаг', next: 'Далее', back: 'Назад', skip: 'Пропустить', done: 'Понятно, начнём!', again: 'Можно снова открыть через «?» вверху.', steps: [
    ['Главная', 'Здесь ближайший соперник, время матча и последние результаты. Если у вас есть клуб, следующий матч будет показан первым.'],
    ['Турниры и выбор клуба', 'Здесь лиги, кубки и еврокубки. Откройте лигу, чтобы увидеть клубы, матчи и таблицу. Выбор клуба зависит от приёма и вашего допуска.'],
    ['Ваш клуб', 'Ваши клубы, матчи и статистика. Если клубов несколько, здесь можно переключаться между ними.'],
    ['Как отправить счёт?', 'После игры откройте матч в разделе клуба и нажмите ввод счёта. Соперник подтверждает результат. Если тур закрыт, дождитесь открытия.'],
    ['Быстрый поиск', 'Введите название клуба и выберите результат. Откроется страница клуба с матчами и результатами во всех турнирах.'],
    ['Важные уведомления', 'Здесь подтверждения результатов, матчи и новости турниров. Следите за сообщениями, чтобы не пропустить следующий шаг.'],
  ] },
  en: { label: 'Welcome to EFL UZ', step: 'step', next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Got it, let’s play!', again: 'Reopen this guide anytime using “?” at the top.', steps: [
    ['Home', 'Your next opponent, kickoff time and recent results are here. When you have a club, its next match appears first.'],
    ['Competitions and club selection', 'Find leagues, cups and European competitions here. Open a league for clubs, fixtures and standings. Club selection depends on admission and your access.'],
    ['Your club', 'Your clubs, matches and statistics. If you have several clubs, switch between them here.'],
    ['How to submit a score', 'After playing, open the match in your club section and choose score submission. Your opponent confirms the result. Wait for the round to open if it is locked.'],
    ['Find a club quickly', 'Search for a club and select the result to open its page with matches and results across every competition.'],
    ['Important notifications', 'Result confirmations, match updates and tournament news appear here. Check your messages for the next action.'],
  ] },
};
const targets = ['[data-guide="nav-dashboard"]', '[data-guide="nav-leagues"]', '[data-guide="nav-my-club"]', '[data-guide="score-entry"], [data-guide="nav-my-club"]', '#btn-global-search', '#btn-notifications'];
const icons = [Compass, Trophy, Shield, Swords, Search, Bell];

export function FirstVisitGuide({ onFinish, onShowScoreEntry }: { onFinish: (status: GuideStatus) => void; onShowScoreEntry?: () => void }) {
  const { language } = useI18n();
  const c = content[language] || content.uz;
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<GuideRect | null>(null);
  const [mobile, setMobile] = useState(() => window.innerWidth < 680);
  const [pointer, setPointer] = useState<{ side: 'top' | 'bottom'; left: number } | null>(null);
  const [placement, setPlacement] = useState(() => guidePlacement(null, window.innerWidth, window.innerHeight, 300));
  const layer = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const originalFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const finish = useRef(onFinish); finish.current = onFinish;
  const showScoreEntry = useRef(onShowScoreEntry); showScoreEntry.current = onShowScoreEntry;
  const Icon = icons[step];

  useEffect(() => {
    if (step === 3 && !findGuideTarget(document, '[data-guide="score-entry"]')) showScoreEntry.current?.();
  }, [step]);

  useLayoutEffect(() => {
    let frame = 0;
    let scrolled: HTMLElement | undefined;
    const update = () => {
      const candidate = findGuideTarget(document, targets[step]);
      if (candidate && candidate !== scrolled && candidate.dataset.guide === 'score-entry') {
        scrolled = candidate;
        candidate.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const r = candidate?.getBoundingClientRect();
      const rect = r ? { top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10 } : null;
      setTarget(rect);
      const height = card.current?.offsetHeight || 300;
      const position = guidePlacement(rect, window.innerWidth, window.innerHeight, height);
      const isMobile = window.innerWidth < 680;
      setMobile(isMobile); setPlacement(position);
      const above = rect && position.top + Math.min(height, position.maxHeight) <= rect.top;
      const below = rect && position.top >= rect.top + rect.height;
      setPointer(rect && (above || below) ? { side: above ? 'bottom' : 'top', left: Math.max(24, Math.min(position.width - 24, rect.left + rect.width / 2 - position.left)) } : null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update(); next.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(schedule);
    if (card.current) observer.observe(card.current);
    const mutation = new MutationObserver(schedule);
    const main = document.querySelector('main'); if (main) mutation.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.visualViewport?.removeEventListener('resize', schedule); };
  }, [step, language]);

  useEffect(() => {
    const previousFocus = originalFocus.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = Array.from(layer.current?.parentElement?.children || []).filter(el => el !== layer.current) as HTMLElement[];
    const previous = siblings.map(el => el.inert); siblings.forEach(el => { el.inert = true; });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish.current('skipped'); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); document.body.style.overflow = overflow; siblings.forEach((el, index) => { el.inert = previous[index]; }); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);

  return <div ref={layer} className="efl-guide-layer" data-layout={mobile ? 'sheet' : 'anchored'}>
    {target ? <div className="efl-guide-spotlight" style={target} aria-hidden="true" /> : <div className="efl-guide-backdrop" aria-hidden="true" />}
    <div ref={card} role="dialog" aria-modal="true" aria-labelledby="efl-guide-title" aria-describedby="efl-guide-description" aria-label={c.label} className="efl-guide-card" data-pointer={pointer?.side} style={{ ...placement, '--guide-arrow-x': `${pointer?.left || 24}px` } as React.CSSProperties}>
      <div className="efl-guide-card-scroll" style={{ maxHeight: Math.max(1, placement.maxHeight - 2) }}>
        <div className="efl-guide-topline"><span className="efl-guide-brand" role="img" aria-label="EFL UZ"><img className="efl-guide-logo-dark" src="/efluz-logo.png" alt="" /><img className="efl-guide-logo-light" src="/efluz-logo-light.png" alt="" /></span><span className="efl-guide-counter">{String(step + 1).padStart(2, '0')}<span>/ {String(targets.length).padStart(2, '0')}</span></span><button type="button" onClick={() => onFinish('skipped')} aria-label={c.skip}><X size={18} /></button></div>
        <div className="efl-guide-copy" aria-live="polite" aria-atomic="true"><div className="efl-guide-eyebrow"><Icon size={15} strokeWidth={1.8} /><span>{language === 'ru' ? 'Знакомство' : language === 'en' ? 'Quick tour' : 'Qisqa tanishtiruv'}</span></div><h2 id="efl-guide-title">{c.steps[step][0]}</h2><p id="efl-guide-description">{c.steps[step][1]}</p></div>
        <div className="efl-guide-bottom"><div className="efl-guide-progress" aria-label={`${step + 1} / ${targets.length} ${c.step}`}>{targets.map((_, index) => <span key={index} data-active={index === step} data-complete={index < step} />)}</div><div className="efl-guide-actions"><button type="button" onClick={() => step ? setStep(step - 1) : onFinish('skipped')} className="efl-guide-back">{step ? <><ArrowLeft size={15} />{c.back}</> : c.skip}</button><button ref={next} type="button" className="efl-guide-next btn-glass-primary" onClick={() => step === targets.length - 1 ? onFinish('completed') : setStep(step + 1)}>{step === targets.length - 1 ? <>{c.done}<Check size={16} /></> : <>{c.next}<ArrowRight size={16} /></>}</button></div></div>
        {step === targets.length - 1 && <p className="efl-guide-replay-hint">{c.again}</p>}
      </div>
    </div>
  </div>;
}
