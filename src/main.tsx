import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Analytics} from '@vercel/analytics/react';
import App from './App.tsx';
import './index.css';
import './components/trophy-cabinet.css';
import './components/discipline.css';
import './admin-preview.css';
import './telegram-viewport.css';
import './components/competition-content.css';
import './components/customTournaments/tournaments.css';
import './components/teamLeaguePreview/teamCrest.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
);
