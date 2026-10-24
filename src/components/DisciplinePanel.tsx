import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { disciplineReasons, type DisciplineCard, type DisciplineReason } from '../types/discipline';
import { TOP5_CLUBS } from '../constants/top5Clubs';

type Game = Awaited<ReturnType<typeof api.getDisciplineFixtures>>['fixtures'][number];
const names=new Map(TOP5_CLUBS.map(club=>[club.id,club.name]));
const gameLabel=(game:{homeClubId:string;awayClubId:string;matchday:number;competitionName?:string;roundName?:string})=>`${names.get(game.homeClubId)||'Mezbon'} — ${names.get(game.awayClubId)||'Mehmon'}${game.competitionName?' · '+game.competitionName:''} · ${game.roundName||game.matchday+'-tur'}`;
export function DisciplinePanel({userId,seasonId='season-2026-27',admin=false}:{userId:string;seasonId?:string;admin?:boolean}) {
 const [cards,setCards]=useState<DisciplineCard[]>([]),[games,setGames]=useState<Game[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const [color,setColor]=useState<'YELLOW'|'RED'>('YELLOW'),[reason,setReason]=useState<DisciplineReason>('ABUSE'),[note,setNote]=useState(''),[incident,setIncident]=useState(''),[revoke,setRevoke]=useState(''),[revokeReason,setRevokeReason]=useState('');
 const draft=useRef({key:'',id:''});
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');setCards([]);setGames([]);
  Promise.all([api.getDiscipline(userId,seasonId),admin?api.getDisciplineFixtures(userId,seasonId):Promise.resolve({fixtures:[]})]).then(([history,matches])=>{if(!cancelled){setCards(history.cards);setGames(matches.fixtures);}}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[userId,seasonId,admin,revision]);
 const active=cards.filter(c=>c.status==='ACTIVE');
 const next=games.find(game=>game.eligible&&game.id!==incident);
 const issue=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');
  try {
   const body={seasonId,color,reason,note,incidentFixtureId:incident||null};
   const key=JSON.stringify({userId,...body});if(draft.current.key!==key)draft.current={key,id:crypto.randomUUID()};
   await api.issueDiscipline(userId,{...body,requestId:draft.current.id});setNote('');setIncident('');setRevision(v=>v+1);
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 };
 const undo=async()=>{
  setBusy(true);setError('');try{await api.revokeDiscipline(userId,revoke,seasonId,revokeReason);setRevoke('');setRevokeReason('');setRevision(v=>v+1);}catch(e:any){setError(e.message);}finally{setBusy(false);}
 };
 return <section className="efl-discipline" aria-label="Intizom va kartochkalar">
  <div className="efl-discipline-heading"><h2>Intizom</h2><div className="efl-card-totals"><span><i className="efl-card-symbol yellow" aria-hidden="true"/>{active.filter(c=>c.color==='YELLOW').length} sariq</span><span><i className="efl-card-symbol red" aria-hidden="true"/>{active.filter(c=>c.color==='RED').length} qizil</span></div></div>
  {loading&&<p role="status">Kartochkalar yuklanmoqda…</p>}
  {error&&<div role="alert" className="efl-discipline-error">{error}<button type="button" onClick={()=>setRevision(v=>v+1)}>Yangilash</button></div>}
  {!loading&&!error&&!cards.length&&<p className="efl-discipline-muted">Hozircha kartochka yo‘q.</p>}
  {!!cards.length&&<ul className="efl-card-history">{cards.map(card=><li key={card.id} className={card.status==='REVOKED'?'revoked':''}>
   <i className={`efl-card-symbol ${card.color==='RED'?'red':'yellow'}`} aria-hidden="true"/>
   <div><strong>{card.color==='RED'?'Qizil kartochka':'Sariq kartochka'}{card.status==='REVOKED'?' · Bekor qilingan':''}</strong><p>{disciplineReasons[card.reason]}</p>{card.note&&<p>{card.note}</p>}<small>{new Intl.DateTimeFormat('uz-UZ',{dateStyle:'medium',timeZone:'Asia/Tashkent'}).format(new Date(card.createdAt))}</small>
    {card.color==='RED'&&card.status==='ACTIVE'&&<p className="efl-card-sanction">{card.suspensionStatus==='SERVED'?'Bir o‘yinlik jazo o‘talgan.':card.suspensionStatus==='PENDING'?'Bir o‘yinga chetlatilgan. Keyingi o‘yin belgilanmoqda.':'Bir o‘yinga chetlatilgan. Belgilangan o‘yin natijasini admin hal qiladi.'}</p>}
    {card.suspensionMatch&&<p>{gameLabel(card.suspensionMatch)}</p>}
    {admin&&card.status==='ACTIVE'&&<button type="button" disabled={busy} onClick={()=>setRevoke(card.id)}>Kartochkani bekor qilish</button>}
   </div>
  </li>)}</ul>}
  {admin&&revoke&&<div className="efl-discipline-form"><label>Bekor qilish sababi<input maxLength={500} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)}/></label><div className="efl-discipline-actions"><button type="button" onClick={()=>setRevoke('')}>Yopish</button><button type="button" disabled={busy||revokeReason.trim().length<3} onClick={undo}>Bekor qilishni saqlash</button></div></div>}
  {admin&&<form onSubmit={issue} className="efl-discipline-form">
   <h3>Kartochka berish</h3><div className="efl-discipline-fields"><label>Kartochka<select value={color} onChange={e=>setColor(e.target.value as any)}><option value="YELLOW">Sariq — ogohlantirish</option><option value="RED">Qizil — bir o‘yinga chetlatish</option></select></label><label>Qoidabuzarlik<select value={reason} onChange={e=>setReason(e.target.value as DisciplineReason)}>{Object.entries(disciplineReasons).map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label></div>
   <label>Tegishli o‘yin (ixtiyoriy)<select value={incident} onChange={e=>setIncident(e.target.value)}><option value="">Umumiy qoidabuzarlik</option>{games.map(game=><option key={game.id} value={game.id}>{gameLabel(game)}</option>)}</select></label>
   <label>Sabab tafsiloti<textarea required minLength={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Nima bo‘lganini yozing. Bu izohni o‘yinchi va katta admin ko‘radi."/></label>
   {color==='RED'&&<p className="efl-card-sanction">{next?`Chetlatiladigan o‘yin: ${gameLabel(next)}`:'Keyingi o‘yin hozircha yo‘q. Qizil kartochka bir o‘yinlik jazo sifatida navbatda turadi.'}</p>}
   <button type="submit" disabled={busy||loading||note.trim().length<3}>{busy?'Saqlanmoqda…':'Kartochkani saqlash'}</button>
  </form>}
 </section>;
}
