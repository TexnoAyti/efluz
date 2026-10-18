import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Search, Shield, Trophy, Bell, Swords, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { guidePlacement, type GuideRect, type GuideStatus } from '../lib/firstVisitGuide';
import './first-visit-guide.css';

const content = {
  uz: { label: 'EFL UZ bo‘yicha yo‘riqnoma', step: 'qadam', next: 'Keyingi', back: 'Orqaga', skip: 'O‘tkazib yuborish', done: 'Tushunarli, boshlaymiz!', again: 'Istalgan payt yuqoridagi “?” orqali qayta ko‘rishingiz mumkin.', steps: [
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
const targets = ['[data-guide="nav-dashboard"]', '[data-guide="nav-leagues"]', '[data-guide="nav-my-club"]', '[data-guide="match-actions"], [data-guide="nav-my-club"]', '#btn-global-search', '#btn-notifications'];
const icons = [Compass, Trophy, Shield, Swords, Search, Bell];

export function FirstVisitGuide({ onFinish }: { onFinish: (status: GuideStatus) => void }) {
  const { language } = useI18n();
  const c = content[language] || content.uz;
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<GuideRect | null>(null);
  const [placement, setPlacement] = useState(() => guidePlacement(null, window.innerWidth, window.innerHeight, 300));
  const layer = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const originalFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const finish = useRef(onFinish); finish.current = onFinish;
  const Icon = icons[step];

  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const candidate = targets[step].split(',').flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector.trim()))).find(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      });
      const r = candidate?.getBoundingClientRect();
      const rect = r ? { top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10 } : null;
      setTarget(rect);
      setPlacement(guidePlacement(rect, window.innerWidth, window.innerHeight, card.current?.offsetHeight || 300));
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

  return <div ref={layer} className="efl-guide-layer">
    {target ? <div className="efl-guide-spotlight" style={target} aria-hidden="true" /> : <div className="efl-guide-backdrop" aria-hidden="true" />}
    <div ref={card} role="dialog" aria-modal="true" aria-labelledby="efl-guide-title" aria-describedby="efl-guide-description" className="efl-guide-card" style={placement}>
      <div className="efl-guide-topline"><span>{c.label}</span><button type="button" onClick={() => onFinish('skipped')} aria-label={c.skip}><X size={17} /></button></div>
      <div className="efl-guide-progress" aria-label={`${step + 1} / ${targets.length}`}>{targets.map((_, index) => <span key={index} data-active={index <= step} />)}</div>
      <div className="efl-guide-heading"><span className="efl-guide-icon"><Icon size={23} strokeWidth={1.6} /></span><span>{step + 1} / {targets.length} · {c.step}</span></div>
      <div aria-live="polite" aria-atomic="true"><h2 id="efl-guide-title">{c.steps[step][0]}</h2><p id="efl-guide-description">{c.steps[step][1]}</p></div>
      <p className="efl-guide-replay-hint">{c.again}</p>
      <div className="efl-guide-actions"><button type="button" onClick={() => step ? setStep(step - 1) : onFinish('skipped')} className="efl-guide-back">{step ? <><ArrowLeft size={14} />{c.back}</> : c.skip}</button><button ref={next} type="button" className="efl-guide-next" onClick={() => step === targets.length - 1 ? onFinish('completed') : setStep(step + 1)}>{step === targets.length - 1 ? <>{c.done}<Check size={15} /></> : <>{c.next}<ArrowRight size={15} /></>}</button></div>
    </div>
  </div>;
}
