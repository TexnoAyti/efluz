import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {canSeeTeamPreview,type PreviewTeam} from '../../types/teamLeaguePreview';
import {teamPreviewRequest,loadTeamPreview} from '../../lib/teamLeaguePreviewApi';
import type {TeamProfileData} from '../../lib/teamProfile';
import {openTeamProfile,openTeamWorkspace} from '../../lib/teamNavigation';
import {CompetitionEntry,CompetitionToolbar} from '../CompetitionWorkspace';
import {TeamForm,TeamPreviewDialog} from './TeamLeaguePreviewView';
import {TeamBadge} from './TeamLeagueDetail';
import {TeamProfile} from './TeamProfile';
import '../public-club.css';
import './teamLeaguePreview.css';
const MembershipPanel=React.lazy(()=>import('./TeamMembershipPanel').then(m=>({default:m.TeamMembershipPanel})));
const MemberManager=React.lazy(()=>import('./TeamMembershipPanel').then(m=>({default:m.TeamMemberManager})));
export function TeamProfileView({teamId,onBack}:{teamId?:string;onBack:()=>void}){
 const {user}=useAuth(),allowed=!!user,canManage=canSeeTeamPreview(user?.telegramId);
 const [data,setData]=useState<TeamProfileData|null>(null),[directory,setDirectory]=useState<Awaited<ReturnType<typeof loadTeamPreview>>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[search,setSearch]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState(''),[notice,setNotice]=useState('');
 const [memberEditing,setMemberEditing]=useState(false);
 const saveLock=useRef(false),mounted=useRef(false),scope=useRef('');scope.current=`${user?.id}:${teamId||''}`;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');if(!allowed)return;
  const request=teamId?teamPreviewRequest<TeamProfileData>(`${canManage?'':'/published'}/teams/${encodeURIComponent(teamId)}`):loadTeamPreview(canManage);
  request.then(result=>{if(cancelled)return;if(teamId)setData(result as TeamProfileData);else setDirectory(result as Awaited<ReturnType<typeof loadTeamPreview>>);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};
 },[teamId,user?.id,allowed,canManage,revision]);
 const refresh=()=>{if(!saveLock.current&&!editing)setRevision(n=>n+1);};
 const save=async(body:unknown)=>{
  if(saveLock.current||!canManage)return;saveLock.current=true;setBusy(true);setSaveError('');const startedFor=scope.current;
  try{const saved=await teamPreviewRequest<PreviewTeam>('/teams',body);if(!mounted.current||scope.current!==startedFor)return;setData(current=>current?{...current,team:saved}:current);setEditing(false);setNotice('Team saqlandi.');setRevision(n=>n+1);}
  catch(e:any){if(mounted.current&&scope.current===startedFor)setSaveError(e.message);}
  finally{saveLock.current=false;if(mounted.current&&scope.current===startedFor)setBusy(false);}
 };
 if(!allowed)return <p className="competition-empty">Jamoalarni ko‘rish uchun akkauntingizga kiring.</p>;
 if(!data&&!directory)return <div className="efl-custom-tournaments tourney-page"><button className="tourney-button justify-self-start" onClick={onBack}><ArrowLeft size={15}/>Orqaga</button>{error?<div role="alert" className="tourney-note error">{error}<button className="tourney-button" onClick={refresh}>Qayta urinish</button></div>:<p role="status" className="competition-empty"><RefreshCw size={20} className="animate-spin mx-auto"/>Team yuklanmoqda…</p>}</div>;
 const status=<>{notice&&<p role="status" className="team-profile-notice">{notice}</p>}{error&&<div role="alert" className="team-profile-notice">Yangilab bo‘lmadi: {error}. Oxirgi yuklangan ma’lumot ko‘rsatilmoqda.<button onClick={refresh}>Qayta urinish</button></div>}</>;
 if(data)return <><React.Suspense fallback={null}><MembershipPanel/></React.Suspense>{status}<TeamProfile key={teamId} data={data} onBack={onBack} onRefresh={refresh} refreshing={loading} onEdit={canManage?()=>{setSaveError('');setEditing(true);}:data.canManageTeam?()=>setMemberEditing(true):undefined}/>{memberEditing&&teamId&&<React.Suspense fallback={<p role="status">A’zolar yuklanmoqda…</p>}><MemberManager teamId={teamId} onClose={()=>{setMemberEditing(false);setRevision(n=>n+1);}}/></React.Suspense>}{canManage&&editing&&<TeamPreviewDialog title="Team va tarkib" onClose={()=>{if(!saveLock.current)setEditing(false);}}><button className="tourney-button mb-3" type="button" onClick={()=>{setEditing(false);setMemberEditing(true);}}>A’zolar va takliflarni boshqarish</button>{saveError&&<p role="alert" className="tourney-note error">{saveError}</p>}{data.leagues.some(l=>l.status==='ACTIVE')?<p className="tourney-note">Team faol turnirda. Tarkib, sardor va logo turnir yakunigacha yopiq.</p>:<TeamForm team={data.team} busy={busy} save={save}/>}</TeamPreviewDialog>}</>;
 const visible=directory?.teams.filter(t=>t.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))||[];
 return <div className="efl-custom-tournaments tourney-page team-tournaments">{status}<div className="tourney-heading"><div><p className="tourney-eyebrow">TEAMS</p><h1>Jamoalar</h1></div><div className="tourney-action-row"><button className="tourney-button" onClick={onBack}><ArrowLeft size={15}/>Orqaga</button><button className="tourney-button" onClick={refresh} disabled={loading} aria-label="Teamlar ro‘yxatini yangilash"><RefreshCw size={15} className={loading?'animate-spin':''}/></button>{canManage&&<button className="tourney-button primary" onClick={openTeamWorkspace}>Turnirlarni ochish</button>}</div></div><CompetitionToolbar value={search} onChange={setSearch} label="Team qidirish"/><div className="tourney-grid">{visible.map(t=><CompetitionEntry key={t.id} onClick={()=>openTeamProfile(t.id)} emblem={<TeamBadge team={t}/>} title={t.name} meta={`Sardor: ${t.members.find(m=>m.id===t.captainMemberId)?.name||'—'}`} footer={`${t.members.length} o‘yinchi · Team profilini ochish`}/>)}</div>{!visible.length&&<div className="competition-empty">{directory?.teams.length?<><p>Qidiruvga mos team topilmadi.</p><button className="tourney-button mt-3" onClick={()=>setSearch('')}>Qidiruvni tozalash</button></>:<><p>Hali team yaratilmagan.</p>{canManage&&<button className="tourney-button primary mt-3" onClick={openTeamWorkspace}>Turnirlarni ochish</button>}</>}</div>}</div>;
}
