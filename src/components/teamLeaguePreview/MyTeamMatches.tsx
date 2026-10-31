import {CompetitionFixtureCard} from '../CompetitionContent';
import {Swords,MessageCircle,Clock3,CheckCircle2,AlertCircle,Send,ShieldCheck} from 'lucide-react';
import React,{useEffect,useRef,useState} from 'react';
import {teamPreviewRequest} from '../../lib/teamLeaguePreviewApi';
type Match={fixtureId:string;boutId:string;round:number;homeName:string;awayName:string;opponentName:string;contactUrl?:string;homeScore:number|null;awayScore:number|null;pendingResult?:{homeScore:number;awayScore:number;mine:boolean};disputed:boolean;canPlay:boolean};
type View={version:number;matches:Match[]};
export function MyTeamMatches({leagueId,userId,onRefresh}:{leagueId:string;userId:string;onRefresh:()=>void}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0),lock=useRef(false);const path=`/player/leagues/${leagueId}/matches`;
 useEffect(()=>{const current=++epoch.current;setView(null);setBusy(false);setError('');const load=()=>{if(lock.current||document.visibilityState==='hidden')return;void teamPreviewRequest<View>(path).then(v=>{if(current===epoch.current){setView(old=>old&&old.version>v.version?old:v);setError('');}}).catch(e=>{if(current===epoch.current)setError(e.message);});};load();const timer=setInterval(load,20000);return()=>{epoch.current++;clearInterval(timer);};},[leagueId,userId]);
 const act=async(m:Match,action:string,scores?:{homeScore:number;awayScore:number})=>{if(lock.current||!view)return;lock.current=true;setBusy(true);setError('');const current=epoch.current;try{const next=await teamPreviewRequest<View>(path,{action,version:view.version,fixtureId:m.fixtureId,boutId:m.boutId,...scores});if(current===epoch.current){setView(next);onRefresh();}}catch(e:any){if(current===epoch.current){setError(e.message);try{const next=await teamPreviewRequest<View>(path);if(current===epoch.current)setView(next);}catch{}}}finally{lock.current=false;if(current===epoch.current)setBusy(false);}};
 if(!view?.matches.length&&!error)return null;
 return <section className="competition-panel team-my-matches" aria-label="Mening team o‘yinlarim">
  <header className="team-between"><div className="team-row"><span className="team-my-match-icon"><Swords size={20} aria-hidden="true"/></span><div><p className="competition-eyebrow">TEAMS · SHAXSIY UCHRASHUVLAR</p><h3 className="team-section-title">Mening o‘yinlarim</h3></div></div><span className="team-status">{view?.matches.length||0} o‘yin</span></header>
  <p className="competition-muted">Raqib bilan bog‘laning. O‘yindan keyin hisobni yuboring va tasdiqlang.</p>
  {error&&<p role="alert" className="competition-note error">{error}</p>}
  <div className="team-my-match-list">{view?.matches.map(m=>{const done=m.homeScore!==null&&m.awayScore!==null,Icon=done?CheckCircle2:m.disputed?AlertCircle:m.pendingResult?Clock3:Swords;
   return <CompetitionFixtureCard className="team-my-match-card" key={`${m.fixtureId}:${m.boutId}`} caption={`${m.round}-TUR`} statusTone={done?'success':m.pendingResult||m.disputed?'warning':'neutral'}
    status={<span className={`team-my-match-state ${done?'confirmed':m.disputed?'disputed':''}`}><Icon size={13} aria-hidden="true"/>{done?'Tasdiqlangan':m.disputed?'Hisob rad etilgan':m.pendingResult?'Tasdiq kutilmoqda':m.canPlay?'O‘ynash uchun tayyor':'Tur ochilishini kuting'}</span>}
    home={<span className="team-my-match-identity"><b>{m.homeName}</b><small>Uy</small></span>}
    away={<span className="team-my-match-identity"><b>{m.awayName}</b><small>Safar</small></span>}
    score={<strong aria-label={`Hisob ${m.homeScore??'kiritilmagan'} : ${m.awayScore??'kiritilmagan'}`}>{m.homeScore??'—'} : {m.awayScore??'—'}</strong>}>
    {m.contactUrl?<a className="competition-button team-my-match-contact" href={m.contactUrl} target="_blank" rel="noreferrer"><MessageCircle size={16} aria-hidden="true"/><span>Raqibga yozish<small>{m.opponentName}</small></span></a>:<p className="competition-note">Raqib profili ochilmadi. Administratorga murojaat qiling.</p>}
    {m.canPlay&&<>{m.disputed&&<p className="competition-note error">Hisob rad etildi. Kelishib qayta yuboring yoki administratorga murojaat qiling.</p>}{m.pendingResult?<div className="team-my-match-pending" role="status"><div className="team-row"><Clock3 size={17} aria-hidden="true"/><div><b>Yuborilgan hisob</b><p>{m.homeName} <strong>{m.pendingResult.homeScore} : {m.pendingResult.awayScore}</strong> {m.awayName}</p></div></div>{m.pendingResult.mine?<p className="competition-muted">Raqib tasdig‘i kutilmoqda. Tasdiqlangach natija jadvalga qo‘shiladi.</p>:<div className="team-my-match-actions"><button disabled={busy} className="competition-button primary" onClick={()=>void act(m,'CONFIRM_RESULT')}><CheckCircle2 size={16} aria-hidden="true"/>Tasdiqlash</button><button disabled={busy} className="competition-button" onClick={()=>void act(m,'DISPUTE_RESULT')}>Hisob noto‘g‘ri</button></div>}</div>:<PlayerScore key={`${view.version}:${m.boutId}`} match={m} busy={busy} save={scores=>void act(m,'SUBMIT_RESULT',scores)}/>}</>}
   </CompetitionFixtureCard>;
  })}</div>
 </section>;
}
function PlayerScore({match:m,busy,save}:{match:Match;busy:boolean;save:(scores:{homeScore:number;awayScore:number})=>void}){
 const [home,setHome]=useState(''),[away,setAway]=useState('');
 return <form className="team-my-match-score" onSubmit={e=>{e.preventDefault();save({homeScore:Number(home),awayScore:Number(away)});}}>
  <div className="team-my-match-score-fields"><label className="competition-field">{m.homeName}<input inputMode="numeric" type="number" min={0} max={99} step={1} placeholder="0" required disabled={busy} value={home} onChange={e=>setHome(e.target.value)}/></label><span aria-hidden="true">:</span><label className="competition-field">{m.awayName}<input inputMode="numeric" type="number" min={0} max={99} step={1} placeholder="0" required disabled={busy} value={away} onChange={e=>setAway(e.target.value)}/></label></div>
  <p className="competition-muted team-row"><ShieldCheck size={14} aria-hidden="true"/>Natija raqib tasdiqlagandan keyin hisoblanadi.</p>
  <button className="competition-button primary" disabled={busy||home===''||away===''}><Send size={16} aria-hidden="true"/>{busy?'Yuborilmoqda…':'Hisobni yuborish'}</button>
 </form>;
}
