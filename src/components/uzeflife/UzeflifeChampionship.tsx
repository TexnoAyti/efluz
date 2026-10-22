import React,{useState} from 'react';
import {Trophy,Users,CalendarDays,GitBranch,Info,Shield,ClipboardList,RefreshCw,ChevronRight,CheckCircle2,Clock,ArrowLeft} from 'lucide-react';
import {CompetitionBanner,CompetitionTabs,CompetitionHeading} from '../CompetitionChrome';
import {CompetitionFixtureCard,CompetitionStandings,type StandingsView} from '../CompetitionContent';
import {CompetitionToolbar} from '../CompetitionWorkspace';
import {U_STATUS,type UChannel,type UMatch} from '../../types/uzeflife';
import type {UViewState} from '../../lib/uzeflifeApi';
import {uDisplayMatches,uRoundLabel,uSourceLabel,U_QUALIFIER_ROUNDS,U_FINAL_ROUNDS} from '../../lib/uzeflifePresentation';
import {UzeflifeBracket} from './UzeflifeBracket';
import {UzeflifeAdmin,type UAct} from './UzeflifeAdmin';
import {UzeflifeMatchDialog} from './UzeflifeMatchDialog';

type Tab='overview'|'fixtures'|'bracket'|'participants'|'results'|'standings';
export function UzeflifeChampionship({state:s,userId,busy,error,notice,missing,act,onRefresh,initialTab='overview',initialAdmin=false}:{state:UViewState;userId?:string;busy:boolean;error:string;notice:string;missing:UChannel[];act:UAct;onRefresh:()=>void;initialTab?:Tab;initialAdmin?:boolean}) {
  const [tab,setTab]=useState<Tab>(initialTab),[admin,setAdmin]=useState(initialAdmin);
  const [bracket,setBracket]=useState(s.round>5?0:1),[round,setRound]=useState(0),[group,setGroup]=useState('all');
  const [standingsView,setStandingsView]=useState<StandingsView>('short');
  const [participantPage,setParticipantPage]=useState(0),[standingsPage,setStandingsPage]=useState(0);
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState<UMatch|null>(null);
  const approved=s.participants.filter(p=>p.status==='approved');
  const mine=s.participants.find(p=>p.id===userId);
  const champion=s.matches.find(m=>m.round===8)?.winner;
  const name=(id:string|null)=>s.participants.find(p=>p.id===id)?.name||'Aniqlanmagan';
  const winnerOf=(id:number)=>s.matches.find(m=>m.bracket===id&&m.round===5)?.winner;
  const myNext=s.matches.find(m=>[m.home,m.away].includes(userId||'')&&!m.winner&&m.home&&m.away&&m.round===s.round);
  const openMatch=(m:UMatch)=>setSelected(m);
  const navigate=(next:Tab)=>{setTab(next);setPage(0);};
  const subscriptionChannels=missing.length?missing:s.subscriptionsEnabled&&s.status==='registration'&&!mine?s.channels:[];
  const subscriptionNotice=subscriptionChannels.length>0?<div className="competition-note space-y-3"><p>Ishtirok etish uchun quyidagi kanallarga obuna bo‘ling.</p><div className="competition-actions">{subscriptionChannels.map(c=><a key={c.id} className="competition-button" href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>)}</div><button className="competition-button" disabled={busy} onClick={()=>void act('subscription-check')}>✅ Obunani tekshirish</button></div>:null;
  const matchCard=(m:UMatch)=><CompetitionFixtureCard key={m.id}
    onClick={()=>openMatch(m)} highlighted={[m.home,m.away].includes(userId||'')}
    className="u-league-match"
    caption={`${m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · ${uRoundLabel(m.round)}`}
    status={m.winner?'Yakunlandi':m.proposal?'Tasdiq kutilmoqda':'Kutilmoqda'}
    statusTone={m.winner?'success':m.proposal?'warning':'neutral'}
    home={<span className="u-match-identity" title={m.home?name(m.home):uSourceLabel(m,'home')}>{m.home?name(m.home):uSourceLabel(m,'home')}</span>}
    away={<span className="u-match-identity" title={m.away?name(m.away):uSourceLabel(m,'away')}>{m.away?name(m.away):uSourceLabel(m,'away')}</span>}
    score={<>{m.homeScore??'–'} : {m.awayScore??'–'}</>}
  >
    {m.penaltyHome!==null&&<p className="text-center text-[10px] text-[var(--efl-text-2)]">Penaltilar {m.penaltyHome} : {m.penaltyAway}</p>}
    <div className="u-match-footer"><span>{m.scheduledAt?new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Vaqti belgilanmagan'}</span><span>Tafsilotlar <ChevronRight size={12}/></span></div>
  </CompetitionFixtureCard>;
  const tabs:{id:Tab;label:string;icon:typeof Trophy}[]=[{id:'overview',label:'Turnir',icon:Info},{id:'fixtures',label:'O‘yinlar',icon:CalendarDays},{id:'bracket',label:'Pley-off',icon:GitBranch},{id:'participants',label:'O‘yinchilar',icon:Users},{id:'results',label:'Natijalar',icon:Trophy},{id:'standings',label:'Jadval',icon:ClipboardList}];
  const selectedRound=round||s.round||1;
  const filteredMatches=s.matches.filter(m=>m.round===selectedRound&&(group==='all'||m.bracket===Number(group))&&(tab!=='results'||!!m.winner));
  const participants=s.participants.filter(p=>p.status==='approved'||p.status==='removed'&&s.matches.some(m=>m.home===p.id||m.away===p.id));
  const visibleParticipants=approved.filter(p=>p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pp=Math.min(participantPage,Math.max(0,Math.ceil(visibleParticipants.length/20)-1));
  const sp=Math.min(standingsPage,Math.max(0,Math.ceil(participants.length/20)-1));
  const pagination=(current:number,total:number,set:(page:number)=>void)=>total>20?<nav className="u-page-controls" aria-label="Ro‘yxat sahifalari"><button className="competition-button" disabled={current===0} onClick={()=>set(current-1)}>Oldingi</button><span>{current+1} / {Math.ceil(total/20)}</span><button className="competition-button" disabled={(current+1)*20>=total} onClick={()=>set(current+1)}>Keyingi</button></nav>:null;
  const participantState=(id:string)=>champion===id?'Chempion':s.matches.some(m=>m.winner&&m.winner!==id&&[m.home,m.away].includes(id))||s.participants.find(p=>p.id===id)?.status==='removed'?'Musobaqani tark etgan':'Ishtirok etmoqda';
  const activeMatch=selected?(s.matches.find(m=>m.id===selected.id)||selected):null;
  return <div className="competition-page uzeflife">
    {admin&&s.permissions.length>0?<>
      {(error||notice)&&<p role={error?'alert':'status'} className={`competition-note ${error?'error':''}`}>{error||notice}</p>}
      <UzeflifeAdmin state={s} busy={busy} act={act} onBack={()=>setAdmin(false)} onMatches={()=>{setAdmin(false);navigate('fixtures');}}/>
    </>:<>
      <CompetitionBanner>
        <CompetitionHeading emblem={<Trophy className="w-10 h-10 text-[var(--efl-primary)]"/>} title="UZEFLIFE"
          eyebrow={<><span className="text-xs font-bold text-[var(--efl-text-2)] uppercase tracking-wider">EFLUZ chempionati</span><span className="u-status">{U_STATUS[s.status]}</span></>}
          meta={<><span className="flex items-center gap-1 font-semibold"><Users size={14}/>{approved.length}/256 ishtirokchi</span><span>•</span><span>{s.round?uRoundLabel(s.round):'8 ta saralash setkasi'}</span></>}/>
        <div className="u-banner-actions">
          {s.permissions.length>0&&<button className="competition-button" onClick={()=>setAdmin(true)}><Shield size={15}/><strong>Turnir admin paneli</strong><ChevronRight size={14}/></button>}
          <button className="competition-button" disabled={busy} aria-label="Turnirni yangilash" onClick={onRefresh}><RefreshCw size={14} className={busy?'animate-spin':''}/>Yangilash</button>
        </div>
      </CompetitionBanner>
      <CompetitionTabs<Tab> items={tabs} value={tab} onChange={navigate} label="UZEFLIFE turniri" layout="grid"/>
      {(error||notice)&&<p role={error?'alert':'status'} className={`competition-note ${error?'error':''}`}>{error||notice}</p>}
      {tab==='overview'&&<>
        {champion&&<div className="competition-panel u-registration"><div className="flex gap-3 items-center"><Trophy size={26}/><div><h3>UZEFLIFE chempioni</h3><p>{name(champion)}</p></div></div><button className="competition-button" onClick={()=>navigate('results')}>Final natijasi</button></div>}
        {(!s.matches.length||mine?.status==='pending')&&<section className="competition-panel u-registration-panel" aria-label="Ro‘yxatdan o‘tish">
          <div className="u-registration"><div><h3>{mine?.status==='approved'?'Siz UZEFLIFE ishtirokchisisiz':mine?.status==='pending'?'Arizangiz qabul qilindi':'UZEFLIFE’da ishtirok eting'}</h3><p>{mine?.status==='approved'?'Raqib va o‘yin vaqti jadvalda ko‘rinadi.':mine?.status==='pending'?'Administrator tasdig‘ini kuting.':s.status==='registration'?'256 o‘rin uchun ro‘yxatdan o‘tish ochiq.':s.status==='draft'?'Ro‘yxatdan o‘tish boshlanishi shu yerda e’lon qilinadi.':'Turnir boshlangan. O‘yinlar va natijalarni kuzating.'}</p></div>{mine?.status==='approved'?<CheckCircle2 size={23} className="text-[var(--efl-primary)]"/>:mine?.status==='pending'?<Clock size={23}/>:s.status==='registration'&&<button className="competition-button primary" disabled={busy||!userId||approved.length>=256} onClick={()=>void act('register')}>Ro‘yxatdan o‘tish</button>}</div>
          {!s.matches.length&&<><div className="u-progress"><span style={{width:`${approved.length/256*100}%`}}/></div><p className="text-[10px] competition-muted">{approved.length} ishtirokchi tasdiqlangan · {256-approved.length} o‘rin</p></>}
          {subscriptionNotice&&<div className="mt-3">{subscriptionNotice}</div>}
        </section>}
        {myNext&&<section><div className="u-section-heading"><h3>Sizning o‘yiningiz</h3></div>{matchCard(myNext)}</section>}
        <section><div className="u-section-heading"><div><h3>Saralash setkalari</h3><p>Har bir setkadan bittadan g‘olib final bosqichiga chiqadi.</p></div><span className="u-status">256 → 8</span></div><div className="u-bracket-grid">{Array.from({length:8},(_,i)=>{
          const id=i+1,winner=winnerOf(id),finished=s.matches.filter(m=>m.bracket===id&&m.winner).length;
          return <button className="competition-panel u-bracket-entry" key={id} onClick={()=>{setBracket(id);navigate('bracket');}}><span className="u-entry-title"><GitBranch size={18}/><strong>{id}-setka</strong><ChevronRight size={15}/></span><span>{winner?name(winner):'32 ishtirokchi'}</span><span className="u-entry-footer">{winner?'Final bosqichiga chiqdi':s.matches.length?`${finished}/31 yakunlangan`:'1/16 final → Final'}</span></button>;
        })}</div><button className="competition-panel u-final-entry" onClick={()=>{setBracket(0);navigate('bracket');}}><Trophy size={23}/><span className="flex-1"><strong>Final bosqichi</strong><small>8 g‘olib · Chorak final → Yarim final → Final</small></span><ChevronRight size={18}/></button></section>
        {s.announcements.length>0&&<section className="competition-panel"><h3>Turnir e’lonlari</h3>{s.announcements.map(a=><article key={a.id} className="u-announce"><p className="text-xs whitespace-pre-wrap">{a.text}</p><time>{new Date(a.at).toLocaleDateString('uz-UZ',{timeZone:'Asia/Tashkent'})}</time></article>)}</section>}
        <details className="competition-panel"><summary className="text-xs font-bold cursor-pointer">Turnir haqida</summary><div className="space-y-3 mt-3 text-xs competition-muted"><p>{s.description}</p><p>32 ishtirokchilik 8 setkada beshtadan pley-off bosqichi o‘ynaladi. Har bir setka g‘olibi final bosqichiga chiqadi. Final bosqichida chorak final, yarim final va final bor.</p><p>Chempionlik uchun 8 ta g‘alaba kerak. Durang natijada g‘olib penaltilar orqali aniqlanadi.</p></div></details>
      </>}
      {tab==='bracket'&&<><div className="u-bracket-picker"><label className="competition-field">Saralash setkasi<select aria-label="UZEFLIFE setkasini tanlash" value={bracket} onChange={e=>setBracket(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i+1} value={i+1}>{i+1}-setka · 32 ishtirokchi</option>)}<option value={0}>Final bosqichi · 8 g‘olib</option></select></label>{bracket!==0&&<button className="competition-button" onClick={()=>setBracket(0)}><Trophy size={14}/>Final bosqichi</button>}</div><UzeflifeBracket state={s} bracket={bracket} onMatch={openMatch}/>{!s.matches.length&&<p className="competition-muted">Turnir yo‘li belgilangan. Qur’adan so‘ng ishtirokchilar o‘z joylarida ko‘rinadi.</p>}</>}
      {(tab==='fixtures'||tab==='results')&&<>
        {!s.matches.length?<div className="u-empty"><CalendarDays size={25}/><h3>{tab==='results'?'Natijalar hali yo‘q':'Raqiblar qur’ada aniqlanadi'}</h3><p>{tab==='results'?'Tasdiqlangan hisoblar shu yerda ko‘rinadi.':'Ro‘yxatdan o‘tish yakunlangach o‘yinlar va vaqtlari shu yerda chiqadi.'}</p><button className="competition-button mt-4" onClick={()=>navigate('bracket')}>Turnir setkasini ko‘rish</button></div>:<>
          <h3>{tab==='results'?'Natijalar':'O‘yinlar jadvali'}</h3>
          <div className="u-fixture-filters">
            <label className="competition-field">Setka<select aria-label="O‘yinlar setkasi" value={group} onChange={e=>{setGroup(e.target.value);setRound(e.target.value==='0'?6:1);setPage(0);}}><option value="all">Barcha setkalar</option>{Array.from({length:8},(_,i)=><option key={i+1} value={i+1}>{i+1}-setka</option>)}<option value="0">Final bosqichi</option></select></label>
            <label className="competition-field">Bosqich<select aria-label="O‘yinlar bosqichi" value={selectedRound} onChange={e=>{setRound(Number(e.target.value));setPage(0);}}>{Array.from({length:8},(_,i)=>i+1).filter(r=>group==='all'||(group==='0'?r>=6:r<=5)).map(r=><option key={r} value={r}>{r<=5?`Saralash: ${U_QUALIFIER_ROUNDS[r-1]}`:`Final bosqichi: ${U_FINAL_ROUNDS[r-6]}`}</option>)}</select></label>
          </div>
          {filteredMatches.length?<><div className="competition-fixture-grid u-match-list">{filteredMatches.slice(page*8,(page+1)*8).map(matchCard)}</div>{filteredMatches.length>8&&<div className="flex items-center justify-between text-xs"><button className="competition-button" disabled={!page} onClick={()=>setPage(page-1)}>Oldingi</button><span>{page+1} / {Math.ceil(filteredMatches.length/8)}</span><button className="competition-button" disabled={(page+1)*8>=filteredMatches.length} onClick={()=>setPage(page+1)}>Keyingi</button></div>}</>:<p className="u-empty">{tab==='results'?'Bu bosqichda hali tasdiqlangan natija yo‘q.':'Bu bosqichda o‘yin yo‘q.'}</p>}
        </>}
        {missing.length>0&&subscriptionNotice}
      </>}
      {tab==='participants'&&<><div className="u-section-heading"><h3>Ishtirokchilar</h3><span className="u-status">{approved.length} / 256</span></div>{approved.length>0&&<CompetitionToolbar value={search} onChange={v=>{setSearch(v);setParticipantPage(0);}} label="UZEFLIFE ishtirokchisini qidirish" placeholder="Ishtirokchi ismi"/>}<div className="competition-panel u-participant-list">{approved.length?visibleParticipants.slice(pp*20,(pp+1)*20).map((p,i)=><div className="u-participant" key={p.id}><span>{pp*20+i+1}</span><strong>{p.name}{p.id===userId?' · Siz':''}</strong><small>{s.matches.length?participantState(p.id):'Tasdiqlangan'}</small></div>):<div className="u-empty"><Users size={25}/><h3>Ishtirokchilar kutilmoqda</h3><p>Tasdiqlangan ishtirokchilar shu yerda ko‘rinadi.</p></div>}{approved.length>0&&visibleParticipants.length===0&&<p className="competition-empty">Nomi bo‘yicha ishtirokchi topilmadi.</p>}</div>{pagination(pp,visibleParticipants.length,setParticipantPage)}</>}
      {tab==='standings'&&<><CompetitionStandings title="UZEFLIFE · Turnir jadvali" clubLabel="Ishtirokchi" view={standingsView} onViewChange={setStandingsView}
        labels={{played:'O‘',won:'G‘',drawn:'D',lost:'M',difference:'TF',points:'G‘alaba',form:'Forma',short:'Qisqa',full:'To‘liq',view:'Jadval ko‘rinishi',win:'G‘alaba',draw:'Durang',loss:'Mag‘lubiyat',empty:'Natija yo‘q'}}
        note="Pley-off jadvali g‘alabalar bo‘yicha tartiblanadi. Durang o‘yinda g‘olib penaltilar orqali aniqlanadi."
        rows={[...participants].map(p=>{
          const games=s.matches.filter(m=>m.winner&&[m.home,m.away].includes(p.id));
          const won=games.filter(m=>m.winner===p.id).length;
          const gf=games.reduce((n,m)=>n+(m.home===p.id?m.homeScore??0:m.awayScore??0),0);
          const ga=games.reduce((n,m)=>n+(m.home===p.id?m.awayScore??0:m.homeScore??0),0);
          return {id:p.id,position:0,identity:<div className="u-standing-identity"><strong title={p.name}>{p.name}</strong><small>{s.matches.length?participantState(p.id):'Turnir kutilmoqda'}</small></div>,played:games.length,won,drawn:0,lost:games.length-won,goalsFor:gf,goalsAgainst:ga,goalDifference:gf-ga,points:won,form:games.map(m=>m.winner===p.id?'W':'L'),highlighted:p.id===userId};
        }).sort((a,b)=>b.won-a.won).map((p,i)=>({...p,position:i+1})).slice(sp*20,(sp+1)*20)}/>{pagination(sp,participants.length,setStandingsPage)}</>}
    </>}
    {activeMatch&&<UzeflifeMatchDialog key={activeMatch.id} match={activeMatch} state={s} userId={userId} busy={busy} error={error} subscriptionNotice={missing.length?subscriptionNotice:null} act={act} onClose={()=>setSelected(null)}/>}
  </div>;
}
