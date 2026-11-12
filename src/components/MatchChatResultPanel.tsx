import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronUp,LoaderCircle,RefreshCw,ShieldCheck,AlertCircle} from 'lucide-react';
import {getAuthHeaders} from '../lib/customTournamentApi';
import {isDomesticCupResult} from '../lib/cupResult';
import type {Fixture,MatchSubmission} from '../types';

type Submission = MatchSubmission | {homeScore:number;awayScore:number;submittedByUserId?:string};
type ResultData = Fixture & {userSubmission?:Submission|null;opponentSubmission?:Submission|null};
type Props={fixtureId:string;onConfirmed?:()=>void};

const score=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=99?value:null;
const formatScore=(a:unknown,b:unknown)=>score(a)===null||score(b)===null?'–':String(a)+' : '+String(b);
async function readResponse(response:Response){
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.message||body.error||'Natija serveri javob bermadi.');
 return body;
}

export function MatchChatResultPanel({fixtureId,onConfirmed}:Props){
 const [expanded,setExpanded]=useState(false);
 const [fixture,setFixture]=useState<ResultData|null>(null);
 const [home,setHome]=useState('');
 const [away,setAway]=useState('');
 const [homeExtra,setHomeExtra]=useState('');
 const [awayExtra,setAwayExtra]=useState('');
 const [homePenalty,setHomePenalty]=useState('');
 const [awayPenalty,setAwayPenalty]=useState('');
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const mounted=useRef(true);
 const savingRef=useRef(false);
 const refresh=useCallback(async(silent=false)=>{
  if(!fixtureId||savingRef.current)return;
  if(!silent)setLoading(true);
  try{
   const response=await fetch('/api/fixtures/'+encodeURIComponent(fixtureId),{headers:getAuthHeaders(),credentials:'same-origin'});
   const data=await readResponse(response);
   if(mounted.current&&data.fixture?.id===fixtureId){setFixture(data.fixture as ResultData);setError('');}
  }catch(e:any){if(mounted.current&&!silent)setError(e?.message||'Uchrashuv natijasini yuklab bo‘lmadi.');}
  finally{if(mounted.current&&!silent)setLoading(false);}
 },[fixtureId]);
 useEffect(()=>{
  mounted.current=true;setFixture(null);setExpanded(false);setHome('');setAway('');setHomeExtra('');setAwayExtra('');setHomePenalty('');setAwayPenalty('');setError('');setNotice('');
  void refresh();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh(true);},12000);
  return()=>{mounted.current=false;window.clearInterval(timer);};
 },[fixtureId,refresh]);
 const status=fixture?.status||'';
 const finished=status==='CONFIRMED'||status==='COMPLETED';
 const disputed=status==='DISPUTED';
 const own=fixture?.userSubmission||null;
 const opponent=fixture?.opponentSubmission||null;
 const pending=status==='PENDING_CONFIRMATION'||status==='PENDING';
 const domesticCup=Boolean(fixture&&isDomesticCupResult(fixture.competitionId));
 const canSubmit=Boolean(fixture&&!finished&&!disputed&&!saving&&!loading&&!own&&
   (['SCHEDULED','READY','PLAYING','AWAITING_RESULT','OVERDUE'].includes(status)||pending));
 const proposed=!own&&opponent&&score(opponent.homeScore)!==null&&score(opponent.awayScore)!==null;
 const submit=async(h:number,a:number,cup?:Submission)=>{
  if(savingRef.current||!canSubmit)return;
  if(score(h)===null||score(a)===null){setError('Hisob 0 dan 99 gacha butun son bo‘lishi kerak.');return;}
  savingRef.current=true;setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/fixtures/'+encodeURIComponent(fixtureId)+'/result',{
    method:'POST',headers:getAuthHeaders(),credentials:'same-origin',body:JSON.stringify({homeScore:h,awayScore:a,...(cup?{homeExtraTimeScore:(cup as MatchSubmission).homeExtraTimeScore??null,awayExtraTimeScore:(cup as MatchSubmission).awayExtraTimeScore??null,homePenaltyScore:(cup as MatchSubmission).homePenaltyScore??null,awayPenaltyScore:(cup as MatchSubmission).awayPenaltyScore??null}:{})})
   });
   const data=await readResponse(response);
   if(!data.fixture)throw new Error('Server natijani qaytarmadi.');
   const updated=data.fixture as ResultData;
   if(mounted.current){
    setFixture(updated);
    if(updated.status==='CONFIRMED'||updated.status==='COMPLETED'){
     setNotice('Hisob tasdiqlandi. Natija rasmiy jadvalga uzatildi.');
     onConfirmed?.();
    }else if(updated.status==='DISPUTED'){
     setNotice('Hisoblar mos kelmadi. Uchrashuv admin ko‘rib chiqishi uchun belgilandi.');
    }else{
     setNotice('Hisob yuborildi. Raqibingizning tasdiqlashi kutilmoqda.');
    }
   }
  }catch(e:any){if(mounted.current)setError(e?.message||'Hisob yuborilmadi.');}
  finally{savingRef.current=false;if(mounted.current)setSaving(false);}
 };
 const manualSubmit=()=>{
  const valid=(v:string)=>/^(0|[1-9]\d?)$/.test(v.trim());
  if(!valid(home)||!valid(away)){setError('Ikkala hisobni 0–99 oralig‘ida kiriting.');return;}
  const h=Number(home),a=Number(away);
  const hasExtra=Boolean(homeExtra||awayExtra),hasPenalty=Boolean(homePenalty||awayPenalty);
  if(domesticCup&&((hasExtra&&(!valid(homeExtra)||!valid(awayExtra)))||(hasPenalty&&(!valid(homePenalty)||!valid(awayPenalty))))){
   setError('Qo‘shimcha vaqt yoki penalti kiritilsa, ikkala jamoaning hisobini to‘liq yozing.');return;
  }
  if(domesticCup&&h===a&&!hasExtra&&!hasPenalty){
   setError('Kubokdagi durang uchun qo‘shimcha vaqt yoki penalti hisobini ham kiriting.');return;
  }
  void submit(h,a,domesticCup?{
   homeScore:h,awayScore:a,
   ...(hasExtra?{homeExtraTimeScore:Number(homeExtra),awayExtraTimeScore:Number(awayExtra)}:{}),
   ...(hasPenalty?{homePenaltyScore:Number(homePenalty),awayPenaltyScore:Number(awayPenalty)}:{})
  }:undefined);
 };
 const title=finished?'Tasdiqlangan hisob':disputed?'Hisob bo‘yicha nizo':own?'Raqib tasdig‘i kutilmoqda':proposed?'Raqib hisob yuborgan':'Uchrashuv hisobini kiritish';
 return <section className="match-chat-result" aria-label="Uchrashuv natijasini kiritish va tasdiqlash">
  <button className="match-chat-result-toggle" type="button" aria-expanded={expanded} onClick={()=>{setExpanded(x=>!x);if(!fixture)void refresh();}}>
   <ShieldCheck size={16}/>
   <span>{title}</span>
   {finished&&fixture&&<strong>{formatScore(fixture.homeScore,fixture.awayScore)}</strong>}
   {expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
  </button>
  {expanded&&<div className="match-chat-result-body">
   {loading&&!fixture?<p className="match-chat-result-note"><LoaderCircle size={14} className="animate-spin"/> Natija yuklanmoqda…</p>:null}
   {fixture&&<div className="match-chat-result-summary">
    <span>{fixture.homeClub?.name||'Mezbon'}</span>
    <strong>{finished?formatScore(fixture.homeScore,fixture.awayScore):opponent&&!own?formatScore(opponent.homeScore,opponent.awayScore):own?formatScore(own.homeScore,own.awayScore):'– : –'}</strong>
    <span>{fixture.awayClub?.name||'Mehmon'}</span>
   </div>}
   {finished&&<p className="match-chat-result-note success"><Check size={15}/> Uchrashuv natijasi tasdiqlangan.</p>}
   {disputed&&<p className="match-chat-result-note caution"><AlertCircle size={15}/> Raqiblar kiritgan hisoblar turlicha. Qarorni admin qabul qiladi.</p>}
   {!finished&&!disputed&&own&&<p className="match-chat-result-note">Siz {formatScore(own.homeScore,own.awayScore)} hisobini kiritgansiz. Raqibning tasdiqlashini kuting.</p>}
   {!finished&&!disputed&&proposed&&canSubmit&&<div className="match-chat-result-proposal">
    <p>Raqibingiz <b>{formatScore(opponent.homeScore,opponent.awayScore)}</b> hisobini taklif qildi.</p>
    <button type="button" disabled={saving} className="match-chat-result-confirm" onClick={()=>void submit(opponent.homeScore,opponent.awayScore,opponent)}>{saving?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} Hisobni tasdiqlash</button>
    <small>Hisob noto‘g‘ri bo‘lsa, pastda to‘g‘ri natijani kiriting. Mos kelmasa, admin tekshiradi.</small>
   </div>}
   {canSubmit&&<div className="match-chat-result-entry">
    <label>Mezbon <input inputMode="numeric" type="number" min="0" max="99" value={home} onChange={e=>setHome(e.target.value)} aria-label="Mezbon jamoa gollari"/></label>
    <span>:</span>
    <label>Mehmon <input inputMode="numeric" type="number" min="0" max="99" value={away} onChange={e=>setAway(e.target.value)} aria-label="Mehmon jamoa gollari"/></label>
    <button disabled={saving||!home.trim()||!away.trim()} type="button" onClick={manualSubmit}>{saving?<LoaderCircle size={14} className="animate-spin"/>:'Yuborish'}</button>
   </div>
   {domesticCup&&<details className="match-chat-result-extra"><summary>Kubok: qo‘shimcha vaqt va penaltilar</summary><div className="match-chat-result-extra-grid"><label>Qo‘shimcha vaqt, mezbon<input type="number" inputMode="numeric" min="0" max="99" value={homeExtra} onChange={e=>setHomeExtra(e.target.value)}/></label><label>Qo‘shimcha vaqt, mehmon<input type="number" inputMode="numeric" min="0" max="99" value={awayExtra} onChange={e=>setAwayExtra(e.target.value)}/></label><label>Penalti, mezbon<input type="number" inputMode="numeric" min="0" max="99" value={homePenalty} onChange={e=>setHomePenalty(e.target.value)}/></label><label>Penalti, mehmon<input type="number" inputMode="numeric" min="0" max="99" value={awayPenalty} onChange={e=>setAwayPenalty(e.target.value)}/></label></div><small>Qo‘shimcha vaqt hisobi 120-daqiqadagi jami hisobdir. Penalti hisobi alohida yoziladi.</small></details>}}
   {!canSubmit&&!finished&&!disputed&&!own&&fixture&&<p className="match-chat-result-note">Bu uchrashuv uchun hozir hisob kiritish mumkin emas.</p>}
   {notice&&<p className="match-chat-result-note success">{notice}</p>}
   {error&&<p role="alert" className="match-chat-result-note caution">{error}</p>}
   <button type="button" className="match-chat-result-refresh" onClick={()=>void refresh()} disabled={loading||saving}><RefreshCw size={13}/> Natijani yangilash</button>
  </div>}
 </section>;
}
