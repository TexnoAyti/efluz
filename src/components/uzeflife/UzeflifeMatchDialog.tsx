import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,CalendarDays} from 'lucide-react';
import {uRoundLabel,uSourceLabel,uMatchNumber} from '../../lib/uzeflifePresentation';
import type {UViewState} from '../../lib/uzeflifeApi';
import type {UMatch} from '../../types/uzeflife';
import type {UAct} from './UzeflifeAdmin';

export function UzeflifeMatchDialog({match:m,state:s,userId,busy,error,subscriptionNotice,act,onClose}:{match:UMatch;state:UViewState;userId?:string;busy:boolean;error:string;subscriptionNotice:React.ReactNode;act:UAct;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [report,setReport]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const real=s.matches.some(f=>f.id===m.id);
  const canResult=s.permissions.includes('results');
  const isPlayer=[m.home,m.away].includes(userId||'')&&s.participants.find(p=>p.id===userId)?.status==='approved';
  const canReport=real&&s.status==='playing'&&m.round===s.round&&m.home&&m.away&&(canResult||isPlayer&&!m.winner);
  const name=(side:'home'|'away')=>s.participants.find(p=>p.id===m[side])?.name||uSourceLabel(m,side);
  return createPortal(<dialog ref={dialog} className="efl-custom-tournaments tourney-dialog uzeflife u-native-dialog" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} aria-labelledby="u-match-title">
    <header><div><p className="tourney-eyebrow">{m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · {uRoundLabel(m.round)}</p><h2 id="u-match-title">{uMatchNumber(m)}-o‘yin</h2></div><button className="tourney-button !p-2" disabled={busy} onClick={onClose} aria-label="O‘yinni yopish"><X size={18}/></button></header>
    <div className="tourney-dialog-body">
      <div className="u-match-teams u-dialog-score"><span>{name('home')}</span><strong className="u-match-score">{m.homeScore??'–'} : {m.awayScore??'–'}</strong><span>{name('away')}</span></div>
      {m.penaltyHome!==null&&<p className="tourney-muted">Penaltilar: {m.penaltyHome} : {m.penaltyAway}</p>}
      <p className="tourney-muted">{m.winner?'Natija tasdiqlangan.':m.proposal?'Natija yuborilgan. Raqib yoki administrator tasdig‘i kutilmoqda.':real?'O‘yin hali yakunlanmagan.':'Qur’a tashlangach raqiblar shu yerda ko‘rinadi.'}</p>
      {m.scheduledAt&&<p className="flex items-center gap-2 text-xs"><CalendarDays size={14}/>{new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',dateStyle:'medium',timeStyle:'short'})}</p>}
      {m.proposal&&<div className="tourney-note">Yuborilgan hisob: <strong>{m.proposal.home} : {m.proposal.away}</strong>{m.proposal.penaltyHome!==null?` · Penaltilar ${m.proposal.penaltyHome} : ${m.proposal.penaltyAway}`:''}</div>}
      {error&&<p role="alert" className="tourney-note error">{error}</p>}{subscriptionNotice}
      {canReport&&!report&&<button className="tourney-button primary" disabled={busy||!canResult&&m.proposal?.by===userId} onClick={()=>setReport(true)}>{canResult?(m.winner?'Hisobni tuzatish':'Natijani tasdiqlash'):m.proposal?.by===userId?'Tasdiq kutilmoqda':m.proposal?'Hisobni tekshirish':'Hisob kiritish'}</button>}
      {canReport&&report&&<form className="space-y-3 u-dialog-section" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const ok=await act('result',{matchId:m.id,home:Number(f.get('home')),away:Number(f.get('away')),penaltyHome:f.get('penaltyHome')===''?null:Number(f.get('penaltyHome')),penaltyAway:f.get('penaltyAway')===''?null:Number(f.get('penaltyAway'))});if(ok)setReport(false);}}>
        <div className="grid grid-cols-2 gap-3">{(['home','away'] as const).map(side=><label key={side} className="tourney-field">{name(side)}<input type="number" name={side} min={0} max={99} required defaultValue={m.proposal?.[side]??m[`${side}Score`]??0}/></label>)}</div>
        <details open={m.proposal?.penaltyHome!==null&&!!m.proposal||m.penaltyHome!==null}><summary className="text-xs cursor-pointer">Durang bo‘lsa — penaltilar</summary><div className="grid grid-cols-2 gap-3 mt-3">{(['home','away'] as const).map(side=><label key={side} className="tourney-field">{name(side)}<input type="number" name={side==='home'?'penaltyHome':'penaltyAway'} min={0} max={99} defaultValue={m.proposal?.[side==='home'?'penaltyHome':'penaltyAway']??m[side==='home'?'penaltyHome':'penaltyAway']??''}/></label>)}</div></details>
        <button className="tourney-button primary" disabled={busy}>Hisobni {m.proposal&&m.proposal.by!==userId?'tasdiqlash':'yuborish'}</button>
      </form>}
      {real&&s.permissions.includes('matches')&&m.proposal&&<button className="tourney-button" disabled={busy} onClick={()=>void act('clearProposal',{matchId:m.id})}>Natija arizasini qaytarish</button>}
      {real&&s.permissions.includes('schedules')&&!m.winner&&<details className="u-dialog-section"><summary className="text-xs font-bold cursor-pointer">O‘yin vaqtini belgilash</summary><form className="space-y-3 mt-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await act('schedule',{matchId:m.id,scheduledAt:new Date(`${f.get('at')}:00+05:00`).toISOString()});}}><label className="tourney-field">Toshkent vaqti<input type="datetime-local" name="at" required/></label><button className="tourney-button" disabled={busy}>Vaqtni saqlash</button></form></details>}
    </div>
  </dialog>,document.querySelector('.efl-preview')||document.body);
}
