import {TeamLeaguePreviewView} from '../teamLeaguePreview/TeamLeaguePreviewView';
import {canSeeTeamPreview} from '../../types/teamLeaguePreview';
import React,{useState,useEffect,useRef} from 'react';
import {Plus,Ticket,Search,SlidersHorizontal,Trophy,RefreshCw} from 'lucide-react';
import type {CustomTournament} from '../../types/customTournament';
import {customTournamentApi} from '../../lib/customTournamentApi';
import {TournamentCard} from './TournamentCard';
import {TournamentWizardModal} from './TournamentWizardModal';
import {TournamentDetailView} from './TournamentDetailView';
import {AdminTicketManagementModal} from './AdminTicketManagementModal';
import {readTournamentLaunch} from '../../lib/customTournamentLinks';
import {useAuth} from '../../context/AuthContext';
export function TournamentListView(){
 const {user}=useAuth();
 const [teamMode,setTeamMode]=useState(false);
 const modeSwitch=canSeeTeamPreview(user?.telegramId)?<nav className="tourney-tabs" aria-label="Turnir o‘yin turi"><button aria-pressed={!teamMode} onClick={()=>setTeamMode(false)}>Yakka o‘yin</button><button aria-pressed={teamMode} onClick={()=>setTeamMode(true)}>Team vs Team</button></nav>:null;
 const [tab,setTab]=useState<'all'|'my'>(()=>{try{return sessionStorage.getItem(`efl:custom-tab:${user?.id}`)==='all'?'all':'my';}catch{return 'my';}});
 const [items,setItems]=useState<CustomTournament[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [balance,setBalance]=useState<number|null>(null),[ticketError,setTicketError]=useState('');
 const [selected,setSelected]=useState<string|null>(()=>readTournamentLaunch()?.tournamentId||null),[token,setToken]=useState(()=>readTournamentLaunch()?.token);
 const [wizard,setWizard]=useState(false),[ticketAdmin,setTicketAdmin]=useState(false),[filters,setFilters]=useState(false);
 const [search,setSearch]=useState(''),[status,setStatus]=useState('ALL'),[format,setFormat]=useState('ALL');
 const sequence=useRef(0);
 const load=async()=>{const id=++sequence.current;setLoading(true);setError('');try{const data=tab==='my'?await customTournamentApi.getMyTournaments():await customTournamentApi.getPublicTournaments(100);if(id===sequence.current)setItems(data);}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'Turnirlarni yuklab bo‘lmadi.');}finally{if(id===sequence.current)setLoading(false);}};
 const tickets=async()=>{setTicketError('');try{setBalance((await customTournamentApi.getTicketBalance()).balance);}catch(e){setTicketError(e instanceof Error?e.message:'Balans yuklanmadi.');}};
 useEffect(()=>{try{sessionStorage.setItem(`efl:custom-tab:${user?.id}`,tab);}catch{}load();return()=>{sequence.current++;};},[tab,user?.id]);
 useEffect(()=>{tickets();},[user?.id]);
 const visible=items.filter(t=>`${t.name} ${t.description||''}`.toLowerCase().includes(search.trim().toLowerCase())&&(status==='ALL'||t.status===status)&&(format==='ALL'||t.format===format));
 const filtered=!!search.trim()||status!=='ALL'||format!=='ALL';
 if(teamMode&&canSeeTeamPreview(user?.telegramId))return <div className="efl-custom-tournaments tourney-page !pb-0">{modeSwitch}<TeamLeaguePreviewView/></div>;
 if(selected)return <TournamentDetailView tournamentId={selected} inviteToken={token} onBack={()=>{setSelected(null);setToken(undefined);load();tickets();}}/>;
 return <div className="efl-custom-tournaments tourney-page">
  {modeSwitch}
  <header className="tourney-heading"><div><p className="tourney-eyebrow">Do‘stlar bilan musobaqa</p><h1>O‘z turniringiz</h1></div><button className="tourney-button primary" onClick={()=>setWizard(true)}><Plus size={16}/>Yaratish</button></header>
  <div className="tourney-ticket"><Ticket size={15}/><span>Balans: <strong>{balance??'—'} ticket</strong></span><span>· Yaratish 1 ticket, qatnashish bepul</span>{user?.telegramId==='5209126900'&&<button className="underline min-h-[44px]" onClick={()=>setTicketAdmin(true)}>Ticket boshqaruvi</button>}</div>
  {ticketError&&<div role="alert" className="tourney-note error">{ticketError}<button className="tourney-button mt-2" onClick={tickets}>Qayta urinish</button></div>}
  {balance===0&&<div className="tourney-note">Bepul ticket bir marta beriladi. Qatnashish uchun ticket kerak emas. Yana turnir ochish uchun <a href="https://t.me/texnoadmin" target="_blank" rel="noreferrer" className="underline">@texnoadmin</a> bilan bog‘laning.</div>}
  <nav className="tourney-tabs" aria-label="Turnir ro‘yxati"><button aria-pressed={tab==='my'} onClick={()=>setTab('my')}>Mening turnirlarim</button><button aria-pressed={tab==='all'} onClick={()=>setTab('all')}>Ochiq turnirlar</button></nav>
  <div className="tourney-toolbar"><label className="tourney-search"><Search size={16}/><input aria-label="Turnir qidirish" placeholder="Nomi bo‘yicha qidirish" value={search} onChange={e=>setSearch(e.target.value)}/></label><button aria-label="Turnir filtrlarini ochish" aria-expanded={filters} className="tourney-button" onClick={()=>setFilters(!filters)}><SlidersHorizontal size={16}/></button></div>
  {filters&&<div className="tourney-filters"><label className="tourney-field">Holat<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">Barcha holatlar</option><option value="REGISTRATION_OPEN">Qabul ochiq</option><option value="IN_PROGRESS">Davom etmoqda</option><option value="COMPLETED">Yakunlangan</option><option value="CANCELLED">Bekor qilingan</option></select></label><label className="tourney-field">Format<select value={format} onChange={e=>setFormat(e.target.value)}><option value="ALL">Barcha formatlar</option><option value="LEAGUE">Liga</option><option value="PLAYOFF">Pley-off</option><option value="LEAGUE_AND_PLAYOFF">Liga + pley-off</option></select></label></div>}
  {filtered&&<button className="tourney-button justify-self-start" onClick={()=>{setSearch('');setStatus('ALL');setFormat('ALL');}}>Filtrlarni tozalash</button>}
  {loading?<div className="tourney-empty"><RefreshCw size={20} className="mx-auto animate-spin"/><p className="mt-3">Turnirlar yuklanmoqda…</p></div>:error?<div role="alert" className="tourney-note error">{error}<button className="tourney-button mt-3" onClick={load}>Qayta urinish</button></div>:visible.length===0?<div className="tourney-empty"><Trophy size={28} className="mx-auto"/><h3>{filtered?'Mos turnir topilmadi':tab==='my'?'Hali turniringiz yo‘q':'Qabul ochiq turnirlar yo‘q'}</h3><p>{filtered?'Qidiruvni yoki filtrlarni o‘zgartiring.':tab==='my'?'Turnir yarating yoki ochiq turnirga qo‘shiling. Taklif havolasi orqali yopiq turnirga ham kira olasiz.':'Yangi turnir yaratib, do‘stlaringizni taklif qiling.'}</p>{!filtered&&<div className="tourney-action-row justify-center"><button className="tourney-button primary" onClick={()=>setWizard(true)}>Turnir yaratish</button>{tab==='my'&&<button className="tourney-button" onClick={()=>setTab('all')}>Ochiq turnirlar</button>}</div>}</div>:<div className="tourney-grid">{visible.map(t=><TournamentCard key={t.id} tournament={t} roleLabel={tab==='my'?(t.organizerUserId===user?.id?'Tashkilotchi':t.assistantAdminIds.includes(user?.id||'')?'Yordamchi':'Qatnashchi'):undefined} onClick={()=>{setToken(undefined);setSelected(t.id);}}/>)}</div>}
  <TournamentWizardModal isOpen={wizard} onClose={()=>setWizard(false)} onTournamentCreated={id=>{setWizard(false);setTab('my');setToken(undefined);setSelected(id);tickets();}}/>
  {user?.telegramId==='5209126900'&&<AdminTicketManagementModal isOpen={ticketAdmin} onClose={()=>{setTicketAdmin(false);tickets();}}/>}
 </div>;
}
