import React,{useState} from 'react';
import {Trophy,Users,CalendarDays,GitBranch,Info,Shield,ClipboardList,RefreshCw,ChevronRight,CheckCircle2,Clock,ArrowLeft} from 'lucide-react';
import {CompetitionBanner,CompetitionTabs} from '../CompetitionChrome';
import {CompetitionToolbar} from '../CompetitionWorkspace';
import {U_STATUS,type UChannel,type UMatch} from '../../types/uzeflife';
import type {UViewState} from '../../lib/uzeflifeApi';
import {uDisplayMatches,uRoundLabel,uSourceLabel,U_QUALIFIER_ROUNDS,U_FINAL_ROUNDS} from '../../lib/uzeflifePresentation';
import {UzeflifeBracket} from './UzeflifeBracket';
import {UzeflifeAdmin,type UAct} from './UzeflifeAdmin';
import {UzeflifeMatchDialog} from './UzeflifeMatchDialog';

type Tab='overview'|'fixtures'|'bracket'|'participants'|'results'|'standings';
export function UzeflifeChampionship({state:s,userId,busy,error,notice,missing,act,onRefresh,initialTab='overview'}:{state:UViewState;userId?:string;busy:boolean;error:string;notice:string;missing:UChannel[];act:UAct;onRefresh:()=>void;initialTab?:Tab}) {
  const [tab,setTab]=useState<Tab>(initialTab),[admin,setAdmin]=useState(false);
  const [bracket,setBracket]=useState(s.round>5?0:1),[round,setRound]=useState(0),[group,setGroup]=useState('all');
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
  const subscriptionNotice=subscriptionChannels.length>0?<div className="tourney-note space-y-3"><p>Ishtirok etish uchun quyidagi kanallarga obuna bo‘ling.</p><div className="tourney-action-row">{subscriptionChannels.map(c=><a key={c.id} className="tourney-button" href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>)}</div><button className="tourney-button" disabled={busy} onClick={()=>void act('subscription-check')}>✅ Obunani tekshirish</button></div>:null;
  const matchCard=(m:UMatch)=><button type="button" key={m.id} className={`u-match-card ${[m.home,m.away].includes(userId||'')?'is-mine':''}`} onClick={()=>openMatch(m)}>
    <span className="u-match-meta"><span>{m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · {uRoundLabel(m.round)}</span><span>{m.winner?'Yakunlandi':m.proposal?'Tasdiq kutilmoqda':m.scheduledAt?new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Vaqti belgilanmagan'}</span></span>
    <span className="u-match-teams"><span>{m.home?name(m.home):uSourceLabel(m,'home')}</span><strong className="u-match-score">{m.homeScore??'–'} : {m.awayScore??'–'}</strong><span>{m.away?name(m.away):uSourceLabel(m,'away')}</span></span>
    {m.penaltyHome!==null&&<span className="block text-center text-[10px] mt-1 tourney-muted">Penaltilar {m.penaltyHome} : {m.penaltyAway}</span>}
  </button>;
  const tabs:{id:Tab;label:string;icon:typeof Trophy}[]=[{id:'overview',label:'Turnir',icon:Info},{id:'fixtures',label:'O‘yinlar',icon:CalendarDays},{id:'bracket',label:'Pley-off',icon:GitBranch},{id:'participants',label:'Ishtirokchilar',icon:Users},{id:'results',label:'Natijalar',icon:Trophy},{id:'standings',label:'Jadval',icon:ClipboardList}];
  const selectedRound=round||s.round||1;
  const filteredMatches=s.matches.filter(m=>m.round===selectedRound&&(group==='all'||m.bracket===Number(group))&&(tab!=='results'||!!m.winner));
  const participants=s.participants.filter(p=>p.status==='approved'||p.status==='removed'&&s.matches.some(m=>m.home===p.id||m.away===p.id));
  const participantState=(id:string)=>champion===id?'Chempion':s.matches.some(m=>m.winner&&m.winner!==id&&[m.home,m.away].includes(id))||s.participants.find(p=>p.id===id)?.status==='removed'?'Musobaqani tark etgan':'Ishtirok etmoqda';
  const activeMatch=selected?(s.matches.find(m=>m.id===selected.id)||selected):null;
  return <div className="efl-custom-tournaments tourney-page uzeflife">
    {admin&&s.permissions.length>0?<>
      {(error||notice)&&<p role={error?'alert':'status'} className={`tourney-note ${error?'error':''}`}>{error||notice}</p>}
      <UzeflifeAdmin state={s} busy={busy} act={act} onBack={()=>setAdmin(false)} onMatches={()=>{setAdmin(false);navigate('fixtures');}}/>
    </>:<>
      <CompetitionBanner>
        <div className="u-hero-top"><span className="u-emblem"><Trophy size={27}/></span><div className="u-hero-name"><h2>UZEFLIFE</h2><p>EFLUZ chempionati</p><span className="u-status mt-2"><i className="u-status-dot"/>{U_STATUS[s.status]}</span></div><div className="u-tools"><button className="tourney-button" disabled={busy} aria-label="Turnirni yangilash" onClick={onRefresh}><RefreshCw size={15} className={busy?'animate-spin':''}/></button>{s.permissions.length>0&&<button className="tourney-button" onClick={()=>setAdmin(true)} aria-label="Turnir boshqaruvi"><Shield size={15}/></button>}</div></div>
        <div className="u-stat-row"><div><strong>{approved.length}<small className="text-xs font-normal tourney-muted"> / 256</small></strong><span>Ishtirokchi</span></div><div><strong>8 × 32</strong><span>Saralash setkalari</span></div><div><strong>{s.round?uRoundLabel(s.round):'8 g‘olib'}</strong><span>{s.round?(s.round<=5?'Saralash bosqichi':'Final bosqichi'):'Final bosqichida'}</span></div></div>
      </CompetitionBanner>
      <CompetitionTabs<Tab> items={tabs} value={tab} onChange={navigate} label="UZEFLIFE turniri"/>
      {(error||notice)&&<p role={error?'alert':'status'} className={`tourney-note ${error?'error':''}`}>{error||notice}</p>}
      {tab==='overview'&&<>
        {champion&&<div className="tourney-surface u-registration"><div className="flex gap-3 items-center"><Trophy size={26}/><div><h3>UZEFLIFE chempioni</h3><p>{name(champion)}</p></div></div><button className="tourney-button" onClick={()=>navigate('results')}>Final natijasi</button></div>}
        <section className="tourney-surface" aria-label="Ro‘yxatdan o‘tish">
          <div className="u-registration"><div><h3>{mine?.status==='approved'?'Siz UZEFLIFE ishtirokchisisiz':mine?.status==='pending'?'Arizangiz qabul qilindi':'UZEFLIFE’da ishtirok eting'}</h3><p>{mine?.status==='approved'?'Raqib va o‘yin vaqti jadvalda ko‘rinadi.':mine?.status==='pending'?'Administrator tasdig‘ini kuting.':s.status==='registration'?'256 o‘rin uchun ro‘yxatdan o‘tish ochiq.':s.status==='draft'?'Ro‘yxatdan o‘tish boshlanishi shu yerda e’lon qilinadi.':'Turnir boshlangan. O‘yinlar va natijalarni kuzating.'}</p></div>{mine?.status==='approved'?<CheckCircle2 size={23} className="text-[var(--efl-primary)]"/>:mine?.status==='pending'?<Clock size={23}/>:s.status==='registration'&&<button className="tourney-button primary" disabled={busy||!userId||approved.length>=256} onClick={()=>void act('register')}>Ro‘yxatdan o‘tish</button>}</div>
          {!s.matches.length&&<><div className="u-progress"><span style={{width:`${approved.length/256*100}%`}}/></div><p className="text-[10px] tourney-muted">{approved.length} ishtirokchi tasdiqlangan · {256-approved.length} o‘rin</p></>}
          {subscriptionNotice&&<div className="mt-3">{subscriptionNotice}</div>}
        </section>
        {myNext&&<section><div className="u-section-heading"><h3>Sizning o‘yiningiz</h3></div>{matchCard(myNext)}</section>}
        <section><div className="u-section-heading"><div><h3>Saralash setkalari</h3><p>Har bir setkadan bittadan g‘olib final bosqichiga chiqadi.</p></div><span className="u-status">256 → 8</span></div><div className="u-bracket-grid">{Array.from({length:8},(_,i)=>{
          const id=i+1,winner=winnerOf(id),finished=s.matches.filter(m=>m.bracket===id&&m.winner).length;
          return <button className="u-bracket-entry" key={id} onClick={()=>{setBracket(id);navigate('bracket');}}><span className="u-entry-title"><strong>{id}-setka</strong><ChevronRight size={15}/></span><span>{winner?name(winner):'32 ishtirokchi · 1 yo‘llanma'}</span>{s.matches.length>0&&<span>{winner?'G‘olib aniqlandi':`${finished}/31 o‘yin yakunlangan`}</span>}</button>;
        })}</div><button className="u-final-entry" onClick={()=>{setBracket(0);navigate('bracket');}}><Trophy size={23}/><span className="flex-1"><strong>Final bosqichi</strong><small>8 g‘olib · Chorak final → Yarim final → Final</small></span><ChevronRight size={18}/></button></section>
        {s.announcements.length>0&&<section className="tourney-surface"><h3>Turnir e’lonlari</h3>{s.announcements.map(a=><article key={a.id} className="u-announce"><p className="text-xs whitespace-pre-wrap">{a.text}</p><time>{new Date(a.at).toLocaleDateString('uz-UZ',{timeZone:'Asia/Tashkent'})}</time></article>)}</section>}
        <details className="tourney-surface"><summary className="text-xs font-bold cursor-pointer">Turnir haqida</summary><div className="space-y-3 mt-3 text-xs tourney-muted"><p>{s.description}</p><p>32 ishtirokchilik 8 setkada beshtadan pley-off bosqichi o‘ynaladi. Har bir setka g‘olibi final bosqichiga chiqadi. Final bosqichida chorak final, yarim final va final bor.</p><p>Chempionlik uchun 8 ta g‘alaba kerak. Durang natijada g‘olib penaltilar orqali aniqlanadi.</p></div></details>
      </>}
      {tab==='bracket'&&<><nav className="u-pills" aria-label="UZEFLIFE setkalari">{Array.from({length:8},(_,i)=><button key={i+1} aria-pressed={bracket===i+1} onClick={()=>setBracket(i+1)}>{i+1}-setka</button>)}<button aria-pressed={bracket===0} onClick={()=>setBracket(0)}>Final bosqichi</button></nav><UzeflifeBracket state={s} bracket={bracket} onMatch={openMatch}/>{!s.matches.length&&<p className="tourney-muted">Turnir yo‘li belgilangan. Qur’adan so‘ng ishtirokchilar o‘z joylarida ko‘rinadi.</p>}</>}
      {(tab==='fixtures'||tab==='results')&&<>
        {!s.matches.length?<div className="u-empty"><CalendarDays size={25}/><h3>{tab==='results'?'Natijalar hali yo‘q':'Raqiblar qur’ada aniqlanadi'}</h3><p>{tab==='results'?'Tasdiqlangan hisoblar shu yerda ko‘rinadi.':'Ro‘yxatdan o‘tish yakunlangach o‘yinlar va vaqtlari shu yerda chiqadi.'}</p><button className="tourney-button mt-4" onClick={()=>navigate('bracket')}>Turnir setkasini ko‘rish</button></div>:<>
          <div className="flex items-center justify-between gap-3"><h3>{tab==='results'?'Natijalar':'O‘yinlar jadvali'}</h3><label className="text-xs tourney-muted">Setka <select aria-label="O‘yinlar setkasi" className="rounded-lg border border-[var(--efl-border)] bg-[var(--efl-surface)] px-2 py-2 text-[var(--efl-text)]" value={group} onChange={e=>{setGroup(e.target.value);setRound(e.target.value==='0'?6:1);setPage(0);}}><option value="all">Barchasi</option>{Array.from({length:8},(_,i)=><option key={i+1} value={i+1}>{i+1}-setka</option>)}<option value="0">Final bosqichi</option></select></label></div>
          <nav className="u-pills" aria-label="O‘yinlar bosqichi">{Array.from({length:8},(_,i)=>i+1).filter(r=>group==='all'||(group==='0'?r>=6:r<=5)).map(r=><button key={r} aria-pressed={selectedRound===r} onClick={()=>{setRound(r);setPage(0);}}>{r<=5?`Saralash · ${U_QUALIFIER_ROUNDS[r-1]}`:U_FINAL_ROUNDS[r-6]}</button>)}</nav>
          {filteredMatches.length?<><div className="u-match-list">{filteredMatches.slice(page*16,(page+1)*16).map(matchCard)}</div>{filteredMatches.length>16&&<div className="flex items-center justify-between text-xs"><button className="tourney-button" disabled={!page} onClick={()=>setPage(page-1)}>Oldingi</button><span>{page+1} / {Math.ceil(filteredMatches.length/16)}</span><button className="tourney-button" disabled={(page+1)*16>=filteredMatches.length} onClick={()=>setPage(page+1)}>Keyingi</button></div>}</>:<p className="u-empty">{tab==='results'?'Bu bosqichda hali tasdiqlangan natija yo‘q.':'Bu bosqichda o‘yin yo‘q.'}</p>}
        </>}
        {missing.length>0&&subscriptionNotice}
      </>}
      {tab==='participants'&&<><div className="u-section-heading"><h3>Ishtirokchilar</h3><span className="u-status">{approved.length} / 256</span></div>{approved.length>0&&<CompetitionToolbar value={search} onChange={setSearch} label="UZEFLIFE ishtirokchisini qidirish" placeholder="Ishtirokchi ismi"/>}<div className="tourney-surface u-participant-list">{approved.length?approved.filter(p=>p.name.toLowerCase().includes(search.trim().toLowerCase())).map((p,i)=><div className="u-participant" key={p.id}><span>{i+1}</span><strong>{p.name}{p.id===userId?' · Siz':''}</strong><small>{s.matches.length?participantState(p.id):'Tasdiqlangan'}</small></div>):<div className="u-empty"><Users size={25}/><h3>Ishtirokchilar kutilmoqda</h3><p>Tasdiqlangan ishtirokchilar shu yerda ko‘rinadi.</p></div>}</div></>}
      {tab==='standings'&&<div className="tourney-surface overflow-x-auto"><div className="u-section-heading"><div><h3>Turnir jadvali</h3><p>Pley-offdagi g‘alabalar va ishtirok holati.</p></div></div>{participants.length?<table className="u-results-table"><thead><tr><th>№</th><th>Ishtirokchi</th><th>G‘alaba</th><th>Holat</th></tr></thead><tbody>{[...participants].sort((a,b)=>s.matches.filter(m=>m.winner===b.id).length-s.matches.filter(m=>m.winner===a.id).length).map((p,i)=><tr key={p.id}><td>{i+1}</td><td>{p.name}</td><td>{s.matches.filter(m=>m.winner===p.id).length}</td><td>{s.matches.length?participantState(p.id):'Turnir kutilmoqda'}</td></tr>)}</tbody></table>:<p className="u-empty">Jadval ishtirokchilar tasdiqlangach to‘ldiriladi.</p>}</div>}
    </>}
    {activeMatch&&<UzeflifeMatchDialog key={activeMatch.id} match={activeMatch} state={s} userId={userId} busy={busy} error={error} subscriptionNotice={missing.length?subscriptionNotice:null} act={act} onClose={()=>setSelected(null)}/>}
  </div>;
}
