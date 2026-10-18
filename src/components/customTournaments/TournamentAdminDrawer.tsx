import {TournamentRulesFields} from './TournamentRulesFields';
import {tournamentRulesError} from '../../lib/customTournamentRules';
import {generateTournamentPreview} from '../../lib/customTournamentEngine';
import {isCustomMatchReady,customMatchNeedsPenalties} from '../../lib/customTournamentMatches';
import React, {useEffect, useRef, useState} from 'react';
import {X, Copy, Check, Shield, Play, Users, Swords, Settings, History, AlertTriangle, RefreshCw} from 'lucide-react';
import type {CustomTournament, CustomTournamentParticipant, CustomTournamentFixture, CustomTournamentAuditLog} from '../../types/customTournament';
import {customTournamentApi} from '../../lib/customTournamentApi';
import {tournamentTelegramLink} from '../../lib/customTournamentLinks';
import {auditActionLabel, fixtureStatusLabel, tournamentFormatLabel, tournamentStatusLabel, tournamentStartBlocker, fixtureStageLabel} from '../../lib/customTournamentLabels';
import {TOP5_CLUBS} from '../../constants/top5Clubs';

type Tab = 'overview'|'participants'|'matches'|'settings'|'history';
interface Props {
  isOpen:boolean; onClose:()=>void; tournament:CustomTournament;
  participants:CustomTournamentParticipant[]; fixtures:CustomTournamentFixture[];
  onRefresh:()=>void|Promise<void>; isOrganizer?:boolean; initialTab?:Tab; initialFixtureId?:string;
}
const inputClass = 'w-full min-w-0 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200';
const buttonClass = 'min-h-[44px] px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 whitespace-normal break-words';
const cardClass = 'min-w-0 p-4 rounded-2xl border border-slate-800 bg-slate-950/60 space-y-3';
const personLabel = (p?:{username?:string;firstName?:string}) => p?.username ? '@'+p.username : p?.firstName || 'Qatnashchi';

export function TournamentAdminDrawer({isOpen,onClose,tournament:t,participants,fixtures,onRefresh,isOrganizer=false,initialTab='overview',initialFixtureId=''}:Props) {
  const [tab,setTab]=useState<Tab>(initialTab), [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{error:boolean;text:string}|null>(null);
  const [confirmAction,setConfirmAction]=useState<{text:string;run:()=>Promise<unknown>;success:string}|null>(null);
  const [copied,setCopied]=useState('');
  const [logs,setLogs]=useState<CustomTournamentAuditLog[]>([]), [logsLoading,setLogsLoading]=useState(false), [logsError,setLogsError]=useState('');
  const [managementUsers,setManagementUsers]=useState<Array<{id:string;username:string;firstName:string}>>([]);
  const [managementError,setManagementError]=useState(''), [assistantId,setAssistantId]=useState('');
  const [participantSearch,setParticipantSearch]=useState(''), [matchSearch,setMatchSearch]=useState('');
  const [matchFilter,setMatchFilter]=useState('ATTENTION'), [page,setPage]=useState(0);
  const [selectedId,setSelectedId]=useState(initialFixtureId), [home,setHome]=useState(()=>String(fixtures.find(f=>f.id===initialFixtureId)?.homeScore??0)), [away,setAway]=useState(()=>String(fixtures.find(f=>f.id===initialFixtureId)?.awayScore??0));
  const [penHome,setPenHome]=useState(()=>{const v=fixtures.find(f=>f.id===initialFixtureId)?.penaltyHomeScore;return v==null?'':String(v);}), [penAway,setPenAway]=useState(()=>{const v=fixtures.find(f=>f.id===initialFixtureId)?.penaltyAwayScore;return v==null?'':String(v);}), [note,setNote]=useState('');
  const scoreForm=useRef<HTMLFormElement>(null), confirmationPanel=useRef<HTMLDivElement>(null), dialog=useRef<HTMLElement>(null);
  const [settings,setSettings]=useState(()=>({name:t.name,description:t.description||'',maxParticipants:t.maxParticipants,visibility:t.visibility,spectatorAccess:t.spectatorAccess,matchDurationHours:t.rules.matchDurationHours,rules:{...t.rules}}));
  useEffect(()=>{setSettings({name:t.name,description:t.description||'',maxParticipants:t.maxParticipants,visibility:t.visibility,spectatorAccess:t.spectatorAccess,matchDurationHours:t.rules.matchDurationHours,rules:{...t.rules}});},[t.id,t.updatedAt]);
  useEffect(()=>{setPage(0);},[matchSearch,matchFilter]);
  useEffect(()=>{if(selectedId)scoreForm.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[selectedId]);
  useEffect(()=>{if(confirmAction)confirmationPanel.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[confirmAction]);
  useEffect(()=>{
    if(!isOpen||tab!=='history')return;
    let active=true;setLogsLoading(true);setLogsError('');
    customTournamentApi.getAuditLogs(t.id).then(data=>{if(active)setLogs(data);}).catch(error=>{if(active)setLogsError(error.message);}).finally(()=>{if(active)setLogsLoading(false);});
    return ()=>{active=false;};
  },[isOpen,tab,t.id,t.updatedAt]);
  const loadManagementUsers=async()=>{
    setManagementError('');
    try{setManagementUsers((await customTournamentApi.getManagementUsers(t.id)).users);}
    catch(error){setManagementError(error instanceof Error?error.message:'Yordamchilarni yuklab bo‘lmadi.');}
  };
  useEffect(()=>{if(isOpen&&(tab==='settings'||tab==='history'))loadManagementUsers();},[isOpen,tab,t.id,t.updatedAt]);
  useEffect(()=>{
    if(!isOpen)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busy)onClose();
      if(event.key==='Tab'){
        const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')||[]).filter(el=>el.getClientRects().length>0);
        const first=elements[0],last=elements.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
  },[isOpen,busy,onClose]);
  useEffect(()=>{if(!isOpen)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>previous?.focus();},[isOpen]);
  if(!isOpen)return null;
  const run=async(action:()=>Promise<unknown>,success:string)=>{
    if(busy)return;setBusy(true);setMessage(null);
    try{await action();setConfirmAction(null);await onRefresh();setMessage({error:false,text:success});}
    catch(error){setMessage({error:true,text:error instanceof Error?error.message:'Amal bajarilmadi.'});}
    finally{setBusy(false);}
  };
  const copy=async(value:string,key:string)=>{
    try{await navigator.clipboard.writeText(value);setCopied(key);}
    catch{setMessage({error:true,text:'Nusxalab bo‘lmadi. Havolani quyidagi maydondan nusxalang.'});}
  };
  const registered=participants.filter(p=>p.status==='REGISTERED'), pending=participants.filter(p=>p.status==='PENDING_APPROVAL');
  const blocker=tournamentStartBlocker(t,participants);
  const canEdit=t.status==='REGISTRATION_OPEN';
  const settingsError=tournamentRulesError(t.format,settings.maxParticipants,{...settings.rules,matchDurationHours:settings.matchDurationHours});
  const settingsPreview=generateTournamentPreview(t.format,settings.maxParticipants,settings.rules);
  const limit=t.leagueScope==='SINGLE_LEAGUE'?TOP5_CLUBS.filter(c=>c.leagueId===t.selectedLeagueId).length:32;
  const selected=fixtures.find(f=>f.id===selectedId&&isCustomMatchReady(f,fixtures));
  const needsPenalties=!!selected&&customMatchNeedsPenalties(selected,fixtures,Number(home),Number(away));
  const editableMatches=fixtures.filter(f=>isCustomMatchReady(f,fixtures));
  const filteredMatches=editableMatches.filter(f=>(matchFilter==='ALL'||(matchFilter==='ATTENTION'?['DISPUTED','PENDING_CONFIRMATION'].includes(f.status):f.status===matchFilter))&&`${f.homeClubName} ${f.awayClubName}`.toLowerCase().includes(matchSearch.trim().toLowerCase()));
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filteredMatches.length/20)-1));
  const selectMatch=(f:CustomTournamentFixture)=>{setSelectedId(f.id);setHome(String(f.homeScore??0));setAway(String(f.awayScore??0));setPenHome(f.penaltyHomeScore==null?'':String(f.penaltyHomeScore));setPenAway(f.penaltyAwayScore==null?'':String(f.penaltyAwayScore));setNote('');setMessage(null);};
  const saveScore=(event:React.FormEvent)=>{
    event.preventDefault();if(!selected)return;
    const scores=[home,away],penalties=[penHome,penAway];
    if(scores.some(x=>!/^\d{1,2}$/.test(x))||(needsPenalties&&(penalties.some(x=>!/^\d{1,2}$/.test(x))||Number(penHome)===Number(penAway)))){setMessage({error:true,text:'Hisoblar 0–99 oralig‘ida bo‘lsin. Penalti kiritilsa, ikkala tomon va g‘olib ko‘rsatilishi kerak.'});return;}
    run(async()=>{await customTournamentApi.correctMatchScore(t.id,selected.id,{homeScore:Number(home),awayScore:Number(away),penaltyHomeScore:!needsPenalties||penHome===''?undefined:Number(penHome),penaltyAwayScore:!needsPenalties||penAway===''?undefined:Number(penAway),note:note.trim()||'Turnir boshqaruvida rasmiy natija kiritildi'});setSelectedId('');},'Natija saqlandi. Jadval yangilandi.');
  };
  const tabs=[{id:'overview',label:'Umumiy',Icon:Play},{id:'participants',label:'Qatnashchilar',Icon:Users},{id:'matches',label:'O‘yinlar',Icon:Swords},{id:'settings',label:'Sozlamalar',Icon:Settings},{id:'history',label:'Tarix',Icon:History}] as const;
  return <div className="efl-custom-tournaments tourney-dialog-backdrop tourney-management-overlay !p-0 fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tournament-management-title" className="tourney-dialog !rounded-none !max-h-none !h-[100dvh] !max-w-xl w-full min-w-0 sm:max-w-xl h-[100dvh] bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden shadow-2xl">
      <header className="shrink-0 flex items-start gap-3 p-4 border-b border-slate-800">
        <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
        <div className="min-w-0 flex-1"><h2 id="tournament-management-title" className="text-base font-bold text-slate-100">Turnir boshqaruvi</h2><p className="text-sm text-slate-400 break-words [overflow-wrap:anywhere]">{t.name}</p><p className="text-xs text-emerald-400 mt-1">{isOrganizer?'Tashkilotchi':'Yordamchi'} · {tournamentStatusLabel[t.status]}</p></div>
        <button type="button" aria-label="Boshqaruvni yopish" disabled={busy} onClick={onClose} className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400"><X className="w-5 h-5" /></button>
      </header>
      <nav aria-label="Turnir boshqaruv bo‘limlari" className="shrink-0 flex overflow-x-auto gap-1 p-2 border-b border-slate-800">
        {tabs.map(({id,label,Icon})=><button key={id} type="button" disabled={busy} aria-pressed={tab===id} onClick={()=>{setTab(id);setMessage(null);setConfirmAction(null);}} className={`shrink-0 min-h-[44px] rounded-xl px-3 py-2 flex items-center justify-center gap-2 text-xs font-semibold ${tab===id?'bg-emerald-500/15 text-emerald-400':'text-slate-400 hover:bg-slate-800'}`}><span className="whitespace-nowrap">{label}{id==='participants'&&pending.length>0?` (${pending.length})`:''}</span></button>)}
      </nav>
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {message&&<div role={message.error?'alert':'status'} className={`text-sm p-3 rounded-xl break-words ${message.error?'bg-rose-500/10 text-rose-400':'bg-emerald-500/10 text-emerald-400'}`}>{message.text}</div>}
        {confirmAction&&<div ref={confirmationPanel} className="p-4 border border-amber-500/40 rounded-2xl space-y-3"><p className="text-sm text-slate-200 break-words">{confirmAction.text}</p><div className="flex gap-2 flex-wrap"><button disabled={busy} onClick={()=>run(confirmAction.run,confirmAction.success)} className={`${buttonClass} bg-emerald-500 text-slate-950`}>{busy?'Bajarilmoqda…':'Tasdiqlash'}</button><button disabled={busy} onClick={()=>setConfirmAction(null)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Qaytish</button></div></div>}
        {tab==='overview'&&<>
          <div className="tourney-task"><p className="tourney-eyebrow">Keyingi qadam</p><h3>{t.status==='REGISTRATION_OPEN'?(pending.length?`${pending.length} arizani ko‘rib chiqing`:registered.length<4?'Taklif havolasini ulashing':'Turnirni boshlashga tayyorlaning'):t.status==='IN_PROGRESS'?'O‘yinlar va natijalarni kuzating':tournamentStatusLabel[t.status]}</h3><p>{t.status==='REGISTRATION_OPEN'?`${registered.length} klub tasdiqlangan, ${pending.length} ariza kutilmoqda. Boshlash uchun kamida 4 klub kerak.`:`${fixtures.filter(f=>f.status==='CONFIRMED').length} natija tasdiqlangan. ${fixtures.filter(f=>['DISPUTED','PENDING_CONFIRMATION'].includes(f.status)).length} natijani ko‘rib chiqish kerak.`}</p><div className="tourney-action-row">{pending.length>0&&<button onClick={()=>setTab('participants')} className="tourney-button">Arizalar</button>}{t.status==='IN_PROGRESS'&&<button onClick={()=>setTab('matches')} className="tourney-button">O‘yinlar</button>}</div></div>
          <div className={cardClass}><h3 className="font-bold text-sm text-slate-100">{tournamentFormatLabel[t.format]}</h3><p className="text-sm text-slate-400">{participants.length} / {t.maxParticipants} o‘rin band. Har o‘yin uchun {t.rules.matchDurationHours} soat.</p>
            {t.status==='DRAFT'&&isOrganizer&&<><p className="text-sm text-slate-400">Eski qoralama. Qabulni ochish 1 ticket sarflaydi.</p><button disabled={busy} onClick={()=>run(()=>customTournamentApi.publishTournament(t.id,`publish_${t.id}`),'Qabul ochildi.')} className={`${buttonClass} bg-emerald-500 text-slate-950`}>Qabulni ochish (1 ticket)</button></>}
            {isOrganizer&&['REGISTRATION_OPEN','STARTING'].includes(t.status)&&<>
              {blocker&&<p className="text-sm text-amber-400">{blocker}</p>}
              <button disabled={busy||!!blocker} onClick={()=>setConfirmAction({text:`${registered.length} klub bilan turnir boshlansinmi? Qabul yopiladi va taqvim yaratiladi.`,run:()=>customTournamentApi.startTournament(t.id),success:'Turnir boshlandi. Taqvim tayyor.'})} className={`${buttonClass} w-full bg-emerald-500 text-slate-950`}>{t.status==='STARTING'?'Taqvimni tayyorlashni davom ettirish':'Turnirni boshlash'}</button>
            </>}
            {t.status==='STARTING'&&<p className="text-sm text-amber-400">Taqvim tayyorlanmoqda. Jarayon uzilgan bo‘lsa, tashkilotchi davom ettirishi mumkin.</p>}
            {t.status==='COMPLETED'&&<p className="text-sm text-emerald-400">G‘olib: {t.winnerClubName||'Belgilanmagan'}</p>}
            {t.status==='CANCELLED'&&<p className="text-sm text-rose-400">Turnir bekor qilingan. Qabul va natija kiritish yopiq.</p>}
            <button disabled={busy} type="button" onClick={()=>run(async()=>{},'Ma’lumotlar yangilandi.')} className={`${buttonClass} w-full bg-slate-800 text-slate-200 inline-flex items-center justify-center gap-2`}><RefreshCw className="w-4 h-4" />Yangilash</button>
          </div>
          {t.status==='REGISTRATION_OPEN'&&<div className={cardClass}><h3 className="text-sm font-bold text-slate-100">Qatnashish havolasi</h3><p className="text-xs text-slate-400">Telegram Mini App orqali klub tanlab qo‘shilish.</p><input readOnly aria-label="Qatnashish havolasi" value={tournamentTelegramLink(t.id,t.inviteToken)} className={inputClass} /><button type="button" onClick={()=>copy(tournamentTelegramLink(t.id,t.inviteToken),'invite')} className={`${buttonClass} w-full bg-slate-800 text-slate-200 flex items-center justify-center gap-2`}>{copied==='invite'?<Check className="w-4 h-4" />:<Copy className="w-4 h-4" />}{copied==='invite'?'Nusxa olindi':'Havolani nusxalash'}</button></div>}
          {t.spectatorAccess==='PUBLIC_LINK'&&t.status!=='DRAFT'&&<div className={cardClass}><h3 className="text-sm font-bold text-slate-100">Kuzatish havolasi</h3><input readOnly aria-label="Kuzatish havolasi" value={tournamentTelegramLink(t.id,t.spectatorToken)} className={inputClass} /><button type="button" onClick={()=>copy(tournamentTelegramLink(t.id,t.spectatorToken),'spectator')} className={`${buttonClass} w-full bg-slate-800 text-slate-200`}>{copied==='spectator'?'Nusxa olindi':'Havolani nusxalash'}</button></div>}
        </>}
        {tab==='participants'&&<>
          <input aria-label="Qatnashchi qidirish" placeholder="Ism yoki klub bo‘yicha qidirish" value={participantSearch} onChange={e=>setParticipantSearch(e.target.value)} className={inputClass} />
          <p className="text-xs text-slate-400">{registered.length} tasdiqlangan · {pending.length} ariza. Turnir boshlangach, qatnashchilar ro‘yxati o‘zgarmaydi.</p>
          {participants.filter(p=>`${p.firstName||''} ${p.username||''} ${p.clubName}`.toLowerCase().includes(participantSearch.trim().toLowerCase())).map(p=><div key={p.id} className={cardClass}>
            <div className="min-w-0"><h3 className="text-sm font-bold text-slate-100 break-words">{p.clubName}</h3><p className="text-sm text-slate-400 break-words [overflow-wrap:anywhere]">{personLabel(p)}</p><p className={`text-xs mt-1 ${p.status==='PENDING_APPROVAL'?'text-amber-400':'text-emerald-400'}`}>{p.status==='PENDING_APPROVAL'?'Ariza kutilmoqda':'Tasdiqlangan'}{t.assistantAdminIds.includes(p.userId)?' · Yordamchi':''}</p></div>
            {canEdit&&<div className="grid grid-cols-2 gap-2">{p.status==='PENDING_APPROVAL'?<><button disabled={busy} onClick={()=>run(()=>customTournamentApi.reviewParticipant(t.id,p.userId,'APPROVE'),'Ariza tasdiqlandi.')} className={`${buttonClass} bg-emerald-500 text-slate-950`}>Tasdiqlash</button><button disabled={busy} onClick={()=>setConfirmAction({text:`${p.clubName} arizasi rad etilsinmi? Klub va o‘rin bo‘shatiladi.`,run:()=>customTournamentApi.reviewParticipant(t.id,p.userId,'REJECT'),success:'Ariza rad etildi.'})} className={`${buttonClass} bg-rose-500/10 text-rose-400`}>Rad etish</button></>:<button disabled={busy} onClick={()=>setConfirmAction({text:`${personLabel(p)} turnirdan chiqarilsinmi? ${p.clubName} bo‘shatiladi.`,run:()=>customTournamentApi.removeParticipant(t.id,p.userId),success:'Qatnashchi chiqarildi. Klub bo‘shatildi.'})} className={`${buttonClass} col-span-2 bg-rose-500/10 text-rose-400`}>Turnirdan chiqarish</button>}</div>}
          </div>)}
          {participants.length===0&&<p className="text-sm text-slate-400">Hali qatnashchilar yo‘q. Taklif havolasini ulashing.</p>}
        </>}
        {tab==='matches'&&<>
          {!['IN_PROGRESS','COMPLETED'].includes(t.status)?<p className="text-sm text-slate-400">O‘yinlar turnir boshlangach boshqariladi.</p>:<>
            {selected&&<form ref={scoreForm} onSubmit={saveScore} className={cardClass}>
              <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 text-sm font-bold text-slate-100 break-words">{selected.homeClubName} — {selected.awayClubName}</h3><button type="button" aria-label="Natija oynasini yopish" onClick={()=>setSelectedId('')} className="min-h-[44px] min-w-[44px] shrink-0 text-slate-400"><X className="w-4 h-4 mx-auto" /></button></div>
              <p className="text-xs text-slate-400">{fixtureStatusLabel[selected.status]} · {fixtureStageLabel[selected.stage]} · Tur {selected.roundOrMatchday}{t.rules.playoffLegMode==='TWO_LEG'?` · ${selected.leg}-o‘yin`:''}</p>
              {selected.proofUrl&&/^https?:\/\//i.test(selected.proofUrl)&&<a href={selected.proofUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-400 underline">Yuborilgan dalilni ochish</a>}
              <div className="grid grid-cols-2 gap-2"><label className="min-w-0 text-xs text-slate-400">Mezbon gollari<input required type="number" min={0} max={99} step={1} value={home} onChange={e=>setHome(e.target.value)} className={inputClass} /></label><label className="min-w-0 text-xs text-slate-400">Mehmon gollari<input required type="number" min={0} max={99} step={1} value={away} onChange={e=>setAway(e.target.value)} className={inputClass} /></label></div>
              {needsPenalties&&<><p className="text-xs text-slate-400">Hal qiluvchi durang uchun penaltilar. Oddiy hisobdan alohida kiriting.</p><div className="grid grid-cols-2 gap-2"><label className="min-w-0 text-xs text-slate-400">Mezbon penaltilari<input type="number" min={0} max={99} step={1} value={penHome} onChange={e=>setPenHome(e.target.value)} className={inputClass} /></label><label className="min-w-0 text-xs text-slate-400">Mehmon penaltilari<input type="number" min={0} max={99} step={1} value={penAway} onChange={e=>setPenAway(e.target.value)} className={inputClass} /></label></div></>}
              <label className="block text-xs text-slate-400">Qaror izohi<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={2} className={inputClass} /></label>
              <p className="text-xs text-slate-400">Rasmiy hisob darhol tasdiqlanadi va boshqaruv tarixiga yoziladi.</p><button disabled={busy} className={`${buttonClass} w-full bg-emerald-500 text-slate-950`}>{busy?'Saqlanmoqda…':'Rasmiy natijani saqlash'}</button>
            </form>}
            <input aria-label="O‘yin qidirish" placeholder="Klub bo‘yicha qidirish" value={matchSearch} onChange={e=>setMatchSearch(e.target.value)} className={inputClass} />
            <select aria-label="O‘yin holati" value={matchFilter} onChange={e=>setMatchFilter(e.target.value)} className={inputClass}><option value="ATTENTION">Tasdiq kutilmoqda va nizoli</option><option value="ALL">Barcha tayyor juftliklar</option><option value="SCHEDULED">Kutilayotgan o‘yinlar</option><option value="CONFIRMED">Tasdiqlangan natijalar</option></select>
            {filteredMatches.slice(currentPage*20,currentPage*20+20).map(f=><button key={f.id} type="button" disabled={busy} onClick={()=>selectMatch(f)} className={`${cardClass} w-full text-left disabled:opacity-40`}><p className="text-xs text-slate-400">{fixtureStageLabel[f.stage]} · Tur {f.roundOrMatchday} · {fixtureStatusLabel[f.status]}{t.rules.playoffLegMode==='TWO_LEG'?` · ${f.leg}-o‘yin`:''}</p><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm text-slate-100"><span className="break-words">{f.homeClubName}</span><strong className="whitespace-nowrap">{f.homeScore??'–'} : {f.awayScore??'–'}</strong><span className="break-words text-right">{f.awayClubName}</span></div></button>)}
            {filteredMatches.length===0&&<p className="text-sm text-slate-400">Bu filtrda o‘yin yo‘q. Boshqa holatni tanlang.</p>}
            {filteredMatches.length>20&&<div className="flex flex-wrap items-center justify-between gap-2"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Oldingi</button><span className="text-xs text-slate-400">{currentPage+1} / {Math.ceil(filteredMatches.length/20)}</span><button disabled={(currentPage+1)*20>=filteredMatches.length} onClick={()=>setPage(currentPage+1)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Keyingi</button></div>}
          </>}
        </>}
        {tab==='settings'&&<>
          {isOrganizer?<form className={cardClass} onSubmit={e=>{e.preventDefault();if(settingsError){setMessage({error:true,text:settingsError});return;}run(()=>customTournamentApi.updateSettings(t.id,settings),'Sozlamalar saqlandi.');}}>
            <h3 className="font-bold text-sm text-slate-100">Turnir sozlamalari</h3><p className="text-xs text-slate-400">{canEdit?'Format va klublar bazasi o‘zgarmaydi. Davra, guruh va pley-off qoidalarini turnir boshlanishidan oldin tahrirlang.':'Turnir boshlangan yoki yopilgan. Sozlamalar tahriri yopiq.'}</p>
            <fieldset disabled={!canEdit||busy} className="min-w-0 space-y-3 disabled:opacity-60">
              <label className="block text-xs text-slate-400">Turnir nomi<input required maxLength={60} value={settings.name} onChange={e=>setSettings({...settings,name:e.target.value})} className={inputClass} /></label>
              <label className="block text-xs text-slate-400">Tavsif<textarea rows={3} maxLength={500} value={settings.description} onChange={e=>setSettings({...settings,description:e.target.value})} className={inputClass} /></label>
              <div className="grid grid-cols-2 gap-2"><label className="min-w-0 text-xs text-slate-400">O‘rinlar soni<input type="number" min={Math.max(4,participants.length)} max={limit} required value={settings.maxParticipants} onChange={e=>setSettings({...settings,maxParticipants:Number(e.target.value)})} className={inputClass} /></label><label className="min-w-0 text-xs text-slate-400">O‘yin muddati (soat)<input type="number" min={1} max={168} required value={settings.matchDurationHours} onChange={e=>setSettings({...settings,matchDurationHours:Number(e.target.value)})} className={inputClass} /></label></div>
              <label className="block text-xs text-slate-400">Qo‘shilish<select value={settings.visibility} onChange={e=>setSettings({...settings,visibility:e.target.value as CustomTournament['visibility']})} className={inputClass}><option value="PUBLIC_OPEN">Ochiq</option><option value="PUBLIC_MODERATED">Ariza bilan</option><option value="PRIVATE">Taklif bilan, yopiq</option></select></label>
              <label className="block text-xs text-slate-400">Kuzatish<select value={settings.spectatorAccess} onChange={e=>setSettings({...settings,spectatorAccess:e.target.value as CustomTournament['spectatorAccess']})} className={inputClass}><option value="PUBLIC_LINK">Havola orqali</option><option value="MEMBERS_ONLY">Faqat a’zolar</option></select></label>
              <TournamentRulesFields format={t.format} maxParticipants={settings.maxParticipants} rules={settings.rules} onChange={rules=>setSettings({...settings,rules})} inputClass={inputClass}/>
              {settingsError?<p role="alert" className="text-xs text-rose-400">{settingsError}</p>:<p className="text-xs text-slate-400">To‘liq {settings.maxParticipants} klub bilan: {settingsPreview.totalMatches} o‘yin · {settingsPreview.totalStagesOrRounds} tur/bosqich. Taqvim boshlashda tuziladi.</p>}
              <button disabled={!!settingsError} className={`${buttonClass} w-full bg-emerald-500 text-slate-950`}>Sozlamalarni saqlash</button>
            </fieldset>
          </form>:<p className="text-sm text-slate-400">Sozlamalarni faqat turnir tashkilotchisi o‘zgartiradi.</p>}
          <div className={cardClass}><h3 className="font-bold text-sm text-slate-100">Yordamchilar</h3><p className="text-xs text-slate-400">Arizalar, qatnashchilar va natijalarni boshqaradi. Sozlamalar va bekor qilish tashkilotchida qoladi.</p>
            {managementError&&<p role="alert" className="text-xs text-rose-400">{managementError}<button type="button" onClick={loadManagementUsers} className={`${buttonClass} underline`}>Qayta urinish</button></p>}
            {t.assistantAdminIds.length===0&&<p className="text-sm text-slate-400">Yordamchi tayinlanmagan.</p>}
            {t.assistantAdminIds.map(id=><div key={id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 text-sm text-slate-200 break-words [overflow-wrap:anywhere]">{personLabel(managementUsers.find(u=>u.id===id)||participants.find(p=>p.userId===id))}</span>{isOrganizer&&<button disabled={busy} onClick={()=>run(()=>customTournamentApi.updateAssistants(t.id,id,'REMOVE'),'Yordamchi olib tashlandi.')} className={`${buttonClass} text-rose-400`}>Olib tashlash</button>}</div>)}
            {isOrganizer&&!['COMPLETED','CANCELLED'].includes(t.status)&&<><label className="block text-xs text-slate-400">Qatnashchilar orasidan yordamchi<select value={assistantId} onChange={e=>setAssistantId(e.target.value)} className={inputClass}><option value="">Qatnashchini tanlang</option>{registered.filter(p=>p.userId!==t.organizerUserId&&!t.assistantAdminIds.includes(p.userId)).map(p=><option key={p.id} value={p.userId}>{personLabel(p)} · {p.clubName}</option>)}</select></label><button disabled={busy||!assistantId} onClick={()=>run(async()=>{await customTournamentApi.updateAssistants(t.id,assistantId,'ADD');setAssistantId('');},'Yordamchi tayinlandi.')} className={`${buttonClass} w-full bg-slate-800 text-slate-200`}>Yordamchi tayinlash</button></>}
          </div>
          {isOrganizer&&['DRAFT','REGISTRATION_OPEN','IN_PROGRESS'].includes(t.status)&&<div className="p-4 rounded-2xl border border-rose-500/30 space-y-3"><h3 className="text-sm font-bold text-rose-400">Turnirni bekor qilish</h3><p className="text-xs text-slate-400">Qabul va natija kiritish yopiladi. Mavjud natijalar saqlanadi. Ticket avtomatik qaytarilmaydi.</p><button disabled={busy} onClick={()=>setConfirmAction({text:'Turnir bekor qilinsinmi? Ushbu turnirni davom ettirish yopiladi.',run:()=>customTournamentApi.cancelTournament(t.id),success:'Turnir bekor qilindi.'})} className={`${buttonClass} w-full bg-rose-500/10 text-rose-400`}>Bekor qilish</button></div>}
        </>}
        {tab==='history'&&<>
          <h3 className="font-bold text-sm text-slate-100">Boshqaruv tarixi</h3>
          {logsLoading?<p className="text-sm text-slate-400">Yuklanmoqda…</p>:logsError?<p role="alert" className="text-sm text-rose-400">{logsError}</p>:logs.length===0?<p className="text-sm text-slate-400">Hali yozuv yo‘q.</p>:[...logs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(log=><div key={log.id} className={cardClass}><h4 className="text-sm font-semibold text-slate-100 break-words">{auditActionLabel[log.action]||'Boshqaruv amali'}</h4><p className="text-xs text-slate-400">{new Date(log.createdAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}</p><p className="text-xs text-slate-400 break-words">{managementUsers.find(u=>u.id===log.performedByUserId)||participants.find(p=>p.userId===log.performedByUserId)?personLabel(managementUsers.find(u=>u.id===log.performedByUserId)||participants.find(p=>p.userId===log.performedByUserId)):'Boshqaruvchi'}</p>{log.details?.clubName&&<p className="text-sm text-slate-200 break-words">{log.details.clubName}</p>}{log.details?.note&&<p className="text-sm text-slate-200 break-words [overflow-wrap:anywhere]">{String(log.details.note)}</p>}</div>)}
        </>}
      </div>
    </section>
  </div>;
}
