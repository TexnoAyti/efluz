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

installTelegramViewport();
createRoot(document.getElementById('root')!).render(
  <StrictMode><App/></StrictMode>
);
