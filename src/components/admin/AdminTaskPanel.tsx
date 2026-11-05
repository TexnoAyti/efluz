import {useEffect,useState} from 'react';
import {RefreshCw,ClipboardList,ExternalLink} from 'lucide-react';
import {api} from '../../lib/api';
import {ADMIN_TASK_GROUPS,ADMIN_TASK_PRIORITIES,type AdminTaskGroup,type AdminTaskPriority,type AdminTaskPage} from '../../types/adminTasks';
import './admin-tasks.css';

export function AdminTaskPanel(){
 const [priority,setPriority]=useState<AdminTaskPriority|''>(''),[group,setGroup]=useState<AdminTaskGroup|''>(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [data,setData]=useState<AdminTaskPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let current=true;setLoading(true);setError('');
  api.getTelegramAiTasks({...(priority?{priority}:{}),...(group?{group}:{}),offset}).then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError('Vazifalarni yuklab bo‘lmadi. Qayta yangilang.');}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;};
 },[priority,group,offset,revision]);
 return <section className="admin-task-panel" aria-label="Vazifalar markazi" aria-busy={loading}>
  <header><div><h3><ClipboardList size={20}/>Vazifalar markazi</h3><p>Haqiqiy holatdan tuziladi. Masala hal bo‘lsa, yangilashda ro‘yxatdan chiqadi.</p></div><button type="button" disabled={loading} onClick={()=>setRevision(n=>n+1)} aria-label="Vazifalarni yangilash"><RefreshCw size={17}/><span>Yangilash</span></button></header>
  {data&&<div className="admin-task-totals"><span><strong>{data.allTotal}</strong> faol vazifa</span><span>{data.summary.URGENT} shoshilinch</span><span>{data.summary.HIGH} muhim</span><span>{data.summary.NORMAL} rejali</span></div>}
  <div className="admin-task-filters"><label>Muhimlik<select aria-label="Muhimlik" value={priority} onChange={e=>{setPriority(e.target.value as AdminTaskPriority|'');setOffset(0);}}><option value="">Barchasi</option>{Object.entries(ADMIN_TASK_PRIORITIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Bo‘lim<select aria-label="Bo‘lim" value={group} onChange={e=>{setGroup(e.target.value as AdminTaskGroup|'');setOffset(0);}}><option value="">Barcha bo‘limlar</option>{Object.entries(ADMIN_TASK_GROUPS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  {error&&<p role="alert">{error}</p>}
  <div role="status" aria-live="polite">{loading?'Vazifalar tekshirilmoqda…':data?`${data.total} ta mos vazifa · ${new Date(data.generatedAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})} (Toshkent)`:''}</div>
  {data&&(!data.complete||data.stale||data.unavailable.length>0)&&<p className="admin-task-warning">Ma’lumotlar to‘liq tekshirilmagan. {data.unavailable.length?`O‘qilmadi: ${data.unavailable.join(', ')}.`:''} Yangilashdan oldin vazifani joriy holat bilan solishtiring.</p>}
  {!loading&&!error&&data?.total===0&&<p>Bu filtrda faol vazifa aniqlanmadi.</p>}
  {!loading&&!error&&data&&<ol className="admin-task-list">{data.items.map(task=><li key={task.id}>
   <div className="admin-task-badges"><span data-priority={task.priority}>{ADMIN_TASK_PRIORITIES[task.priority]}</span><span>{ADMIN_TASK_GROUPS[task.group]}</span>{!task.verified&&<span>Qayta tekshirish kerak</span>}</div>
   <h4>{task.title}</h4><p>{task.reason}</p><p className="admin-task-next"><strong>Nima qilish kerak:</strong> {task.nextStep}</p><p>Qayerda: {task.where}</p>
   {task.dueAt&&<p>Muddat: {new Date(task.dueAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})} (Toshkent)</p>}
   {task.url&&<a href={task.url} target="_blank" rel="noreferrer">O‘yinni ochish <ExternalLink size={15}/></a>}
  </li>)}</ol>}
  {!loading&&!error&&data&&<nav aria-label="Vazifa sahifalari"><button type="button" disabled={loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-30))}>Oldingi</button><span>{data.total?`${offset+1}–${Math.min(offset+30,data.total)} / ${data.total}`:'0'}</span><button type="button" disabled={loading||data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>Keyingi</button></nav>}
  {!loading&&!error&&data&&<details><summary>{data.catalog.length} turdagi vazifa kuzatiladi</summary><ul>{data.catalog.map(c=><li key={c.kind}>{ADMIN_TASK_GROUPS[c.group]} · {c.name}</li>)}</ul></details>}
 </section>;
}
