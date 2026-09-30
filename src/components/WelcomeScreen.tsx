import React, { useEffect } from 'react';
import { ArrowRight, Globe2, Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';
import type { AppTheme } from './Header';
import './welcome-screen.css';

const copy = {
  uz: {
    eyebrow: 'EFOOTBALL HAMJAMIYATI', title: ['Sizning klubingiz.', 'Sizning', 'mavsumingiz.'],
    description: 'Klub tanlang. O‘ynang. Natijangizni tasdiqlang.', leagues: 'TOP 5 LIGALAR',
    steps: ['Klubingizni tanlang', 'Raqib bilan o‘ynang', 'Natijani tasdiqlang'],
    start: 'Boshlash', footer: 'EFL UZ · eFootball hamjamiyati', language: 'Tilni tanlang',
    light: 'Light rejimga o‘tish', dark: 'Dark rejimga o‘tish',
  },
  ru: {
    eyebrow: 'СООБЩЕСТВО EFOOTBALL', title: ['Ваш клуб.', 'Ваш', 'сезон.'],
    description: 'Выберите клуб. Играйте. Подтверждайте результат.', leagues: 'ТОП-5 ЛИГ',
    steps: ['Выберите свой клуб', 'Сыграйте с соперником', 'Подтвердите результат'],
    start: 'Начать', footer: 'EFL UZ · Сообщество eFootball', language: 'Выберите язык',
    light: 'Светлая тема', dark: 'Тёмная тема',
  },
  en: {
    eyebrow: 'EFOOTBALL COMMUNITY', title: ['Your club.', 'Your', 'season.'],
    description: 'Choose a club. Play. Confirm your result.', leagues: 'TOP 5 LEAGUES',
    steps: ['Choose your club', 'Play your opponent', 'Confirm the result'],
    start: 'Get started', footer: 'EFL UZ · eFootball community', language: 'Choose language',
    light: 'Switch to light mode', dark: 'Switch to dark mode',
  },
};

const leagues = [
  { name: 'Premier League', icon: 'premier-league', monochrome: true },
  { name: 'La Liga', icon: 'la-liga', monochrome: false },
  { name: 'Serie A', icon: 'serie-a', monochrome: false },
  { name: 'Bundesliga', icon: 'bundesliga', monochrome: false },
  { name: 'Ligue 1', icon: 'ligue-1', monochrome: true },
];

interface WelcomeScreenProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onStart: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ theme, onThemeChange, onStart }) => {
  const { language, setLanguage } = useI18n();
  const c = copy[language];

  useEffect(() => {
    const previousBackground = document.body.style.backgroundColor;
    document.body.style.backgroundColor = theme === 'dark' ? '#080b12' : '#f4f5f7';
    return () => { document.body.style.backgroundColor = previousBackground; };
  }, [theme]);

  return (
    <section className={`efl-welcome efl-welcome--${theme}`} lang={language} aria-labelledby="welcome-title">
      <div className="welcome-layout">
        <header className="welcome-header">
          <img className="welcome-brand" src={theme === 'dark' ? '/efluz-logo.png' : '/efluz-logo-light.png'} alt="EFL UZ" width="132" height="46" />
          <div className="welcome-controls">
            <button type="button" className="welcome-theme" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? c.light : c.dark}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="welcome-language">
              <Globe2 size={16} aria-hidden="true" />
              <select aria-label={c.language} value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                <option value="uz">UZ</option><option value="ru">RU</option><option value="en">EN</option>
              </select>
            </div>
          </div>
        </header>

        <main className="welcome-content">
          <p className="welcome-eyebrow">{c.eyebrow}</p>
          <h1 id="welcome-title">{c.title.map((line, index) => <span key={index} className={index === 2 ? 'welcome-accent' : undefined}>{line}</span>)}</h1>
          <p className="welcome-description">{c.description}</p>

          <svg className="welcome-pitch" viewBox="0 0 320 70" fill="none" aria-hidden="true">
            <path d="M1 1h318v68H1zM160 1v68M1 14h30v42H1M319 14h-30v42h30M1 25h5v20H1M319 25h-5v20h5" />
            <circle cx="160" cy="35" r="21" />
          </svg>

          <section className="welcome-leagues" aria-labelledby="welcome-leagues-title">
            <h2 id="welcome-leagues-title">{c.leagues}</h2>
            <ul className="welcome-league-icons">
              {leagues.map((league) => (
                <li key={league.icon}>
                  <img src={`/welcome/${league.icon}.svg`} alt={league.name} className={league.monochrome ? 'welcome-monochrome' : undefined} width="40" height="44" />
                </li>
              ))}
            </ul>
          </section>

          <ol className="welcome-steps">
            {c.steps.map((step, index) => <li key={index}><span aria-hidden="true">0{index + 1}</span><span>{step}</span></li>)}
          </ol>
        </main>

        <footer className="welcome-footer">
          <button type="button" className="welcome-start" onClick={onStart}><span>{c.start}</span><ArrowRight size={21} aria-hidden="true" /></button>
          <p>{c.footer}</p>
        </footer>
      </div>
    </section>
  );
};
