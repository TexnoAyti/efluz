import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,Ticket,Users,UserRound} from 'lucide-react';
import {useAuth} from '../context/AuthContext';
import {api} from '../lib/api';
import type {League,Competition} from '../types';
import type {CustomTournament} from '../types/customTournament';
import {customTournamentApi} from '../lib/customTournamentApi';
import {readTournamentLaunch} from '../lib/customTournamentLinks';
import {canSeeTeamPreview,type PreviewTeam,type TeamLeague} from '../types/teamLeaguePreview';
import {loadTeamPreview,teamPreviewRequest} from '../lib/teamLeaguePreviewApi';
import {buildCompetitionDirectory,filterCompetitionDirectory,type CompetitionCategory,type CompetitionState,type CompetitionTarget} from '../lib/competitionDirectory';
import {CompetitionDirectoryView} from './CompetitionDirectoryView';
import {ClubsView} from './ClubsView';
import {CupBracketsView} from './CupBracketsView';
import {ChampionsLeagueView} from './ChampionsLeagueView';
import {SeasonHubView} from './SeasonHubView';
import {TournamentDetailView} from './customTournaments/TournamentDetailView';
import {TournamentWizardModal} from './customTournaments/TournamentWizardModal';
import {AdminTicketManagementModal} from './customTournaments/AdminTicketManagementModal';
import {TeamLeaguePreviewView,TeamCompetitionDialog,TeamTournamentSetup} from './teamLeaguePreview/TeamLeaguePreviewView';
import './customTournaments/tournaments.css';
import './competition-directory.css';

type LegacyTab='all'|'leagues'|'cups'|'european'|'season'|'custom';
interface HubData{scope:string;leagues:League[];competitions:Competition[];publicTournaments:CustomTournament[];myTournaments:CustomTournament[];teams:PreviewTeam[];teamLeagues:TeamLeague[]}
const empty:HubData={scope:'',leagues:[],competitions:[],publicTournaments:[],myTournaments:[],teams:[],teamLeagues:[]};
function initialNavigation(initial:LegacyTab){
 const launch=readTournamentLaunch();
 if(launch)return {category:'all' as CompetitionCategory,scope:'all' as const,target:{kind:'custom',tournamentId:launch.tournamentId,token:launch.token} as CompetitionTarget};
 let saved='',leagueId:string|undefined,cupId:string|undefined,leagueIntent=false;
 try{saved=sessionStorage.getItem('efl:competition-hub-subtab')||'';leagueId=sessionStorage.getItem('efl:preview-league')||undefined;cupId=sessionStorage.getItem('efl:active-cup-id')||undefined;leagueIntent=!!sessionStorage.getItem('efl:preview-league-tab')||sessionStorage.getItem('efl:preview-club-search')==='1';}catch{}
 let target:CompetitionTarget|null=null;
 if(saved==='leagues'||leagueIntent)target={kind:'league',leagueId};
 else if(saved==='cups')target={kind:'cup',competitionId:cupId};
 else if(saved==='european')target={kind:'european'};
 else if(initial==='season'||saved==='season')target={kind:'season'};
 const category:CompetitionCategory=['leagues','cups','european'].includes(initial)?initial as CompetitionCategory:'all';
 return {category,scope:initial==='custom'||saved==='custom'?'my' as const:'all' as const,target};
}

export function CompetitionHubView({onNavigateTab,initialSubTab='all'}:{onNavigateTab:(tab:any)=>void;initialSubTab?:LegacyTab}){
 const {user,activeSeasonId,ownedClubs=[]}=useAuth();
 const allowTeams=canSeeTeamPreview(user?.telegramId),scopeKey=`${user?.id||''}:${activeSeasonId}`;
 const [start]=useState(()=>initialNavigation(initialSubTab));
 const [category,setCategory]=useState<CompetitionCategory>(start.category),[scope,setScope]=useState<'all'|'my'>(start.scope),[target,setTarget]=useState<CompetitionTarget|null>(start.target);
 const [data,setData]=useState<HubData>(empty),[loading,setLoading]=useState(true),[errors,setErrors]=useState<string[]>([]),[search,setSearch]=useState(''),[state,setState]=useState<'ALL'|CompetitionState>('ALL'),[mode,setMode]=useState<'all'|'solo'|'team'>('all'),[filters,setFilters]=useState(false);
 const [creation,setCreation]=useState<'choose'|'solo'|'team'|null>(null),[busy,setBusy]=useState(false),[creationError,setCreationError]=useState(''),[ticketAdmin,setTicketAdmin]=useState(false);
 const sequence=useRef(0),lock=useRef(false),mounted=useRef(true),initialTab=useRef(initialSubTab);
 const current=data.scope===scopeKey?data:empty;
 const reload=async()=>{
  const request=++sequence.current;setLoading(true);
  const results=await Promise.allSettled([api.getLeagues(),api.getCompetitions(activeSeasonId,true),customTournamentApi.getPublicTournaments(100),customTournamentApi.getMyTournaments(),allowTeams?loadTeamPreview():Promise.resolve({teams:[] as PreviewTeam[],leagues:[] as TeamLeague[]})] as const);
  if(!mounted.current||request!==sequence.current)return;
  const problems:string[]=[];
  const value=<T,>(result:PromiseSettledResult<T>,fallback:T,label:string):T=>{if(result.status==='fulfilled')return result.value;problems.push(label);return fallback;};
  const leagues=value(results[0],{leagues:[]},'EFL ligalari yuklanmadi.');
  const competitions=value(results[1],{competitions:[]},'EFL musobaqalari yuklanmadi.');
  const publicTournaments=value(results[2],[],'Ochiq turnirlar yuklanmadi.');
  const myTournaments=value(results[3],[],'Mening turnirlarim yuklanmadi.');
  const teams=value(results[4],{teams:[],leagues:[]},'Jamoaviy test ma’lumotlari yuklanmadi.');
  setData({scope:scopeKey,leagues:leagues.leagues,competitions:competitions.competitions,publicTournaments,myTournaments,teams:teams.teams,teamLeagues:teams.leagues});setErrors(problems);setLoading(false);
 };
 useEffect(()=>{mounted.current=true;setCreation(null);if(!allowTeams)setMode('all');void reload();return()=>{mounted.current=false;sequence.current++;};},[user?.id,activeSeasonId,allowTeams]);
 useEffect(()=>{try{sessionStorage.removeItem('efl:competition-hub-subtab');}catch{}},[]);
 useEffect(()=>{if(initialTab.current===initialSubTab)return;initialTab.current=initialSubTab;const next=initialNavigation(initialSubTab);setCategory(next.category);setScope(next.scope);setTarget(next.target);try{sessionStorage.removeItem('efl:competition-hub-subtab');}catch{}},[initialSubTab]);
 const entries=buildCompetitionDirectory({...current,teamLeagues:current.teamLeagues,allowTeamPreview:allowTeams,ownedLeagueIds:ownedClubs.map(c=>c.leagueId)});
 const visible=filterCompetitionDirectory(entries,{category,scope,search,state,mode});
 const back=()=>{setTarget(null);void reload();};
 const create=()=>{setCreationError('');setCreation(allowTeams?'choose':'solo');};
 const createTeam=async(body:unknown)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setCreationError('');
  try{const team=await teamPreviewRequest<PreviewTeam>('/teams',body);if(mounted.current)setData(d=>({...d,teams:[...d.teams.filter(t=>t.id!==team.id),team]}));return team;}catch(e:any){setCreationError(e.message);return undefined;}finally{lock.current=false;setBusy(false);}
 };
 const createTeamTournament=async(body:unknown)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setCreationError('');
  try{const league=await teamPreviewRequest<TeamLeague>('/leagues',body);setCreation(null);setTarget({kind:'team',tournamentId:league.id});void reload();}catch(e:any){setCreationError(e.message);}finally{lock.current=false;setBusy(false);}
 };
 let content:React.ReactNode;
 if(target?.kind==='custom')content=<TournamentDetailView key={target.tournamentId} tournamentId={target.tournamentId} inviteToken={target.token} onBack={back}/>;
 else if(target?.kind==='team'&&allowTeams)content=<TeamLeaguePreviewView key={target.tournamentId} initialTournamentId={target.tournamentId} embedded onBack={back}/>;
 else if(target?.kind==='teams'&&allowTeams)content=<TeamLeaguePreviewView teamsOnly embedded onBack={back}/>;
 else if(target?.kind==='league'||target?.kind==='cup'||target?.kind==='european'||target?.kind==='season')content=<><button className="tourney-button justify-self-start" onClick={back}><ArrowLeft size={16}/>Turnirlar</button>{target.kind==='league'?<ClubsView key={target.leagueId||'league'} initialLeagueId={target.leagueId} onNavigateTab={onNavigateTab}/>:target.kind==='cup'?<CupBracketsView key={target.competitionId||'cup'} initialCompetitionId={target.competitionId} onNavigateTab={onNavigateTab}/>:target.kind==='european'?<ChampionsLeagueView key={target.competitionId||'european'} initialCompetitionId={target.competitionId} onNavigateTab={onNavigateTab}/>:<SeasonHubView onNavigateTab={onNavigateTab}/>}</>;
 else content=<CompetitionDirectoryView entries={visible} category={category} scope={scope} search={search} state={state} mode={mode} showFilters={filters} loading={loading} errors={errors} allowTeams={allowTeams} onCategory={setCategory} onScope={setScope} onSearch={setSearch} onState={setState} onMode={setMode} onFilters={()=>setFilters(!filters)} onOpen={e=>setTarget(e.target)} onCreate={create} onTeams={()=>setTarget({kind:'teams'})} onSeason={()=>setTarget({kind:'season'})} onRefresh={()=>void reload()}/>;
 return <div className="efl-competition-workspace space-y-4 pb-20 animate-in fade-in duration-200">{content}
  {creation==='choose'&&allowTeams&&<TeamCompetitionDialog title="Turnir yaratish" onClose={()=>setCreation(null)}><p className="tourney-muted">O‘yin turini tanlang. Keyingi bosqichda liga yoki kubok formatini belgilaysiz.</p><div className="tourney-choice-grid"><button className="tourney-choice" onClick={()=>setCreation('solo')}><UserRound size={22}/><span><strong>Yakka</strong><p>Har qatnashchi bitta klub nomidan o‘ynaydi.</p></span></button><button className="tourney-choice" disabled={loading} onClick={()=>setCreation('team')}><Users size={22}/><span><strong>Jamoaviy</strong><p>Teamlar, sardorlar, tarkiblar va zaxira. Faqat sizga ochiq test.</p></span></button></div><button className="tourney-button justify-self-start" onClick={()=>{setCreation(null);setTicketAdmin(true);}}><Ticket size={14}/>Ticket boshqaruvi</button></TeamCompetitionDialog>}
  <TournamentWizardModal isOpen={creation==='solo'} onClose={()=>setCreation(null)} onTournamentCreated={id=>{setCreation(null);setTarget({kind:'custom',tournamentId:id});void reload();}}/>
  {creation==='team'&&allowTeams&&<TeamCompetitionDialog title="Jamoaviy turnir yaratish" onClose={()=>{if(!busy)setCreation(null);}}>{creationError&&<p className="tourney-note error" role="alert">{creationError}</p>}<TeamTournamentSetup teams={current.teams} busy={busy} save={body=>void createTeamTournament(body)} createTeam={createTeam}/></TeamCompetitionDialog>}
  {allowTeams&&ticketAdmin&&<AdminTicketManagementModal isOpen onClose={()=>setTicketAdmin(false)}/>}
 </div>;
}
