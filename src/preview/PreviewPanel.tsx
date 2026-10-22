import React from 'react';
import { TOP5_LEAGUES } from '../constants/top5Clubs';
import { previewSeasons } from './data';
import { useAuth } from '../context/AuthContext';
import type { AppTheme } from '../components/Header';

export default function PreviewPanel({ theme, onThemeChange }: { theme: AppTheme; onThemeChange: (theme: AppTheme) => void }) {
  const { activeSeasonId } = useAuth();
  const params = new URLSearchParams(location.search);
  const navigate = (page: string, league?: string, season = activeSeasonId) => {
    sessionStorage.setItem('efl:competition-hub-subtab', page === 'uzeflife' ? 'uzeflife' : page === 'cups' ? 'cups' : 'leagues');
    if (league) sessionStorage.setItem('efl:preview-league', league);
    if (page === 'standings' || page === 'fixtures') sessionStorage.setItem('efl:preview-league-tab', page === 'standings' ? 'STANDINGS' : 'MATCHES');
    const path = page === 'dashboard' ? '/' : page === 'club' ? '/clubs/club-arsenal' : ['standings','fixtures','uzeflife'].includes(page) ? '/leagues' : `/${page}`;
    location.assign(`${path}?${new URLSearchParams({designPreview: '1', previewSeason: season, previewPage: page, previewLeague: league || params.get('previewLeague') || sessionStorage.getItem('efl:preview-league') || TOP5_LEAGUES[0].id})}`);
  };
  return <details style={{ position: 'fixed', right: 8, top: 8, zIndex: 1000, maxWidth: 'calc(100vw - 16px)', background: '#111827', color: '#fff', border: '1px solid #64748b', borderRadius: 10, padding: 10, font: '12px system-ui' }}>
    <summary style={{ cursor: 'pointer' }}>Design Preview · sintetik · faqat ko‘rish</summary>
    <div style={{ display: 'grid', gap: 8, paddingTop: 10 }}>
      <label>Sahifa <select aria-label="Preview page" defaultValue="" onChange={e => navigate(e.target.value)}><option value="" disabled>Tanlang</option>{[['dashboard','Bosh sahifa'],['leagues','Ligalar'],['standings','Jadval'],['fixtures','O‘yinlar / natijalar'],['cups','Kuboklar'],['champions-league','Yevrokuboklar'],['uzeflife','UZEFLIFE'],['club','Klub profili'],['my-club','Mening klubim']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Liga <select aria-label="Preview league" defaultValue={sessionStorage.getItem('efl:preview-league') || TOP5_LEAGUES[0].id} onChange={e => navigate('standings',e.target.value)}>{TOP5_LEAGUES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>Mavsum <select aria-label="Preview season" value={activeSeasonId} onChange={e => navigate('standings',undefined,e.target.value)}>{previewSeasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Mavzu <select aria-label="Preview theme" value={theme} onChange={e => onThemeChange(e.target.value as AppTheme)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label>Ekran <select aria-label="Preview viewport" defaultValue="actual" onChange={e => {
        if(e.target.value === 'actual') return;
        const frame = document.createElement('iframe');
        frame.title = 'EFLUZ responsive preview'; frame.src = `${location.pathname}?${new URLSearchParams({...Object.fromEntries(params), framed: '1'})}`;
        const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#020617;display:grid;place-items:center;overflow:auto;padding:45px 0 0';
        frame.style.cssText = `width:${e.target.value === 'mobile' ? '390' : '1440'}px;height:calc(100dvh - 50px);box-sizing:content-box;border:1px solid #64748b;flex-shrink:0;max-width:none`;
        const close = document.createElement('button'); close.textContent = 'Yopish ×'; close.style.cssText = 'position:fixed;right:15px;top:15px;color:white;cursor:pointer'; close.onclick = () => { overlay.remove(); e.target.value = 'actual'; };
        overlay.append(frame,close); document.body.append(overlay);
      }}><option value="actual">Haqiqiy ekran</option><option value="mobile">Mobile · 390px</option><option value="desktop">Desktop · 1440px</option></select></label>
    </div>
  </details>;
}
