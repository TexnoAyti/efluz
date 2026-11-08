// The actual EFLUZ React UI, without Vercel Analytics or legacy endpoints.
// This build is an isolated migration candidate, not the live Telegram Mini App.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installTelegramViewport} from './lib/telegramViewport';
import App from './App';
import './index.css';
import './components/trophy-cabinet.css';
import './components/discipline.css';
import './admin-preview.css';
import './telegram-viewport.css';
import './components/competition-content.css';
import './components/customTournaments/tournaments.css';
import './components/teamLeaguePreview/teamCrest.css';
import './components/competition-dialog-layout.css';

// Network guard in the migration candidate: any forgotten direct HTTP /api
// request is rejected locally, including absolute production Vercel URLs.
// Telegram Serverless.call uses the signed Telegram SDK, not fetch.
const originalFetch=window.fetch.bind(window);
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  try {
    const parsed=new URL(target,window.location.href);
    if (parsed.pathname==='/api'||parsed.pathname.startsWith('/api/')) {
      return Promise.reject(new Error('SERVERLESS_LEGACY_HTTP_BLOCKED'));
    }
  } catch { return Promise.reject(new Error('SERVERLESS_INVALID_HTTP_URL')); }
  return originalFetch(input,init);
}) as typeof window.fetch;

installTelegramViewport();
createRoot(document.getElementById('root')!).render(
  <StrictMode><App/></StrictMode>
);
