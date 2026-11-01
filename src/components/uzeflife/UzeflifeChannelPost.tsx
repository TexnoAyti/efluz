import React,{useEffect,useState} from 'react';
import {Send,RefreshCw,CheckCircle2} from 'lucide-react';
import {uzeflifeRequest,type UViewState} from '../../lib/uzeflifeApi';

type Delivery={round:number;channel:string;state:string;sentPages:number;totalPages:number;matchCount:number;error?:string;checkpoint:string|null;canReconcile:boolean;minConfirmed?:number;maxConfirmed?:number;tokenConfigured?:boolean;legacy?:boolean};
const labels:Record<string,string>={idle:'Hali yuborilmagan',pending:'Yuborish navbatida',sending:'Yuborilmoqda',sent:'Muvaffaqiyatli yuborildi',failed:'Yuborish to‘xtadi',unverified:'Kanalni tekshirish kerak'};
export function UzeflifeChannelPost({state:s}:{state:UViewState}) {
 const [round,setRound]=useState(s.round||1),[delivery,setDelivery]=useState<Delivery|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const [checked,setChecked]=useState(false),[confirmed,setConfirmed]=useState('');
 useEffect(()=>{
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
  setDelivery(null);setError('');setChecked(false);setConfirmed('');
  const load=async()=>{
   try{const result=await uzeflifeRequest('publish-status?round='+round);if(cancelled)return;setDelivery(result);setError('');if(['pending','sending'].includes(result.state))timer=setTimeout(load,5000);}
   catch(e:any){if(!cancelled)setError(e.message||'Holatni yuklab bo‘lmadi.');}
  };
  void load();return()=>{cancelled=true;if(timer)clearTimeout(timer);};
 },[round,refresh]);
 const submit=async(reconcile=false)=>{
  setBusy(true);setError('');
  try{
   const result=await uzeflifeRequest(reconcile?'publish-reconcile':'publish-round',reconcile?{round,checkpoint:delivery?.checkpoint,confirmedPages:Number(confirmed),checkedChannel:checked}:{round,expectedRevision:s.revision});
   setDelivery(result);setRefresh(n=>n+1);
  }catch(e:any){setError(e.message||'Yuborishni boshlab bo‘lmadi.');}finally{setBusy(false);}
 };
 const active=delivery&&['pending','sending'].includes(delivery.state),sent=delivery?.state==='sent';
 const rounds=[...new Set(s.matches.filter(m=>m.round<=s.round).map(m=>m.round))].sort((a,b)=>a-b);
 return <section className="competition-panel u-admin-section space-y-3" aria-label="Kanalga xabar yuborish">
  <div className="u-section-heading"><div><h3>Xabar yuborish</h3><p>Tur o‘yinlari rasmlari · <a href="https://t.me/uzeflife_turner" target="_blank" rel="noreferrer">@uzeflife_turner ↗</a></p></div><Send size={19}/></div>
  <p className="competition-muted">Tanlangan turning barcha o‘yinlari rasmga joylanadi. Har bir rasmga bir xil e’lon matni qo‘shiladi. Muvaffaqiyatli yuborilgan tur qayta yuborilmaydi.</p>
  <label className="competition-field">Turni tanlang<select value={round} disabled={busy||!!active} onChange={e=>setRound(Number(e.target.value))}>{rounds.map(r=><option key={r} value={r}>{r}-tur</option>)}</select></label>
  <div role="status" aria-live="polite" className="u-dialog-section space-y-2">
   <strong className="flex gap-2 items-center">{sent&&<CheckCircle2 size={16}/>} {delivery?labels[delivery.state]||'Holat tekshirilmoqda':'Holat yuklanmoqda…'}</strong>
   {delivery&&<p className="competition-muted">{delivery.matchCount} ta o‘yin · {delivery.sentPages}/{delivery.totalPages} ta rasm yuborilgan</p>}
   {delivery?.error&&<p className="text-sm">{delivery.error}</p>}
  </div>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {delivery?.canReconcile?<div className="u-dialog-section space-y-3">
   <p className="competition-muted">Oldingi urinishda Telegram javobi kelmagan. Kanalni ochib, shu turdan nechta rasm chiqqanini tekshiring. Davom ettirishda faqat qolgan rasmlar yuboriladi.</p>
   <label className="competition-field">Kanaldagi tasdiqlangan rasmlar<select value={confirmed} onChange={e=>setConfirmed(e.target.value)} disabled={busy}><option value="">Sonini tanlang</option>{Array.from({length:(delivery.maxConfirmed||0)-(delivery.minConfirmed||0)+1},(_,i)=>i+(delivery.minConfirmed||0)).filter(n=>delivery.legacy||n===delivery.minConfirmed||n===delivery.maxConfirmed).map(n=><option key={n} value={n}>{n} ta rasm</option>)}</select></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Kanalni tekshirdim, rasmlar soni to‘g‘ri.</label>
   <button className="competition-button primary" disabled={busy||!checked||confirmed===''} onClick={()=>void submit(true)}>Tasdiqlash va davom ettirish</button>
  </div>:<button className="competition-button primary" disabled={busy||!delivery||!!active||sent||delivery?.tokenConfigured===false} onClick={()=>void submit()}><Send size={15}/>{busy?'Saqlanmoqda…':sent?'Bu tur yuborilgan':active?'Yuborilmoqda…':delivery?.state==='failed'?'Qolgan rasmlarni yuborish':'Xabar yuborish'}</button>}
  <button className="competition-button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/>Holatni yangilash</button>
 </section>;
}
