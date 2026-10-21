import React from 'react';
import { useAuth } from '../context/AuthContext';
import { previewLeagues } from './data';
import type { AppTheme } from '../components/Header';
export function PreviewPanel({ theme, onThemeChange }: { theme: AppTheme; onThemeChange: (t: AppTheme) => void }) {
  const { seasons, activeSeasonId, setActiveSeasonId } = useAuth();
  const go = (path: string) => { window.location.href = `${path}?designPreview=1`; };
  return <details style={{ position:'fixed', right:12, top:8, zIndex:9999, maxWidth:300, background:'#142038', color:'white', padding:10, borderRadius:12, fontSize:12 }}>
    <summary style={{cursor:'pointer'}}>Design preview · sun’iy ma’lumot</summary>
    <div style={{display:'grid',gap:8, paddingTop:10}}>
      <label>Sahifa <select aria-label="Preview page" defaultValue="" onChange={e=>go(e.target.value)}><option value="" disabled>Tanlang</option>{[['/','Bosh sahifa'],['/leagues','Ligalar'],['/cups','Kuboklar'],['/my-matches','O‘yinlar'],['/clubs/club-arsenal','Klub']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      <label>Liga <select aria-label="Preview league" defaultValue="league-premier-league" onChange={e=>{sessionStorage.setItem('efl:preview-league',e.target.value);sessionStorage.setItem('efl:preview-league-tab','STANDINGS');go('/leagues');}}>{previewLeagues.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>Mavsum <select value={activeSeasonId} onChange={e=>setActiveSeasonId(e.target.value)}>{seasons.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Mavzu <select value={theme} onChange={e=>onThemeChange(e.target.value as AppTheme)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label>Ekran <select defaultValue="" onChange={e=>{ const url=new URL(location.href);url.searchParams.set('viewport',e.target.value);location.href=url.href; }}><option value="">Moslashuvchan</option><option value="mobile">Mobil · 390px</option><option value="desktop">Desktop · 1440px</option></select></label>
      <span>Faqat ko‘rish · amallar bloklangan</span>
    </div>
  </details>;
}
