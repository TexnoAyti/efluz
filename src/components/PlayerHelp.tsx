import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { playerFaq } from '../content/playerFaq';
import type { GuideStatus } from '../lib/firstVisitGuide';
import './first-visit-guide.css';
import './player-help.css';

export function PlayerHelp({ onFinish }: { onFinish: (status: GuideStatus) => void }) {
  const { language } = useI18n();
  const c = playerFaq[language] || playerFaq.uz;
  const [expanded, setExpanded] = useState<number | null>(0);
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const finish = useRef(onFinish); finish.current = onFinish;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = Array.from(layer.current?.parentElement?.children || []).filter(el => el !== layer.current) as HTMLElement[];
    const previous = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    close.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish.current('skipped'); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      const outside = !card.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = overflow;
      siblings.forEach((el, index) => { el.inert = previous[index]; });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <div ref={layer} className="efl-guide-layer efl-help-layer">
    <div className="efl-guide-backdrop" aria-hidden="true" />
    <div ref={card} className="efl-guide-card efl-help-card" role="dialog" aria-modal="true" aria-labelledby="efl-help-title" aria-describedby="efl-help-intro">
      <header className="efl-help-header">
        <span className="efl-help-icon"><CircleHelp size={24} strokeWidth={1.8} /></span>
        <button ref={close} type="button" className="efl-help-close" aria-label={c.close} onClick={() => onFinish('skipped')}><X size={20} /></button>
        <h2 id="efl-help-title">{c.title}</h2>
        <p id="efl-help-intro">{c.intro}</p>
      </header>
      <div className="efl-help-questions">
        {c.items.map(([question, answer], index) => <section key={index} className="efl-help-item">
          <h3><button type="button" id={`efl-help-question-${index}`} aria-expanded={expanded === index} aria-controls={`efl-help-answer-${index}`} onClick={() => setExpanded(expanded === index ? null : index)}>
            <span>{question}</span><ChevronDown size={18} aria-hidden="true" className={expanded === index ? 'is-open' : ''} />
          </button></h3>
          <div id={`efl-help-answer-${index}`} role="region" aria-labelledby={`efl-help-question-${index}`} hidden={expanded !== index}><p>{answer}</p></div>
        </section>)}
      </div>
      <footer className="efl-help-footer"><p>{c.hint}</p><button type="button" className="efl-guide-next btn-glass-primary" onClick={() => onFinish('completed')}>{c.done}</button></footer>
    </div>
  </div>;
}
