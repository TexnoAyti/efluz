import {UzeflifeLeagueChampionship} from './UzeflifeLeagueChampionship';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {uzeflifeRequest,type UViewState} from '../../lib/uzeflifeApi';
import type {UChannel} from '../../types/uzeflife';
import {UzeflifeChampionship} from './UzeflifeChampionship';
import '../competition-content.css';
import './uzeflife.css';

export function UzeflifeView({management=false}:{management?:boolean}={}) {
  const {user,activeSeasonId}=useAuth();
  const [state,setState]=useState<UViewState|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[missing,setMissing]=useState<UChannel[]>([]);
  const request=useRef<{controller:AbortController;kind:'load'|'action'}|null>(null);
  const recovery=useRef(false),[recoveryRequired,setRecoveryRequired]=useState(false);
  const load=useCallback(async()=>{
    if(request.current)return;
    const operation={controller:new AbortController(),kind:'load' as const};request.current=operation;
    setError('');setBusy(true);
    try {const data=await uzeflifeRequest('',undefined,{signal:operation.controller.signal});if(request.current===operation){setState(data);recovery.current=false;setRecoveryRequired(false);}}
    catch(e:any){if(request.current===operation)setError(e.message);}
    finally {if(request.current===operation){request.current=null;setBusy(false);}}
  },[]);
  useEffect(()=>{
    setState(null);setNotice('');setMissing([]);recovery.current=false;setRecoveryRequired(false);void load();
    return()=>{const previous=request.current;request.current=null;previous?.controller.abort();};
  },[user?.id,activeSeasonId,load]);
  const act=useCallback(async(action:string,body:unknown={})=>{
    // React's busy render is asynchronous; use a synchronous single-flight lock.
    if(request.current)return false;
    if(recovery.current){setError('Avval holatni yangilang. Oldingi amalning natijasi hali tekshirilmagan.');return false;}
    const operation={controller:new AbortController(),kind:'action' as const};request.current=operation;
    setBusy(true);setError('');setNotice('');
    try {
      const data=await uzeflifeRequest(action,body,{signal:operation.controller.signal});
      if(request.current!==operation)return false;
      if(action==='subscription-check'){
        setMissing(data.channels);setNotice(data.subscribed?'Obuna tasdiqlandi. Ro‘yxatdan o‘tishingiz mumkin.':'Barcha kanallarga obuna bo‘ling.');
      } else {setState(data);setMissing([]);setNotice(action==='register'?'Arizangiz qabul qilindi. Administrator tasdig‘ini kuting.':action==='result'&&data.matches?.find((m:any)=>m.id===(body as any)?.matchId)?.dispute?.status==='open'?'Hisoblar mos kelmadi. Admin tekshirishi uchun e’tiroz ochildi.':'Saqlandi.');}
      return true;
    } catch(e:any){if(request.current===operation){setError(e.message);if(e.channels)setMissing(e.channels);if(e.uncertain){recovery.current=true;setRecoveryRequired(true);}}return false;}
    finally {if(request.current===operation){request.current=null;setBusy(false);}}
  },[]);
  if(!state)return <div className="competition-page uzeflife"><div className="u-loading" role="status">{error?<><p role="alert">{error}</p><button className="competition-button" onClick={()=>void load()}>Qayta urinish</button></>:<><RefreshCw size={22} className="animate-spin"/><p>UZEFLIFE yuklanmoqda…</p></>}</div></div>;
  if(management&&!state.permissions.length)return <div className="competition-page uzeflife"><div className="competition-panel" role="status"><h3>UZEFLIFE admin paneli</h3><p className="competition-muted mt-2">Bu hisobga UZEFLIFE boshqaruv vakolati berilmagan. Turnir egasi yoki Super admindan ruxsat so‘rang.</p><button className="competition-button mt-3" disabled={busy} onClick={()=>void load()}>Vakolatni qayta tekshirish</button></div></div>;
  return <>
    {(busy||recoveryRequired)&&<div className="competition-note space-y-2" role="status" aria-live="polite">
      <p>{busy?(request.current?.kind==='action'?'Amal bajarilmoqda… Oynani yopishingiz yoki boshqa bo‘limni ko‘rishingiz mumkin.':'Holat yangilanmoqda…'):'Oldingi amal bajarilgan bo‘lishi mumkin. Takror yuborishdan oldin holatni yangilang.'}</p>
      {recoveryRequired&&<button type="button" className="competition-button" disabled={busy} onClick={()=>void load()}>Holatni tekshirish va tugmalarni ochish</button>}
    </div>}
    {state.format==='LEAGUE'?<UzeflifeLeagueChampionship seasonId={activeSeasonId} initialAdmin={management} key={`${user?.id||'public'}:${activeSeasonId}`} state={state} userId={user?.id} busy={busy||recoveryRequired} error={error} notice={notice} missing={missing} act={act} onRefresh={()=>void load()}/>:<UzeflifeChampionship seasonId={activeSeasonId} initialAdmin={management} key={`${user?.id||'public'}:${activeSeasonId}`} state={state} userId={user?.id} busy={busy||recoveryRequired} error={error} notice={notice} missing={missing} act={act} onRefresh={()=>void load()}/>}
  </>;
}
