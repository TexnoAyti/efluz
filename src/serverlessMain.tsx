// The actual EFLUZ React UI, without Vercel Analytics or legacy endpoints.
// This build is an isolated migration candidate, not the live Telegram Mini App.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installTelegramViewport} from './lib/telegramViewport';
import {shouldRejectLegacyApiRequest} from './lib/serverlessNetworkBoundary';
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

// Telegram SDK uses HTTPS POST /api/<operation> on the exact appN.tgcloud.ai
// host. Preserve it while continuing to reject all legacy Vercel API access.
// Do NOT forward credentials or allow unrelated HTTP routes as a fallback.
const originalFetch=window.fetch.bind(window);
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const method=init?.method||(typeof Request!=='undefined'&&input instanceof Request?
    input.method:'GET');
  if(shouldRejectLegacyApiRequest(target,window.location.href,method)){
    return Promise.reject(new Error('SERVERLESS_LEGACY_HTTP_BLOCKED'));
  }
  return originalFetch(input,init);
}) as typeof window.fetch;

installTelegramViewport();
createRoot(document.getElementById('root')!).render(
  <StrictMode><App/></StrictMode>
);
