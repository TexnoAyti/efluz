import React,{useState} from 'react';
import {ClipboardCheck,AlertTriangle} from 'lucide-react';
import type {UViewState} from '../../lib/uzeflifeApi';
import {uRoundLabel,uMatchNumber} from '../../lib/uzeflifePresentation';
import type {UAct} from './UzeflifeAdmin';
import {UzeflifeMatchDialog} from './UzeflifeMatchDialog';

export function UzeflifeResultQueue({state:s,busy,act,error=''}:{state:UViewState;busy:boolean;act:UAct;error?:string}){
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState('');
 const pending=s.matches.filter(m=>!m.winner&&(m.proposal||m.dispute?.status==='open'));
 const matches=pending.filter(m=>filter==='all'||(filter==='disputes'?m.dispute?.status==='open':m.dispute?.status!=='open'));
 const [page,setPage]=useState(0);const current=Math.min(page,Math.max(0,Math.ceil(matches.length/10)-1));
 const name=(id:string|null)=>s.participants.find(p=>p.id===id)?.name||'Ishtirokchi';
 const active=s.matches.find(m=>m.id===selected);
 return <section className="competition-panel u-admin-section">
  <div className="u-section-heading"><h3><ClipboardCheck size={17}/> Natijalar navbati</h3><span className="u-status">{pending.length+(s.topicResults?.length||0)} ta</span></div>
  <label className="competition-field">Ko‘rsatish<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">Barcha kutilayotgan natijalar</option><option value="pending">Tasdiq kutayotganlar</option><option value="disputes">Bahsli natijalar</option></select></label>
  {filter!=='disputes'&&s.topicResults?.map(p=><article key={p.id} className="u-dialog-section space-y-3"><p className="competition-muted">Telegram mavzusidan · {p.summary}</p><strong>{p.home} : {p.away}{p.penaltyHome!=null?` · Penaltilar ${p.penaltyHome}:${p.penaltyAway}`:''}</strong><p className="competition-muted">Hisobni yuborilgan mavzudagi admin tugmasi orqali tasdiqlang yoki rad eting.</p><a className="competition-button" href={p.url} target="_blank" rel="noreferrer">Mavzuda tekshirish</a></article>)}
  {!matches.length&&!s.topicResults?.length&&<p className="competition-muted">Bu ro‘yxatda kutilayotgan natija yo‘q.</p>}
  {matches.slice(current*10,(current+1)*10).map(m=><article key={m.id} className="u-dialog-section space-y-3">
   <p className="competition-muted">{m.bracket?`${m.bracket}-setka · `:''}{uRoundLabel(m.round)} · {uMatchNumber(m)}-o‘yin</p>
   <strong className="block break-words">{name(m.home)} {m.proposal?`${m.proposal.home} : ${m.proposal.away}`:'—'} {name(m.away)}</strong>
   {m.proposal?.penaltyHome!=null&&<p className="competition-muted">Penaltilar: {m.proposal.penaltyHome} : {m.proposal.penaltyAway}</p>}
   {m.dispute?.status==='open'&&<p className="competition-note"><AlertTriangle size={14}/> E’tiroz: {m.dispute.reason}</p>}
   <div className="competition-actions"><button className="competition-button" onClick={()=>setSelected(m.id)}>Tekshirish</button>{m.proposal&&m.dispute?.status!=='open'&&<button className="competition-button primary" disabled={busy||s.status!=='playing'||s.round!==m.round} onClick={()=>void act('approveResult',{matchId:m.id,expected:m.proposal})}>Hisobni tasdiqlash</button>}{m.proposal&&m.dispute?.status!=='open'&&<button className="competition-button" disabled={busy} onClick={()=>{if(window.confirm('Bu natijani rad etasizmi? O‘yinchilar qayta yuborishi mumkin.'))void act('clearProposal',{matchId:m.id});}}>Rad etish</button>}</div>
  </article>)}
  {matches.length>10&&<nav className="u-page-controls" aria-label="Natijalar navbati sahifalari"><button className="competition-button" disabled={!current} onClick={()=>setPage(current-1)}>Oldingi</button><span>{current+1} / {Math.ceil(matches.length/10)}</span><button className="competition-button" disabled={(current+1)*10>=matches.length} onClick={()=>setPage(current+1)}>Keyingi</button></nav>}
  {active&&<UzeflifeMatchDialog key={active.id} match={active} state={s} busy={busy} error={error} subscriptionNotice={null} act={act} onClose={()=>setSelected('')}/>}
 </section>;
}
