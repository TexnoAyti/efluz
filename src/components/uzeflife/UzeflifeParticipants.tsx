import React,{useState} from 'react';
import {UserPlus,Search,Users,CheckCircle2,Clock} from 'lucide-react';
import type {UViewState} from '../../lib/uzeflifeApi';
import type {UAct} from './UzeflifeAdmin';

type Filter='pending'|'approved'|'removed'|'all';
export function UzeflifeParticipants({state:s,busy,act}:{state:UViewState;busy:boolean;act:UAct}){
 const [target,setTarget]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState<Filter>('all'),[page,setPage]=useState(0);
 const approved=s.participants.filter(p=>p.status==='approved').length,pending=s.participants.filter(p=>p.status==='pending').length;
 const canAdd=!s.matches.length&&['draft','registration'].includes(s.status);
 const filtered=s.participants.filter(p=>(filter==='all'||p.status===filter)&&`${p.name} ${p.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending'));
 const pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
 return <div className="u-admin-section">
  <div className="u-admin-metrics"><div><Users size={18}/><strong>{approved}<small>/ 256</small></strong><span>Tasdiqlangan</span></div><div><Clock size={18}/><strong>{pending}</strong><span>Kutilayotgan arizalar</span></div><div><CheckCircle2 size={18}/><strong>{Math.max(0,256-approved-pending)}</strong><span>Bo‘sh o‘rinlar</span></div></div>
  <section className="competition-panel u-player-add" aria-label="O‘yinchi qo‘shish">
   <div className="u-section-heading"><div><h3><UserPlus size={17}/>O‘yinchi qo‘shish</h3><p>{canAdd?'EFLUZ akkauntini tanlab, turnirga tasdiqlangan ishtirokchi qo‘shing.':'Turnir boshlangan. Yangi o‘yinchi qo‘shish yopilgan.'}</p></div></div>
   {canAdd&&<form onSubmit={async e=>{e.preventDefault();if(await act('addParticipant',{target:target.trim()}))setTarget('');}}><label className="competition-field">Telegram ID yoki EFLUZ akkaunt ID<input name="target" required maxLength={100} autoComplete="off" placeholder="Masalan: 123456789" value={target} onChange={e=>setTarget(e.target.value)}/></label><button className="competition-button primary" disabled={busy||!target.trim()||approved+pending>=256} type="submit"><UserPlus size={16}/>O‘yinchini qo‘shish</button><p className="competition-muted">O‘yinchi avval EFLUZ’ga kirgan bo‘lishi kerak. Ismi akkauntidan olinadi; majburiy obuna yoqilgan bo‘lsa, obunasi tekshiriladi.</p></form>}
  </section>
  <section className="competition-panel" aria-label="Ishtirokchilar boshqaruvi">
   <div className="u-section-heading"><div><h3>Ishtirokchilar</h3><p>{filtered.length} ta o‘yinchi</p></div></div>
   <div className="u-player-filters"><label className="competition-field"><span><Search size={13}/>O‘yinchini qidirish</span><input type="search" placeholder="Ism yoki akkaunt ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><label className="competition-field">Holati<select value={filter} onChange={e=>{setFilter(e.target.value as Filter);setPage(0);}}><option value="all">Barchasi</option><option value="pending">Tasdiq kutilmoqda</option><option value="approved">Tasdiqlangan</option><option value="removed">Bekor qilingan</option></select></label></div>
   <div className="u-player-list">{filtered.slice(current*20,(current+1)*20).map((p,i)=><article className="u-player-row" key={p.id}><span className="u-player-number">{current*20+i+1}</span><div className="u-player-identity"><strong>{p.name}</strong><small title={p.id}>ID: {p.id}</small><span className={`u-player-status is-${p.status}`}>{p.status==='pending'?'Tasdiq kutilmoqda':p.status==='approved'?'Tasdiqlangan':'Bekor qilingan'}</span></div>{s.status!=='completed'&&<div className="u-player-actions">{canAdd&&p.status!=='approved'&&<button className="competition-button" disabled={busy} onClick={()=>void act('addParticipant',{target:p.id})}><CheckCircle2 size={14}/>{p.status==='removed'?'Qayta qo‘shish':'Tasdiqlash'}</button>}{p.status!=='removed'&&<button className="competition-button u-danger-action" disabled={busy} onClick={()=>{if(window.confirm(`${p.name} ishtirokini bekor qilasizmi?`))void act('review',{target:p.id,status:'removed'});}}>{p.status==='pending'?'Rad etish':'Chiqarish'}</button>}</div>}</article>)}</div>
   {!filtered.length&&<div className="u-player-empty"><Users size={24}/><h3>{s.participants.length?'O‘yinchi topilmadi':'Hali ishtirokchilar yo‘q'}</h3><p>{s.participants.length?'Qidiruv yoki holat filtrini o‘zgartiring.':'Yuqoridagi shakl orqali birinchi o‘yinchini qo‘shing.'}</p></div>}
   {pages>1&&<nav className="u-page-controls" aria-label="Admin ishtirokchilar sahifalari"><button className="competition-button" disabled={!current} onClick={()=>setPage(current-1)}>Oldingi</button><span>{current+1} / {pages}</span><button className="competition-button" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Keyingi</button></nav>}
  </section>
 </div>;
}
