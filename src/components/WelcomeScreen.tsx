import React, { useEffect } from 'react';
import { ArrowRight, Globe2, Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';
import type { AppTheme } from './Header';
import './welcome-screen.css';

const copy = {
  uz: {
    eyebrow: 'EFLUZ · 2-MAVSUM',
    title: ['Yangi mavsum.', 'Yangi', 'imkoniyatlar.'],
    description: '2-mavsum uchun klubingizni tanlang va EFL musobaqalariga qo‘shiling.',
    steps: ['Yevropa yoki Osiyo ligasini tanlang', 'Bo‘sh klubni tanlang', 'Musobaqalarni kuzating va o‘ynang'],
    start: '2-mavsumga kirish', footer: 'EFLUZ · eFootball hamjamiyati',
    language: 'Tilni tanlang', light: 'Light rejimga o‘tish', dark: 'Dark rejimga o‘tish',
  },
  ru: {
    eyebrow: 'EFLUZ · СЕЗОН 2',
    title: ['Новый сезон.', 'Новые', 'возможности.'],
    description: 'Выберите клуб на второй сезон и присоединяйтесь к турнирам EFL.',
    steps: ['Выберите европейскую или азиатскую лигу', 'Выберите свободный клуб', 'Следите за турнирами и играйте'],
    start: 'Перейти к сезону 2', footer: 'EFLUZ · Сообщество eFootball',
    language: 'Выберите язык', light: 'Светлая тема', dark: 'Тёмная тема',
  },
  en: {
    eyebrow: 'EFLUZ · SEASON 2',
    title: ['New season.', 'New', 'possibilities.'],
    description: 'Choose your Season 2 club and join EFL competitions.',
    steps: ['Choose a European or Asian league', 'Pick an available club', 'Follow competitions and play'],
    start: 'Enter Season 2', footer: 'EFLUZ · eFootball community',
    language: 'Choose language', light: 'Switch to light mode', dark: 'Switch to dark mode',
  },
};

interface WelcomeScreenProps {
  seasonId?: string;
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
          <img className="welcome-brand" src={theme === 'dark' ? '/efluz-logo.png' : '/efluz-logo-light.png'} alt="EFLUZ" width="132" height="46" />
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
