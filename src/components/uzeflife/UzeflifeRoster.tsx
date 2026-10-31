import React,{useState} from 'react';
import type {UViewState} from '../../lib/uzeflifeApi';
import type {UAct} from './UzeflifeAdmin';
export function UzeflifeRoster({state:s,busy=false,act}:{state:UViewState;busy?:boolean;act?:UAct}){
 const [group,setGroup]=useState(1),[search,setSearch]=useState('');
 const editable=!!act&&s.permissions.includes('participants')&&!s.matches.length;
 return <section className="competition-panel u-league-roster" aria-label="Asl setkalar ro‘yxati">
  <div className="u-section-heading"><div><h3>Asl setkalar ro‘yxati</h3><p>{s.roster?.filter(r=>r.username).length||0} username · {s.roster?.filter(r=>!r.username).length||0} bo‘sh o‘rin</p></div></div>
  <p className="competition-note">Bu umumiy liga. Setka va o‘rin — yuborilgan ro‘yxatdagi joy; ular qur’ada aralashtirilmaydi. Takrorlarning faqat birinchi joyi saqlangan.</p>
  <div className="u-fixture-filters"><label className="competition-field">Asl setka<select aria-label="Asl setka" value={group} onChange={e=>setGroup(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i} value={i+1}>{i+1}-setka</option>)}</select></label><label className="competition-field">Username qidirish<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="@username"/></label></div>
  <div className="u-player-list">{s.roster?.filter(r=>(search?`${r.username||''} ${r.originalUsername}`.toLowerCase().includes(search.toLowerCase().replace(/^@/,'')):r.group===group)).map(r=><article className="u-player-row" key={`${r.group}:${r.slot}`}><span className="u-player-number">{r.slot}</span><div className="u-player-identity"><strong>{r.username?'@'+r.username:'Bo‘sh o‘rin'}</strong><small>{r.group}-setka · {r.slot}-o‘rin · {r.userId?'Akkaunt ulangan':'Akkaunt ulanmagan'}</small>{!r.username&&r.duplicateOf&&<small>Takror @{r.originalUsername}: birinchi joyi {r.duplicateOf.group}-setka, {r.duplicateOf.slot}-o‘rin</small>}{editable&&!r.userId&&<form className="competition-actions" onSubmit={e=>{e.preventDefault();const username=String(new FormData(e.currentTarget).get('username')||'').trim();void act!('rosterSlot',{group:r.group,slot:r.slot,username:username||null,expectedRevision:s.revision});}}><label className="competition-field"><input aria-label={`${r.group}-setka ${r.slot}-o‘rin username`} name="username" maxLength={33} defaultValue={r.username||''} placeholder="@username" disabled={busy}/></label><button className="competition-button" disabled={busy}>Saqlash</button></form>}</div></article>)}</div>
 </section>;
}
