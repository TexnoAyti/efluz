import {UzeflifeHistory} from './UzeflifeHistory';
import React,{useState} from 'react';
import {ArrowLeft,CalendarDays,Users,Trophy,Shield,RefreshCw,History} from 'lucide-react';
import {CompetitionBanner,CompetitionHeading,CompetitionTabs} from '../CompetitionChrome';
import {CompetitionFixtureCard,CompetitionRounds,CompetitionStandings,type StandingsView} from '../CompetitionContent';
import {uLeagueStandings,uMatchFinished} from '../../lib/uzeflifeLeague';
import {readUzeflifeLaunch} from '../../lib/uzeflifeLinks';
import {U_STATUS,type UChannel} from '../../types/uzeflife';
import type {UViewState} from '../../lib/uzeflifeApi';
import {UzeflifeAdmin,type UAct} from './UzeflifeAdmin';
import {UzeflifeMatchDialog} from './UzeflifeMatchDialog';
import {UzeflifeRoster} from './UzeflifeRoster';
import {UzeflifeImageExport} from './UzeflifeImageExport';
type Tab='fixtures'|'standings'|'roster'|'history';
export function UzeflifeLeagueChampionship({state:s,userId,busy,error,notice,missing,act,onRefresh,initialAdmin,seasonId}:{state:UViewState;userId?:string;busy:boolean;error:string;notice:string;missing:UChannel[];act:UAct;onRefresh:()=>void;initialAdmin:boolean;seasonId:string}){
 const [tab,setTab]=useState<Tab>('fixtures'),[admin,setAdmin]=useState(initialAdmin),[round,setRound]=useState(s.round||1),[selected,setSelected]=useState(readUzeflifeLaunch),[page,setPage]=useState(0),[tablePage,setTablePage]=useState(0),[view,setView]=useState<StandingsView>('short'),[mineOnly,setMineOnly]=useState(false);
 const names=new Map(s.participants.map(p=>[p.id,p.name])),roster=new Map(s.roster?.filter(r=>r.userId).map(r=>[r.userId!,r]));
 const slotLabel=(id:string|null)=>{const r=roster.get(id||'');return r?`${r.group}-setka · ${r.slot}-o‘rin`:'';};
 const games=s.matches.filter(m=>m.round===round&&(!mineOnly||[m.home,m.away].includes(userId||''))),pages=Math.max(1,Math.ceil(games.length/8)),current=Math.min(page,pages-1);
 const standings=uLeagueStandings(s),active=s.matches.find(m=>m.id===selected),mine=s.participants.find(p=>p.id===userId),count=s.roster?.filter(r=>r.username).length||0;
 const subscriptionNotice=missing.length?<div className="competition-note"><p>Barcha majburiy kanallarga obuna bo‘ling.</p>{missing.map(c=><a key={c.id} className="competition-button" href={c.url} target="_blank" rel="noreferrer">{c.title}</a>)}<button className="competition-button" disabled={busy} onClick={()=>void act('subscription-check')}>Obunani tekshirish</button></div>:null;
 return <div className="competition-page uzeflife u-league-page">
 {admin?<UzeflifeAdmin state={s} busy={busy} act={act} error={error} onRefresh={onRefresh} onBack={()=>setAdmin(false)} onMatches={()=>{setAdmin(false);setTab('fixtures');setRound(s.round||1);}}/>:<>
 <CompetitionBanner><CompetitionHeading emblem={<Trophy size={30}/>} eyebrow="UZEFLIFE · UMUMIY LIGA" title="UZEFLIFE" meta={<><span>15 tur</span><span>{count} username</span><span>{U_STATUS[s.status]}</span></>}/><div className="u-banner-actions">{s.permissions.length>0&&<button className="competition-button" onClick={()=>setAdmin(true)}><Shield size={16}/>Liga boshqaruvi</button>}<button className="competition-button" disabled={busy} onClick={onRefresh}><RefreshCw size={16}/>Yangilash</button></div></CompetitionBanner>
 <CompetitionTabs<Tab> value={tab} onChange={setTab} label="UZEFLIFE liga bo‘limlari" items={[{id:'fixtures',label:'O‘yinlar',icon:CalendarDays},{id:'standings',label:'Jadval',icon:Trophy},{id:'roster',label:'Setkalar ro‘yxati',icon:Users},{id:'history',label:'Tarix',icon:History}]}/>
 {(error||notice)&&<p role={error?'alert':'status'} className={`competition-note ${error?'error':''}`}>{error||notice}</p>}
 {subscriptionNotice}
 {s.status==='registration'&&<section className="competition-panel"><h3>Ro‘yxatdagi akkauntingizni ulang</h3><p className="competition-muted">@username’ingiz asl ro‘yxatda bo‘lishi kerak. Ulangan o‘yinchi raqib bildirishnomalarini botda oladi va hisob kiritishi mumkin.</p><button className="competition-button primary" disabled={busy||!userId||mine?.status==='approved'} onClick={()=>void act('register')}>{mine?.status==='approved'?'Akkaunt ulangan':'Ro‘yxatdagi o‘rnimni ulash'}</button><p className="competition-muted">{s.participants.filter(p=>p.status==='approved').length}/{count} akkaunt ulangan</p></section>}
 {tab==='history'&&<UzeflifeHistory state={s}/>}
 {tab==='roster'&&<UzeflifeRoster state={s}/>}
 {tab==='fixtures'&&<><CompetitionRounds items={Array.from({length:15},(_,i)=>({id:i+1,label:`${i+1}-TUR`}))} value={round} onChange={r=>{setRound(r);setPage(0);}}/><div className="competition-actions"><button className="competition-button" aria-pressed={mineOnly} disabled={!userId} onClick={()=>{setMineOnly(!mineOnly);setPage(0);}}>{mineOnly?'Barcha o‘yinlar':'Mening o‘yinlarim'}</button><button className="competition-button" onClick={()=>{setRound(s.round||1);setPage(0);}}>Joriy tur</button><span className="competition-muted">{round}-tur · {games.length} o‘yin</span></div>
 <div className="competition-fixture-grid">{games.slice(current*8,(current+1)*8).map(m=><CompetitionFixtureCard key={m.id} caption={`${m.round}-tur`} status={uMatchFinished(m)?'Yakunlangan':m.proposal?'Tasdiq kutilmoqda':m.round>s.round?'Tur yopiq':'Kutilmoqda'} statusTone={uMatchFinished(m)?'success':'neutral'} highlighted={[m.home,m.away].includes(userId||'')} onClick={()=>setSelected(m.id)} home={<span><b>{names.get(m.home!)}</b><small className="block">{slotLabel(m.home)}</small></span>} away={<span><b>{names.get(m.away!)}</b><small className="block">{slotLabel(m.away)}</small></span>} score={<strong>{m.homeScore??'—'} : {m.awayScore??'—'}</strong>}/>)}</div>
 {!games.length&&<p className="competition-empty">{s.matches.length?'Bu turda sizga tegishli o‘yin yo‘q.':'Akkauntlar ulangach administrator 15 turlik taqvimni ochadi. Pley-off bo‘lmaydi.'}</p>}{pages>1&&<div className="competition-actions"><button className="competition-button" disabled={!current} onClick={()=>setPage(current-1)}>Oldingi</button><span>{current+1}/{pages}</span><button className="competition-button" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Keyingi</button></div>}{games.length>0&&<UzeflifeImageExport state={s} matches={games.slice(current*8,(current+1)*8)} seasonId={seasonId}/>}</>}
 {tab==='standings'&&<><CompetitionStandings title="UZEFLIFE · 15 turlik umumiy liga" clubLabel="O‘yinchi" view={view} onViewChange={setView} note="G‘alaba 3, durang 1, mag‘lubiyat 0 ochko. Tartib: ochko, to‘plar farqi, urilgan gollar, asl ro‘yxatdagi o‘rin." rows={standings.slice(tablePage*20,(tablePage+1)*20).map(r=>({...r,identity:<span><b>{r.name}</b><small className="block">{slotLabel(r.id)}</small></span>,highlighted:r.id===userId}))}/>{standings.length>20&&<div className="competition-actions"><button className="competition-button" disabled={!tablePage} onClick={()=>setTablePage(tablePage-1)}>Oldingi</button><span>{tablePage+1}/{Math.ceil(standings.length/20)}</span><button className="competition-button" disabled={(tablePage+1)*20>=standings.length} onClick={()=>setTablePage(tablePage+1)}>Keyingi</button></div>}</>}
 </>}
 {active&&<UzeflifeMatchDialog key={active.id} match={active} state={s} userId={userId} busy={busy} error={error} subscriptionNotice={subscriptionNotice} act={act} onClose={()=>setSelected(null)}/>}
 </div>;
}
