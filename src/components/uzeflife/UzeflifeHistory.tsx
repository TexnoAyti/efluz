import React,{useState} from 'react';
import {Trophy,History,ArrowLeft} from 'lucide-react';
import {uzeflifeRequest,type UViewState} from '../../lib/uzeflifeApi';
import type {UHistory,UMatch,UParticipant} from '../../types/uzeflife';
import {uRoundLabel,uMatchNumber} from '../../lib/uzeflifePresentation';

type Archive=UHistory&{participants:UParticipant[];matches:UMatch[]};
export function UzeflifeHistory({state:s}:{state:UViewState}){
 const [archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[round,setRound]=useState(8),[page,setPage]=useState(0);
 const open=async(id:string)=>{setLoading(true);setError('');try{const data=await uzeflifeRequest('history/'+id);setArchive(data.archive);setRound(data.archive.format==='LEAGUE'?15:8);setPage(0);}catch(e:any){setError(e.message);}finally{setLoading(false);}};
 const name=(id:string|null)=>archive?.participants.find(p=>p.id===id)?.name||'Ishtirokchi';
 const matches=archive?.matches.filter(m=>m.round===round)||[];
 return <section className="competition-panel u-admin-section"><div className="u-section-heading"><h3 className="flex gap-2 items-center"><History size={18}/>Turnir tarixi</h3></div>
  {error&&<p className="competition-note error" role="alert">{error}</p>}
  {!archive&&(!(s.history?.length)?<p className="competition-muted">Turnir yakunlangach chempion, finalchi va barcha natijalar shu yerda saqlanadi.</p>:s.history.map(entry=><article className="u-dialog-section space-y-3" key={entry.id}><Trophy size={24} className="text-[var(--efl-primary)]"/><h3>Chempion: {entry.championName}</h3><p className="competition-muted">{entry.format==='LEAGUE'?'2-o‘rin':'Finalchi'}: {entry.runnerUpName} · {entry.matchCount} ta yakunlangan o‘yin</p><time className="competition-muted">{new Date(entry.completedAt).toLocaleDateString('uz-UZ',{timeZone:'Asia/Tashkent'})}</time><button className="competition-button" disabled={loading} onClick={()=>void open(entry.id)}>{loading?'Yuklanmoqda…':'Barcha natijalarni ko‘rish'}</button></article>))}
  {archive&&<><button className="competition-button justify-self-start" onClick={()=>setArchive(null)}><ArrowLeft size={14}/>Tarixga qaytish</button><h3>Chempion: {archive.championName}</h3><p className="competition-muted">{archive.format==='LEAGUE'?'2-o‘rin':'Finalchi'}: {archive.runnerUpName}</p><label className="competition-field">Bosqich<select value={round} onChange={e=>{setRound(Number(e.target.value));setPage(0);}}>{Array.from({length:archive.format==='LEAGUE'?15:8},(_,i)=><option key={i+1} value={i+1}>{archive.format!=='LEAGUE'&&i<5?'Saralash · ':''}{uRoundLabel(i+1,archive.format)}</option>)}</select></label>{matches.slice(page*10,(page+1)*10).map(m=><article key={m.id} className="u-dialog-section"><p className="competition-muted">{m.bracket?`${m.bracket}-setka · `:''}{uMatchNumber(m)}-o‘yin</p><p className="text-xs font-bold break-words">{name(m.home)} {m.homeScore} : {m.awayScore} {name(m.away)}</p>{m.penaltyHome!==null&&<p className="competition-muted">Penaltilar {m.penaltyHome} : {m.penaltyAway}</p>}</article>)}{matches.length>10&&<nav className="u-page-controls" aria-label="Arxiv natijalari sahifalari"><button className="competition-button" disabled={!page} onClick={()=>setPage(page-1)}>Oldingi</button><span>{page+1} / {Math.ceil(matches.length/10)}</span><button className="competition-button" disabled={(page+1)*10>=matches.length} onClick={()=>setPage(page+1)}>Keyingi</button></nav>}</>}
 </section>;
}
