import { isDesignPreviewBuild } from './designPreview';
import { installPreviewTransport } from './preview/transport';
if (isDesignPreviewBuild) installPreviewTransport();
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Analytics} from '@vercel/analytics/react';
import App from './App.tsx';
import './index.css';
import './admin-preview.css';
import './components/competition-content.css';
import './components/customTournaments/tournaments.css';

const viewport = isDesignPreviewBuild && new URLSearchParams(location.search).get('designPreview') === '1' ? new URLSearchParams(location.search).get('viewport') : null;
const frameUrl = new URL(location.href);
frameUrl.searchParams.delete('viewport');
createRoot(document.getElementById('root')!).render(
  viewport === 'mobile' || viewport === 'desktop' ? <div style={{height:'100dvh',overflow:'auto',background:'#080c14'}}><a href={frameUrl.href} style={{display:'block',color:'white',padding:8}}>← Moslashuvchan ko‘rinishga qaytish</a><iframe title="EFLUZ responsive preview" src={frameUrl.href} style={{display:'block',width:viewport==='mobile'?390:1440,height:'calc(100dvh - 40px)',border:0,margin:'0 auto'}} /></div> :
  <StrictMode>
    <App />
    {!isDesignPreviewBuild && <Analytics />}
  </StrictMode>,
);
