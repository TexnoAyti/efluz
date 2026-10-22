import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {uzeflifeRequest,type UViewState} from '../../lib/uzeflifeApi';
import type {UChannel} from '../../types/uzeflife';
import {UzeflifeChampionship} from './UzeflifeChampionship';
import '../customTournaments/tournaments.css';
import './uzeflife.css';

export function UzeflifeView() {
  const {user}=useAuth();
  const [state,setState]=useState<UViewState|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[missing,setMissing]=useState<UChannel[]>([]);
  const generation=useRef(0);
  const load=async()=>{
    const id=++generation.current;setError('');setBusy(true);
    try {const data=await uzeflifeRequest();if(id===generation.current)setState(data);}
    catch(e:any){if(id===generation.current)setError(e.message);}
    finally {if(id===generation.current)setBusy(false);}
  };
  useEffect(()=>{setState(null);setNotice('');setMissing([]);void load();return()=>{generation.current++;};},[user?.id]);
  const act=async(action:string,body:unknown={})=>{
    if(busy)return false;
    const id=generation.current;setBusy(true);setError('');setNotice('');
    try {
      const data=await uzeflifeRequest(action,body);
      if(id!==generation.current)return false;
      if(action==='subscription-check'){
        setMissing(data.channels);setNotice(data.subscribed?'Obuna tasdiqlandi. Ro‘yxatdan o‘tishingiz mumkin.':'Barcha kanallarga obuna bo‘ling.');
      } else {setState(data);setMissing([]);setNotice(action==='register'?'Arizangiz qabul qilindi. Administrator tasdig‘ini kuting.':'Saqlandi.');}
      return true;
    } catch(e:any){if(id===generation.current){setError(e.message);if(e.channels)setMissing(e.channels);}return false;}
    finally {if(id===generation.current)setBusy(false);}
  };
  if(!state)return <div className="efl-custom-tournaments tourney-page uzeflife"><div className="u-loading" role="status">{error?<><p role="alert">{error}</p><button className="tourney-button" onClick={()=>void load()}>Qayta urinish</button></>:<><RefreshCw size={22} className="animate-spin"/><p>UZEFLIFE yuklanmoqda…</p></>}</div></div>;
  return <UzeflifeChampionship key={user?.id||'public'} state={state} userId={user?.id} busy={busy} error={error} notice={notice} missing={missing} act={act} onRefresh={()=>void load()}/>;
}
