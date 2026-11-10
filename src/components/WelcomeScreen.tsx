import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe2, Moon, Sun, Trophy, Footprints, Award } from 'lucide-react';
import { useI18n } from '../i18n';
import type { AppTheme } from './Header';
import './welcome-screen.css';

const copy = {
  uz: {
    eyebrow: 'EFOOTBALL HAMJAMIYATI', title: ['Sizning klubingiz.', 'Sizning', 'mavsumingiz.'],
    description: 'Klub tanlang. O‘ynang. Natijangizni tasdiqlang.',
    europe: 'YEVROPA LIGALARI', asia: 'OSIYO LIGALARI',
    secondEyebrow: 'EFLUZ · 2-MAVSUM', secondTitle: 'Yangi mavsum. Yangi imkoniyatlar.',
    secondDescription: 'Yangi ligalar, yangi raqobat va mavsum yakunidagi individual sovrinlar.',
    goldenBall: 'Oltin To‘p', goldenBallNote: 'Eng yaxshi futbolchi · klub egalari ovozi',
    goldenBoot: 'Oltin Butsa', goldenBootNote: 'Mavsumning eng ko‘p gol urgan futbolchisi',
    weekly: 'Hafta o‘yinchisi', weeklyNote: 'Har haftaning eng yaxshi futbolchisi',
    next: 'Davom etish', back: 'Orqaga', start: 'Boshlash',
    footer: 'EFL UZ · eFootball hamjamiyati', language: 'Tilni tanlang',
    light: 'Light rejimga o‘tish', dark: 'Dark rejimga o‘tish',
  },
  ru: {
    eyebrow: 'СООБЩЕСТВО EFOOTBALL', title: ['Ваш клуб.', 'Ваш', 'сезон.'],
    description: 'Выберите клуб. Играйте. Подтверждайте результат.',
    europe: 'ЕВРОПЕЙСКИЕ ЛИГИ', asia: 'АЗИАТСКИЕ ЛИГИ',
    secondEyebrow: 'EFLUZ · СЕЗОН 2', secondTitle: 'Новый сезон. Новые возможности.',
    secondDescription: 'Новые лиги, новые соперники и индивидуальные награды сезона.',
    goldenBall: 'Золотой мяч', goldenBallNote: 'Лучший игрок · голосование владельцев клубов',
    goldenBoot: 'Золотая бутса', goldenBootNote: 'Лучший бомбардир сезона',
    weekly: 'Игрок недели', weeklyNote: 'Лучший игрок каждой недели',
    next: 'Продолжить', back: 'Назад', start: 'Начать',
    footer: 'EFL UZ · Сообщество eFootball', language: 'Выберите язык',
    light: 'Светлая тема', dark: 'Тёмная тема',
  },
  en: {
    eyebrow: 'EFOOTBALL COMMUNITY', title: ['Your club.', 'Your', 'season.'],
    description: 'Choose a club. Play. Confirm your result.',
    europe: 'EUROPEAN LEAGUES', asia: 'ASIAN LEAGUES',
    secondEyebrow: 'EFLUZ · SEASON 2', secondTitle: 'New season. New possibilities.',
    secondDescription: 'New leagues, new competition, and individual season awards.',
    goldenBall: 'Golden Ball', goldenBallNote: 'Best player · voted by club owners',
    goldenBoot: 'Golden Boot', goldenBootNote: 'Season top scorer',
    weekly: 'Player of the Week', weeklyNote: 'Best player each week',
    next: 'Continue', back: 'Back', start: 'Get started',
    footer: 'EFL UZ · eFootball community', language: 'Choose language',
    light: 'Switch to light mode', dark: 'Switch to dark mode',
  },
};

const europe = [
  { name: 'Premier League', icon: 'premier-league' },
  { name: 'La Liga', icon: 'la-liga' },
  { name: 'Serie A', icon: 'serie-a' },
  { name: 'Bundesliga', icon: 'bundesliga' },
  { name: 'Ligue 1', icon: 'ligue-1' },
];
const asia = [
  { name: 'O‘zbekiston Superligasi', icon: 'uzbekistan-superliga' },
  { name: 'Saudi Pro League', icon: 'saudi-pro-league' },
  { name: 'J1 League', icon: 'j1-league' },
  { name: 'Turkiya Superligasi', icon: 'turkey-super-lig' },
];

interface WelcomeScreenProps {
  seasonId?: string;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onStart: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ theme, onThemeChange, onStart }) => {
  const { language, setLanguage } = useI18n();
  const [step, setStep] = useState<1 | 2>(1);
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
              <select aria-label={c.language} value={language} onChange={e => setLanguage(e.target.value as typeof language)}>
                <option value="uz">UZ</option><option value="ru">RU</option><option value="en">EN</option>
              </select>
            </div>
          </div>
        </header>

        <main className="welcome-content">
          {step === 1 ? (
            <>
              <p className="welcome-eyebrow">{c.eyebrow}</p>
              <h1 id="welcome-title">{c.title.map((line, index) => <span key={index} className={index === 2 ? 'welcome-accent' : undefined}>{line}</span>)}</h1>
              <p className="welcome-description">{c.description}</p>
              <svg className="welcome-pitch" viewBox="0 0 320 70" fill="none" aria-hidden="true">
                <path d="M1 1h318v68H1zM160 1v68M1 14h30v42H1M319 14h-30v42h30M1 25h5v20H1M319 25h-5v20h5" />
                <circle cx="160" cy="35" r="21" />
              </svg>
              <section className="welcome-leagues" aria-labelledby="welcome-europe-title">
                <h2 id="welcome-europe-title">{c.europe}</h2>
                <ul className="welcome-league-icons">
                  {europe.map(league => <li key={league.icon}>
                    <img src={`/welcome/${league.icon}.svg`} alt={league.name} width="40" height="44" />
                  </li>)}
                </ul>
              </section>
              <section className="welcome-leagues welcome-asia" aria-labelledby="welcome-asia-title">
                <h2 id="welcome-asia-title">{c.asia}</h2>
                <ul className="welcome-league-icons welcome-asian-icons">
                  {asia.map(league => <li key={league.icon}>
                    <img src={`/welcome/${league.icon}.svg`} alt={league.name} width="40" height="44" />
                  </li>)}
                </ul>
              </section>
            </>
          ) : (
            <>
              <p className="welcome-eyebrow">{c.secondEyebrow}</p>
              <h1 id="welcome-title" className="welcome-season-heading">{c.secondTitle}</h1>
              <p className="welcome-description">{c.secondDescription}</p>
              <div className="welcome-awards" aria-label={c.goldenBall + ', ' + c.goldenBoot}>
                <article className="welcome-award-card">
                  <span className="welcome-award-icon welcome-award-gold"><Trophy size={42} strokeWidth={1.4} aria-hidden="true" /></span>
                  <strong>{c.goldenBall}</strong>
                  <p>{c.goldenBallNote}</p>
                </article>
                <article className="welcome-award-card">
                  <span className="welcome-award-icon welcome-award-gold"><Footprints size={42} strokeWidth={1.4} aria-hidden="true" /></span>
                  <strong>{c.goldenBoot}</strong>
                  <p>{c.goldenBootNote}</p>
                </article>
              </div>
              <div className="welcome-weekly"><Award size={19} aria-hidden="true" /><div><strong>{c.weekly}</strong><p>{c.weeklyNote}</p></div></div>
            </>
          )}
        </main>

        <footer className="welcome-footer">
          <div className="welcome-progress" role="status" aria-label={`${step} / 2`}>
            <span className={step === 1 ? 'active' : ''} /><span className={step === 2 ? 'active' : ''} />
          </div>
          <div className="welcome-actions">
            {step === 2 && <button type="button" className="welcome-back" onClick={() => setStep(1)}><ArrowLeft size={18} aria-hidden="true" /><span>{c.back}</span></button>}
            <button type="button" className="welcome-start" onClick={step === 1 ? () => setStep(2) : onStart}>
              <span>{step === 1 ? c.next : c.start}</span><ArrowRight size={21} aria-hidden="true" />
            </button>
          </div>
          <p>{c.footer}</p>
        </footer>
      </div>
    </section>
  );
};
