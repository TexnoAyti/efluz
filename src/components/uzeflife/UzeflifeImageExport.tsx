import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,Loader2,Share2,X} from 'lucide-react';
import type {UMatch} from '../../types/uzeflife';
import {uzeflifeRequest,type UViewState} from '../../lib/uzeflifeApi';
import {canExportUzeflifeImage,uzeflifeImageModel} from '../../lib/uzeflifeImage';
import {tournamentImageBlob} from '../../lib/tournamentImage';
import {pngBlobBase64,startTournamentImageDownload} from '../../lib/tournamentImageDownload';

type Preview={url:string;blob:Blob;filename:string;downloadUrl:string;expiresAt:number};
export function UzeflifeImageExport({state,matches,seasonId='season-2026-27'}:{state:UViewState;matches:UMatch[];seasonId?:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const scope=`${state.revision}:${state.permissions.join(',')}:${seasonId}:${matches.map(m=>m.id).join(',')}`;
 const active=useRef(scope);active.current=scope;
 useEffect(()=>{setPreview(null);setError('');setBusy(false);},[scope]);
 useEffect(()=>()=>{active.current='unmounted';},[]);
 useEffect(()=>{if(!preview)return;dialog.current?.showModal();return()=>{URL.revokeObjectURL(preview.url);trigger.current?.focus();};},[preview]);
 if(!canExportUzeflifeImage(state.permissions)||!matches.length)return null;
 const prepare=async()=>{
  if(busy)return;const requested=scope;setBusy(true);setError('');
  try{
   const fresh:UViewState=await uzeflifeRequest();
   if(!canExportUzeflifeImage(fresh.permissions))throw new Error('Rasmni yuklab olish vakolati bekor qilingan.');
   const selected=matches.map(m=>fresh.matches.find(actual=>actual.id===m.id));
   if(selected.some(m=>!m))throw new Error('O‘yinlar yangilangan. Sahifani yangilang.');
   const model=uzeflifeImageModel(fresh,selected as UMatch[],seasonId);
   const blob=await tournamentImageBlob(model);
   const filename=`efluz-uzeflife-r${matches[0].round}-${matches[0].id}-${matches[matches.length-1].id}.png`;
   const download=await uzeflifeRequest('image-export',{pngBase64:await pngBlobBase64(blob),filename});
   if(active.current!==requested)return;
   setPreview({url:URL.createObjectURL(blob),blob,filename,downloadUrl:new URL(download.downloadPath,window.location.origin).href,expiresAt:download.expiresAt});
  }catch(e:any){if(active.current===requested)setError(e.message||'Rasmni tayyorlab bo‘lmadi.');}
  finally{if(active.current===requested)setBusy(false);}
 };
 const save=()=>{
  if(!preview)return;
  if(preview.expiresAt<=Date.now()){setPreview(null);setError('Havola muddati tugadi. Rasmni qayta tayyorlang.');return;}
  try{startTournamentImageDownload(preview.downloadUrl,preview.filename,(window as any).Telegram?.WebApp,()=>{const a=document.createElement('a');a.href=preview.downloadUrl;a.download=preview.filename;document.body.appendChild(a);a.click();a.remove();});}
  catch{setError('Rasmni yuklab bo‘lmadi. Qayta urinib ko‘ring.');}
 };
 const share=async()=>{if(!preview)return;try{await navigator.share({files:[new File([preview.blob],preview.filename,{type:'image/png'})]});}catch(e:any){if(e.name!=='AbortError')setError('Rasmni ulashib bo‘lmadi.');}};
 const canShare=preview&&typeof navigator.canShare==='function'&&navigator.canShare({files:[new File([preview.blob],preview.filename,{type:'image/png'})]});
 return <section className="u-image-export" aria-label="Admin uchun o‘yinlar rasmi">
  <button ref={trigger} className="competition-button" type="button" disabled={busy} onClick={()=>void prepare()}>{busy?<Loader2 size={16} className="animate-spin"/>:<Download size={16}/>} {busy?'Rasm tayyorlanmoqda…':'O‘yinlar rasmini yuklab olish'}</button>
  <p className="competition-muted">Rasmga shu sahifadagi {matches.length} ta o‘yin kiradi. Keyingi sahifalarni alohida yuklab olishingiz mumkin.</p>
  {error&&<p className="competition-note error" role="alert">{error}</p>}
  {preview&&createPortal(<dialog ref={dialog} className="competition-dialog uzeflife" aria-label="UZEFLIFE o‘yinlari rasmi" onCancel={e=>{e.preventDefault();setPreview(null);}}>
   <header><h2>UZEFLIFE · O‘yinlar rasmi</h2><button className="competition-button" aria-label="Rasmni yopish" onClick={()=>setPreview(null)}><X size={17}/></button></header>
   <div className="competition-dialog-body"><img className="u-export-image" src={preview.url} alt="UZEFLIFE o‘yinlari, ishtirokchilar va hisoblar"/>{error&&<p role="alert" className="competition-note error">{error}</p>}<div className="competition-actions"><button className="competition-button primary" onClick={save}><Download size={16}/>PNG yuklab olish</button>{canShare&&<button className="competition-button" onClick={()=>void share()}><Share2 size={16}/>Ulashish</button>}</div></div>
  </dialog>,document.querySelector('.efl-preview')||document.body)}
 </section>;
}
