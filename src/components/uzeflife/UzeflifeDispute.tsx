import React,{useEffect,useState} from 'react';
import {AlertTriangle,ImagePlus} from 'lucide-react';
import {getAuthHeaders} from '../../lib/customTournamentApi';
import type {UMatch} from '../../types/uzeflife';
import type {UAct} from './UzeflifeAdmin';

export async function screenshotBase64(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10000000)throw Error('10 MB gacha bo‘lgan JPG, PNG yoki WebP rasm tanlang.');
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=c.getContext('2d');if(!ctx)throw Error('Rasmni tayyorlab bo‘lmadi.');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0,c.width,c.height);const encoded=c.toDataURL('image/jpeg',0.7).split(',')[1];if(encoded.length>400000)throw Error('Rasm hajmi katta. Kichikroq skrinshot tanlang.');return encoded;}finally{bitmap.close();}
}
export function UzeflifeDispute({match:m,canDispute,canResolve,busy,act}:{match:UMatch;canDispute:boolean;canResolve:boolean;busy:boolean;act:UAct}){
 const [open,setOpen]=useState(false),[evidence,setEvidence]=useState<string|null>(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{let live=true,url='';setPreview('');if(m.dispute?.evidenceId){fetch(`/api/uzeflife/evidence/${encodeURIComponent(m.dispute.evidenceId)}`,{headers:getAuthHeaders()}).then(async r=>{if(!r.ok)throw Error('Skrinshotni yuklab bo‘lmadi.');return r.blob();}).then(blob=>{if(live){url=URL.createObjectURL(blob);setPreview(url);}}).catch(e=>{if(live)setError(e.message);});}return()=>{live=false;if(url)URL.revokeObjectURL(url);};},[m.dispute?.evidenceId]);
 return <section className="u-dialog-section space-y-3">
  {m.dispute&&<><h3 className="flex gap-2 items-center"><AlertTriangle size={16}/>{m.dispute.status==='open'?'Natija bahsli':'E’tiroz hal qilingan'}</h3><p className="text-xs whitespace-pre-wrap break-words">{m.dispute.reason}</p>{preview&&<a href={preview} target="_blank" rel="noreferrer"><img src={preview} className="u-evidence-preview" alt="Natijaga biriktirilgan skrinshot"/></a>}{m.dispute.resolution&&<p className="competition-note">Admin qarori: {m.dispute.resolution}</p>}</>}
  {error&&<p className="competition-note error" role="alert">{error}</p>}
  {canDispute&&m.dispute?.status!=='open'&&!open&&<button className="competition-button" disabled={busy} onClick={()=>setOpen(true)}><AlertTriangle size={14}/>Hisobga e’tiroz bildirish</button>}
  {canDispute&&open&&m.dispute?.status!=='open'&&<form className="space-y-3" onSubmit={async e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get('reason');if(await act('dispute',{matchId:m.id,reason,evidence})){setOpen(false);setEvidence(null);}}}>
   <label className="competition-field">E’tiroz sababi<textarea name="reason" required minLength={5} maxLength={1000} placeholder="Qaysi hisob noto‘g‘ri? Vaziyatni tushuntiring."/></label>
   <label className="competition-field"><span className="flex gap-2 items-center"><ImagePlus size={14}/>Skrinshot (ixtiyoriy)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||loading} onChange={async e=>{setError('');setEvidence(null);const file=e.target.files?.[0];if(!file)return;setLoading(true);try{setEvidence(await screenshotBase64(file));}catch(err:any){setError(err.message);}finally{setLoading(false);}}}/></label>
   {evidence&&<img className="u-evidence-preview" src={`data:image/jpeg;base64,${evidence}`} alt="Tanlangan skrinshot"/>}
   <div className="competition-actions"><button className="competition-button primary" disabled={busy||loading}>E’tirozni yuborish</button><button type="button" className="competition-button" onClick={()=>setOpen(false)}>Bekor qilish</button></div>
  </form>}
  {canResolve&&m.dispute?.status==='open'&&<form className="space-y-3" onSubmit={async e=>{e.preventDefault();await act('resolveDispute',{matchId:m.id,resolution:new FormData(e.currentTarget).get('resolution')});}}><label className="competition-field">Admin qarori<textarea name="resolution" required minLength={5} maxLength={1000} placeholder="Tekshiruv natijasini yozing. So‘ng to‘g‘ri hisobni kiriting."/></label><p className="competition-muted">Qaror saqlangach eski taklif bekor qilinadi. To‘g‘ri hisobni alohida tasdiqlang.</p><button className="competition-button primary" disabled={busy}>E’tirozni hal qilish</button></form>}
 </section>;
}
