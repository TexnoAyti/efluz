import React,{useEffect,useState} from 'react';
import { seasonOpsApi } from '../../lib/seasonOpsApi';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';

const labels:Record<string,string>={
  SUPER_CUP_PLANS_REQUIRED:'Superkuboklar formati va saralashi hali tayyor emas',
  SOURCE_SEASON_ONGOING:'1-mavsum hali yakunlanmagan',START_DATE_REQUIRED:'Boshlanish sanasi belgilanmagan',DRAFT_NOT_SAVED_OR_OUTDATED:'Joriy reja saqlanishi kerak',RULE_VERIFICATION_REQUIRED:'Yakuniy reglament tekshirilishi kerak',CUP_RULE_VERIFICATION_REQUIRED:'Kubok reglamenti tekshirilishi kerak',CUP_PARTICIPANTS_MISSING:'Kubokning to‘liq qatnashchilari yetishmaydi',UEFA_ACCESS_LIST_REQUIRED:'UEFA kirish va saralash yo‘llari tasdiqlanishi kerak',UEFA_PARTICIPANTS_MISSING:'36 ta UEFA qatnashchisi to‘liq emas',RUNTIME_TRANSITION_REQUIRED:'Yangi mavsumni jonli tizimga ulash hali tugallanmagan',
};
const names=new Map<string,string>([
  ...EFL_SECOND_SEASON.leagues.map(l=>[l.id,l.name] as [string,string]),
  ...EFL_SECOND_SEASON.superCups.map(c=>[c.id,c.name] as [string,string]),
  ...EFL_SECOND_SEASON.domesticCups.map(c=>[c.id,c.name] as [string,string]),
  ...EFL_SECOND_SEASON.europeanCompetitions.map(c=>[c.id,c.name] as [string,string]),
]);
const errorMessage=(message:string)=>message==='DRAFT_REVISION_CONFLICT'?'Reja boshqa oynada yangilangan. Yangilashni bosing.':message==='DRAFT_NOT_SAVED_OR_OUTDATED'?'Avval joriy rejani saqlang.':message==='INVALID_START_DATE'?'Sanani to‘g‘ri kiriting.':message==='MAIN_ADMIN_REQUIRED'?'Bu bo‘lim faqat asosiy admin uchun.':'Ma’lumotni olish yoki saqlash amalga oshmadi. Qayta urinib ko‘ring.';
export function SeasonPreparationWorkbench(){
  const [open,setOpen]=useState(false),[data,setData]=useState<any>(null),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){setBusy(true);setError('');try{const result=await seasonOpsApi.preparation();setData(result);setDate(result.draft?.startDate||'');}catch(e:any){setError(errorMessage(e.message));}finally{setBusy(false);}}
  useEffect(()=>{if(open)void load();},[open]);
  async function save(){setBusy(true);setError('');setNotice('');try{const result=await seasonOpsApi.savePreparation(date||null,data?.draft?.revision||0);setData(result);setNotice('2-mavsum rejasi saqlandi.');}catch(e:any){setError(errorMessage(e.message));}finally{setBusy(false);}}
  async function stage(){setBusy(true);setError('');setNotice('');try{const result=await seasonOpsApi.stagePreparation(data?.package?.revision||0,data?.draft?.revision||0);setData(result);setNotice('Taqvim va kuboklar tayyorgarlik paketi saqlandi.');}catch(e:any){setError(errorMessage(e.message));}finally{setBusy(false);}}
  return <section className="rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface)] p-4 text-[var(--efl-text)]">
    <button type="button" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls="season-preparation-workbench" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-bold"><span>EFL · 2-mavsumni tayyorlash</span><span aria-hidden="true">{open?'−':'+'}</span></button>
    {open&&<div id="season-preparation-workbench" className="space-y-4 pt-3">
      <p className="text-xs leading-relaxed text-[var(--efl-text-2)]">Rejani saqlang va boshlashdan oldingi shartlarni tekshiring. Hozirgi holat: tayyorgarlik.</p>
      {data&&<>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[[data.readiness.counts.leagues,'liga'],[data.readiness.counts.clubs,'klub'],[data.readiness.counts.cups,'milliy kubok'],[data.readiness.counts.superCups,'superkubok'],[data.readiness.counts.europeanCompetitions,'UEFA turniri']].map(([count,label])=><div key={label} className="rounded-xl bg-[var(--efl-surface-2)] p-3"><strong className="block text-base">{count}</strong>{label}</div>)}</div>
        <p className="text-xs text-[var(--efl-text-2)]">Teng ochko qoidalari tekshirilgan: {data.readiness.counts.verifiedRankingRules}/{data.readiness.counts.leagues}. Saqlangan reja: {data.draft?`v${data.draft.revision}`:'hali yo‘q'}.</p>
        <label className="block text-xs font-semibold" htmlFor="season-two-start-date">Rejalashtirilgan boshlanish kuni</label>
        <input id="season-two-start-date" type="date" disabled={busy} value={date} onChange={event=>setDate(event.target.value)} className="min-h-11 max-w-full rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] px-3 text-sm"/>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={save} className="min-h-11 rounded-xl bg-[var(--efl-primary)] px-4 text-xs font-bold text-white disabled:opacity-50">Rejani saqlash</button><button type="button" disabled={busy} onClick={load} className="min-h-11 rounded-xl border border-[var(--efl-border)] px-4 text-xs disabled:opacity-50">Yangilash</button></div>
        <div className="rounded-xl border border-[var(--efl-border)] p-3 space-y-2">
          <p className="text-xs font-bold">Taqvim va kuboklar paketi</p>
          <p className="text-xs leading-relaxed text-[var(--efl-text-2)]">9 liga, 2984 liga o‘yini, 159 kubok o‘yini sxemasi va 9 superkubok. Qur’a va saralash natijalari mavsum davomida aniqlanadi.</p>
          {data.package&&<p className="text-xs">Paket v{data.package.revision} · {data.package.current?'joriy rejaga mos':'reja o‘zgargan, qayta tayyorlang'}</p>}
          <button type="button" disabled={busy||!data.draft||data.draft.fingerprint!==data.readiness.fingerprint} onClick={stage} className="min-h-11 rounded-xl bg-[var(--efl-primary)] px-4 text-xs font-bold text-white disabled:opacity-50">Paketni tayyorlash</button>
          <p className="text-xs leading-relaxed text-[var(--efl-text-2)]">Avval rejani saqlang. Bu paket faol o‘yinlarni yaratmaydi va mavsumni boshlamaydi.</p>
        </div>
        <details className="rounded-xl border border-[var(--efl-border)] p-3"><summary className="min-h-11 cursor-pointer text-xs font-bold">Boshlash uchun qolgan shartlar ({data.readiness.blockers.length})</summary><ul className="space-y-2 pt-2">{data.readiness.blockers.map((block:any)=><li key={block.code+block.subject} className="text-xs leading-relaxed"><strong>{names.get(block.subject)||'Mavsum'}</strong> — {labels[block.code]||block.code}</li>)}</ul></details>
      </>}
      {busy&&<p role="status" className="text-xs">Tekshirilmoqda…</p>}{error&&<p role="alert" className="text-xs text-[var(--efl-text)]">{error}</p>}{error&&!data&&<button type="button" disabled={busy} onClick={load} className="min-h-11 rounded-xl border border-[var(--efl-border)] px-4 text-xs">Qayta urinish</button>}{notice&&<p role="status" className="text-xs">{notice}</p>}
    </div>}
  </section>;
}
