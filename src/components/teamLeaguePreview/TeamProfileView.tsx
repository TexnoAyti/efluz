import React,{useEffect,useState} from 'react';
import {ArrowLeft,Shield,Users,Trophy,Lock,RefreshCw,ChevronRight,Settings,CalendarDays} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {canSeeTeamPreview} from '../../types/teamLeaguePreview';
import {teamPreviewRequest,loadTeamPreview} from '../../lib/teamLeaguePreviewApi';
import {teamProfileSummary,teamProfileFixtureComplete,type TeamProfileData} from '../../lib/teamProfile';
import {teamFixtureScore,teamStandings,teamFormatLabels} from '../../lib/teamLeagueEngine';
import {openTeamProfile,openTeamTournament,openTeamDirectory,openTeamWorkspace} from '../../lib/teamNavigation';
import {CompetitionTabs} from '../CompetitionChrome';
import {CompetitionEntry,CompetitionToolbar} from '../CompetitionWorkspace';
import {CompetitionFixtureCard} from '../CompetitionContent';
import {TeamForm,TeamPreviewDialog} from './TeamLeaguePreviewView';
import {TeamBadge} from './TeamLeagueDetail';
import '../public-club.css';
import './teamLeaguePreview.css';

import {TeamProfile} from './TeamProfile';

export function TeamProfileView({teamId,onBack}:{teamId?:string;onBack:()=>void}){
 const {user}=useAuth(),allowed=canSeeTeamPreview(user?.telegramId);
 const [data,setData]=useState<TeamProfileData|null>(null),[directory,setDirectory]=useState<Awaited<ReturnType<typeof loadTeamPreview>>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[search,setSearch]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState('');
 useEffect(()=>{let cancelled=false;setData(null);setDirectory(null);setEditing(false);setLoading(true);setError('');if(!allowed)return;
  const request=teamId?teamPreviewRequest<TeamProfileData>(`/teams/${encodeURIComponent(teamId)}`):loadTeamPreview();request.then(result=>{if(cancelled)return;if(teamId)setData(result as TeamProfileData);else setDirectory(result as Awaited<ReturnType<typeof loadTeamPreview>>);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};
 },[teamId,user?.id,allowed,revision]);
 if(!allowed)return <p className="competition-empty">Bu bo‘lim hozircha faqat loyiha egasiga ochiq.</p>;
 if(loading||error)return <div className="efl-custom-tournaments tourney-page"><button className="tourney-button justify-self-start" onClick={onBack}><ArrowLeft size={15}/>Orqaga</button>{error?<div role="alert" className="tourney-note error">{error}<button className="tourney-button" onClick={()=>setRevision(n=>n+1)}>Qayta urinish</button></div>:<p role="status" className="competition-empty"><RefreshCw size={20} className="animate-spin mx-auto"/>Team yuklanmoqda…</p>}</div>;
 const save=async(body:unknown)=>{if(busy)return;setBusy(true);setSaveError('');try{await teamPreviewRequest('/teams',body);setEditing(false);setRevision(n=>n+1);}catch(e:any){setSaveError(e.message);}finally{setBusy(false);}};
 if(data)return <><TeamProfile key={teamId} data={data} onBack={onBack} onEdit={()=>{setSaveError('');setEditing(true);}}/>{editing&&<TeamPreviewDialog title="Team va tarkib" onClose={()=>{if(!busy)setEditing(false);}}>{saveError&&<p role="alert" className="tourney-note error">{saveError}</p>}{data.leagues.some(l=>l.status==='ACTIVE')?<p className="tourney-note">Team faol turnirda. Tarkib, sardor va logo turnir yakunigacha yopiq.</p>:<TeamForm team={data.team} busy={busy} save={save}/>}</TeamPreviewDialog>}</>;
 return <div className="efl-custom-tournaments tourney-page team-tournaments"><div className="tourney-heading"><div><p className="tourney-eyebrow">Faqat sizga ochiq</p><h1>Teamlarim</h1></div><div className="tourney-action-row"><button className="tourney-button" onClick={onBack}><ArrowLeft size={15}/>Orqaga</button><button className="tourney-button primary" onClick={openTeamWorkspace}>Teamlarni boshqarish</button></div></div><CompetitionToolbar value={search} onChange={setSearch} label="Team qidirish"/><div className="tourney-grid">{directory?.teams.filter(t=>t.name.toLowerCase().includes(search.toLowerCase())).map(t=><CompetitionEntry key={t.id} onClick={()=>openTeamProfile(t.id)} emblem={<TeamBadge team={t}/>} title={t.name} meta={`Sardor: ${t.members.find(m=>m.id===t.captainMemberId)?.name||'—'}`} footer={`${t.members.length} o‘yinchi · Team profilini ochish`}/>)}</div>{!directory?.teams.length&&<p className="competition-empty">Hali team yaratilmagan. Team vs Team bo‘limida birinchi teamingizni yarating.</p>}</div>;
}
