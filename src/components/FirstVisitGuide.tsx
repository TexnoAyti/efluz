import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Search, Shield, Trophy, Bell, Swords, ListOrdered, MousePointerClick, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { findGuideTarget, guidePlacement, guideViewport, type GuideRect, type GuideStatus, type GuideStep } from '../lib/firstVisitGuide';
import './first-visit-guide.css';

const content = {
  uz: { label: 'EFL UZ bo‘yicha yo‘riqnoma', step: 'qadam', next: 'Keyingi', back: 'Orqaga', skip: 'O‘tkazib yuborish', done: 'Boshlaymiz', again: 'Yordam kerak bo‘lsa, yuqoridagi “?” tugmasini bosing.', steps: [
    ['Bosh sahifa', 'Navbatdagi raqib, o‘yin vaqti va so‘nggi natijalar shu yerda. Klubingiz bo‘lsa, eng yaqin uchrashuv birinchi ko‘rinadi.'],
    ['Turnirlar va klub tanlash', 'Ligalar, kuboklar va yevrokuboklar shu bo‘limda. Liga ichidan klublar, o‘yinlar va turnir jadvalini oching. Klub tanlash qabul holati va sizga berilgan ruxsatga bog‘liq.'],
    ['Sizning klubingiz', 'Tanlagan klublaringiz, o‘yinlaringiz va statistikangiz shu yerda. Bir nechta klubingiz bo‘lsa, ular orasida almashishingiz mumkin.'],
    ['Hisob qanday kiritiladi?', 'O‘yin tugagach, klub bo‘limidagi uchrashuvdan “Hisobni kiritish”ni oching. Natijani yuboring; raqib tasdiqlagach hisob rasmiylashadi. Tur yopiq bo‘lsa, uning ochilishini kuting.'],
    ['Turnir jadvali', 'Bu yerdan ligadagi o‘rningiz, ochkolar, g‘alabalar va to‘plar farqini ko‘rasiz. Boshqa liga jadvali uchun “Turnirlar”dan ligani tanlab, “Jadval” bo‘limini oching.'],
    ['Klubni tez toping', 'Qidiruvga klub nomini yozing va natijani bosing — o‘sha klubning sahifasi ochiladi. Unda barcha turnirlardagi o‘yinlar va natijalarni ko‘rasiz.'],
    ['Muhim xabarlar', 'Natija tasdig‘i, uchrashuvlar va turnir yangiliklari shu yerga keladi. Xabarlarni kuzatib boring — navbatdagi amalni o‘tkazib yubormaysiz.'],
  ] },
  ru: { label: 'Знакомство с EFL UZ', step: 'шаг', next: 'Далее', back: 'Назад', skip: 'Пропустить', done: 'Понятно, начнём!', again: 'Можно снова открыть через «?» вверху.', steps: [
    ['Главная', 'Здесь ближайший соперник, время матча и последние результаты. Если у вас есть клуб, следующий матч будет показан первым.'],
    ['Турниры и выбор клуба', 'Здесь лиги, кубки и еврокубки. Откройте лигу, чтобы увидеть клубы, матчи и таблицу. Выбор клуба зависит от приёма и вашего допуска.'],
    ['Ваш клуб', 'Ваши клубы, матчи и статистика. Если клубов несколько, здесь можно переключаться между ними.'],
    ['Как отправить счёт?', 'После игры откройте матч в разделе клуба и нажмите ввод счёта. Соперник подтверждает результат. Если тур закрыт, дождитесь открытия.'],
    ['Турнирная таблица', 'Здесь можно открыть место клуба, очки, победы и разницу мячей. Для другой лиги выберите её в разделе турниров и откройте таблицу.'],
    ['Быстрый поиск', 'Введите название клуба и выберите результат. Откроется страница клуба с матчами и результатами во всех турнирах.'],
    ['Важные уведомления', 'Здесь подтверждения результатов, матчи и новости турниров. Следите за сообщениями, чтобы не пропустить следующий шаг.'],
  ] },
  en: { label: 'Welcome to EFL UZ', step: 'step', next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Got it, let’s play!', again: 'Reopen this guide anytime using “?” at the top.', steps: [
    ['Home', 'Your next opponent, kickoff time and recent results are here. When you have a club, its next match appears first.'],
    ['Competitions and club selection', 'Find leagues, cups and European competitions here. Open a league for clubs, fixtures and standings. Club selection depends on admission and your access.'],
    ['Your club', 'Your clubs, matches and statistics. If you have several clubs, switch between them here.'],
    ['How to submit a score', 'After playing, open the match in your club section and choose score submission. Your opponent confirms the result. Wait for the round to open if it is locked.'],
    ['League standings', 'Open the league table here to see positions, points, wins and goal difference. For another league, select it under Competitions and open Standings.'],
    ['Find a club quickly', 'Search for a club and select the result to open its page with matches and results across every competition.'],
    ['Important notifications', 'Result confirmations, match updates and tournament news appear here. Check your messages for the next action.'],
  ] },
};
const defaultTargets = ['[data-guide="nav-dashboard"]', '[data-guide="nav-leagues"]', '[data-guide="nav-my-club"]', '[data-guide="score-entry"], [data-guide="nav-my-club"]', '[data-guide="standings-entry"], [data-guide="nav-leagues"]', '#btn-global-search', '#btn-notifications'];
const icons = [Compass, Trophy, Shield, Swords, ListOrdered, Search, Bell];

function visibleViewport() {
  return guideViewport(window.innerWidth, window.innerHeight, window.visualViewport, (window as any).Telegram?.WebApp?.viewportHeight);
}

function safeGuidePlacement(target: GuideRect | null, cardHeight: number) {
  const style = typeof getComputedStyle === 'function' && document.body ? getComputedStyle(document.body) : null;
  const inset = (value?: string) => Math.max(0,parseFloat(value || '') || 0);
  const view = visibleViewport();
  const localTarget = target ? {...target, left: target.left - view.left, top: target.top - view.top} : null;
  const position = guidePlacement(localTarget,view.width,view.height,cardHeight,{top:inset(style?.paddingTop),bottom:inset(style?.paddingBottom),left:inset(style?.paddingLeft),right:inset(style?.paddingRight)});
  return {...position, left: position.left + view.left, top: position.top + view.top};
}

export function FirstVisitGuide({ onFinish, onShowScoreEntry, onShowStandings, steps: customSteps, mascot=false, direct=false }: { steps?: GuideStep[]; mascot?: boolean; direct?: boolean; onFinish: (status: GuideStatus) => void; onShowScoreEntry?: () => void; onShowStandings?: () => void }) {
  const { language } = useI18n();
  const c = content[language] || content.uz;
  const targets = customSteps?.map(item => item.target) || defaultTargets;
  const stepContent = customSteps?.map(item => [item.title,item.description]) || c.steps;
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<GuideRect | null>(null);
  const [targetKind, setTargetKind] = useState('');
  const [mobile, setMobile] = useState(() => window.innerWidth < 680);
  const [pointer, setPointer] = useState<{ side: 'top' | 'bottom'; left: number } | null>(null);
  const [placement, setPlacement] = useState(() => safeGuidePlacement(null, 300));
  const layer = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const originalFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const finish = useRef(onFinish); finish.current = onFinish;
  const showScoreEntry = useRef(onShowScoreEntry); showScoreEntry.current = onShowScoreEntry;
  const showStandings = useRef(onShowStandings); showStandings.current = onShowStandings;
  const Icon = icons[step] || Compass;
  const advance=()=>step===targets.length-1?onFinish('completed'):setStep(value=>value+1);
  const nextLabel=direct?(step===targets.length-1?({uz:'Tushundim',ru:'Понятно',en:'Got it'}[language]):!targets[step]?({uz:'Ko‘rsat',ru:'Показать',en:'Show me'}[language]):c.next):step===targets.length-1?c.done:c.next;
  const tapHint={uz:'Yoritilgan joyga tegib keyingisiga o‘ting.',ru:'Нажмите на подсвеченное место, чтобы продолжить.',en:'Tap the highlighted area to continue.'}[language];

  useEffect(() => {
    if (!customSteps && step === 3 && !findGuideTarget(document, '[data-guide="score-entry"]')) showScoreEntry.current?.();
    if (!customSteps && step === 4 && !findGuideTarget(document, '[data-guide="standings-entry"]')) showStandings.current?.();
  }, [step]);

  useLayoutEffect(() => {
    let frame = 0;
    let scrolled: HTMLElement | undefined;
    let observed: HTMLElement | undefined;
    let missingTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const candidate = findGuideTarget(document, targets[step]);
      if(direct&&targets[step]&&!candidate&&!missingTimer)missingTimer=setTimeout(()=>{if(step===targets.length-1)finish.current('completed');else setStep(value=>value===step?value+1:value);},500);
      if(candidate&&missingTimer){clearTimeout(missingTimer);missingTimer=undefined;}
      const view = visibleViewport();
      const bounds = candidate?.getBoundingClientRect();
      const outside = bounds && (bounds.top < view.top || bounds.bottom > view.top + view.height || bounds.left < view.left || bounds.right > view.left + view.width);
      if (candidate && candidate !== scrolled && (outside || ['score-entry', 'standings-entry'].includes(candidate.dataset.guide || ''))) {
        scrolled = candidate;
        candidate.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      if (candidate !== observed) {
        if (observed) observer.unobserve(observed);
        observed = candidate;
        if (observed) observer.observe(observed);
      }
      const r = candidate?.getBoundingClientRect();
      const visible = r && r.bottom > view.top && r.top < view.top + view.height && r.right > view.left && r.left < view.left + view.width;
      const rect = r && visible ? { top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10 } : null;
      setTarget(rect);
      setTargetKind(candidate?.dataset.guide || candidate?.id || '');
      // Measure full content, not the height constrained by the previous step.
      const scroller = card.current?.firstElementChild as HTMLElement | null;
      const copy = scroller?.querySelector<HTMLElement>('.efl-guide-copy');
      const height = scroller ? scroller.scrollHeight + Math.max(0,(copy?.scrollHeight || 0)-(copy?.clientHeight || 0)) : 300;
      const position = safeGuidePlacement(rect, height);
      const isMobile = view.width < 680;
      setMobile(isMobile); setPlacement(position);
      const above = rect && position.top + Math.min(height, position.maxHeight) <= rect.top;
      const below = rect && position.top >= rect.top + rect.height;
      setPointer(rect && (above || below) ? { side: above ? 'bottom' : 'top', left: Math.max(24, Math.min(position.width - 24, rect.left + rect.width / 2 - position.left)) } : null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    update(); next.current?.focus({ preventScroll: true });
    if (card.current) observer.observe(card.current);
    if (document.body) observer.observe(document.body);
    const mutation = new MutationObserver(records => {
      if (records.some(record => !layer.current?.contains(record.target))) schedule();
    });
    const root = layer.current?.parentElement;
    if (root) mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    const telegram=(window as any).Telegram?.WebApp;
    const safeEvents=['viewportChanged','safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'];
    safeEvents.forEach(event=>telegram?.onEvent?.(event,schedule));
    return () => { if(missingTimer)clearTimeout(missingTimer); safeEvents.forEach(event=>telegram?.offEvent?.(event,schedule)); cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); };
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

  const fallbackDescription = !customSteps && step === 3 && targetKind !== 'score-entry'
    ? ({uz: 'O‘yinlaringizni “Klub” bo‘limidan oching. O‘ynash mumkin bo‘lgan uchrashuvda hisob kiritish tugmasi chiqadi. Hozir u tugma ko‘rinmagani uchun klub bo‘limini ko‘rsatyapmiz.', ru: 'Откройте свои матчи в разделе «Клуб». В доступном матче появится ввод счёта. Сейчас эта кнопка не видна, поэтому показываем раздел клуба.', en: 'Open your matches under Club. A playable match will offer score entry. That button is not visible now, so we are showing the Club section.'}[language])
    : !customSteps && step === 4 && targetKind !== 'standings-entry'
    ? ({uz: '“Turnirlar”dan kerakli ligani oching va “Jadval” bo‘limini tanlang. Bu yerda o‘rin, ochkolar va natijalarni ko‘rasiz.', ru: 'В разделе турниров откройте нужную лигу и её таблицу, чтобы увидеть места, очки и результаты.', en: 'Open your league under Competitions, then open its standings to see positions, points and results.'}[language])
    : stepContent[step][1];

  return <div ref={layer} className="efl-guide-layer" data-layout={mobile ? 'sheet' : 'anchored'} data-direct={direct}>
    {target ? <div className="efl-guide-spotlight" style={target} aria-hidden="true" /> : <div className="efl-guide-backdrop" aria-hidden="true" />}
    {direct&&target&&<button type="button" tabIndex={-1} className="efl-guide-target-tap" aria-label={tapHint} style={target} onClick={advance}><span className="efl-guide-tap-hand" aria-hidden="true"><MousePointerClick size={20}/></span></button>}
    <div ref={card} role="dialog" aria-modal="true" aria-labelledby="efl-guide-title" aria-describedby="efl-guide-description" aria-label={c.label} className="efl-guide-card" data-compact={placement.maxHeight < 300} data-pointer={pointer?.side} style={{ ...placement, '--guide-arrow-x': `${pointer?.left || 24}px` } as React.CSSProperties}>
      <div className="efl-guide-card-scroll" style={{ maxHeight: Math.max(1, placement.maxHeight - 2) }}>
        <div className="efl-guide-topline"><span className="efl-guide-brand" role="img" aria-label={mascot?"Munfiz":"EFL UZ"}>{mascot&&<picture><source media="(prefers-reduced-motion: reduce)" srcSet="/munfiz/v2/still.webp"/><img src={direct&&step===0?"/munfiz/v2/wave.webp":"/munfiz/v2/point.webp"} alt="" style={{height:60,width:44}}/></picture>}<span hidden={mascot} style={{display:mascot?'none':'contents'}}><img className="efl-guide-logo-dark" src="/efluz-logo.png" alt="" /><img className="efl-guide-logo-light" src="/efluz-logo-light.png" alt="" /></span></span><span className="efl-guide-counter">{String(step + 1).padStart(2, '0')}<span>/ {String(targets.length).padStart(2, '0')}</span></span><button type="button" onClick={() => onFinish('skipped')} aria-label={c.skip}><X size={18} /></button></div>
        <div className="efl-guide-copy" aria-live="polite" aria-atomic="true"><div className="efl-guide-eyebrow"><Icon size={15} strokeWidth={1.8} /><span>{language === 'ru' ? 'Знакомство' : language === 'en' ? 'Quick tour' : 'Qisqa tanishtiruv'}</span></div><h2 id="efl-guide-title">{stepContent[step][0]}</h2><p id="efl-guide-description">{fallbackDescription}</p>{direct&&target&&<p className="efl-guide-tap-hint">{tapHint}</p>}</div>
        <div className="efl-guide-bottom"><div hidden={direct} className="efl-guide-progress" aria-label={`${step + 1} / ${targets.length} ${c.step}`}>{targets.map((_, index) => <span key={index} data-active={index === step} data-complete={index < step} />)}</div><div className="efl-guide-actions"><button type="button" onClick={() => step ? setStep(step - 1) : onFinish('skipped')} className="efl-guide-back">{step ? <><ArrowLeft size={15} />{c.back}</> : c.skip}</button><button ref={next} type="button" className="efl-guide-next btn-glass-primary" onClick={advance}>{step===targets.length-1?<>{nextLabel}<Check size={16}/></>:<>{nextLabel}<ArrowRight size={16}/></>}</button></div></div>
        {!direct && step === targets.length - 1 && <p className="efl-guide-replay-hint">{c.again}</p>}
      </div>
    </div>
  </div>;
}
