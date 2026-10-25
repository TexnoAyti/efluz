import React,{useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,CheckCircle2,Layers,Swords,Trophy} from 'lucide-react';
import {TEAM_DIRECTORY_LIMIT,TEAM_LEAGUE_MAX_TEAMS,TEAM_PLAYOFF_SIZES,confirmedTeamMembers,teamTournamentKinds,type PreviewTeam,type TeamLeague,type TeamTournamentFormat,type TeamTournamentKind} from '../../types/teamLeaguePreview';
import {teamFormatLabels,teamFormatPreview,teamPoints} from '../../lib/teamLeagueEngine';
import {previewId} from '../../lib/teamLeaguePreviewApi';
import {CompetitionSteps} from '../CompetitionWorkspace';
import {TeamBadge} from './TeamBadge';
import {TeamLeagueAdministratorPicker,type TournamentAdministrator} from './TeamLeagueAdministrator';

export function TeamTournamentWizard({league,teams,busy,save,initialStep=1,onCreateTeam,recentTeamId,canAssignAdmin=true}:{canAssignAdmin?:boolean;onCreateTeam?:()=>void;recentTeamId?:string;initialStep?:1|2|3;league?:TeamLeague;teams:PreviewTeam[];busy:boolean;save:(body:unknown)=>void}){
 const [id]=useState(league?.id||previewId),[step,setStep]=useState(initialStep);
 const [name,setName]=useState(league?.name||''),[description,setDescription]=useState(league?.description||'');
 const [kind,setKind]=useState<TeamTournamentKind>(league?.competitionType||'CUSTOM'),[format,setFormat]=useState<TeamTournamentFormat>(league?.format||'LEAGUE');
 const [ids,setIds]=useState(league?.teamIds||[]),[countText,setCountText]=useState(String(league?.starterCount||1)),[targetText,setTargetText]=useState(String(league?.teamIds.length||2));
 const [reserveText,setReserveText]=useState(String(league?.reserveLimit??(league?Math.min(3,30-league.starterCount):0))),[rounds,setRounds]=useState<1|2>(league?.rounds||1),[qualifiers,setQualifiers]=useState(league?.qualifiers||2),[search,setSearch]=useState('');
 const initialPoints=teamPoints(league||{}),[winText,setWinText]=useState(String(initialPoints.win)),[drawText,setDrawText]=useState(String(initialPoints.draw)),[lossText,setLossText]=useState(String(initialPoints.loss));
 const [administrator,setAdministrator]=useState<TournamentAdministrator|null>(league?.adminUserId&&league.adminUserId!==league.ownerId?{id:league.adminUserId,name:league.adminName||league.adminUserId}:null);
 const numeric=(value:string)=>value===''?NaN:Number(value),count=numeric(countText),target=numeric(targetText),reserves=numeric(reserveText),points={win:numeric(winText),draw:numeric(drawText),loss:numeric(lossText)};
 const countValid=Number.isInteger(count)&&count>=1&&count<=30,targetValid=Number.isInteger(target)&&target>=2&&target<=TEAM_LEAGUE_MAX_TEAMS&&(format!=='PLAYOFF'||TEAM_PLAYOFF_SIZES.includes(target))&&(kind!=='SINGLE_MATCH'||target===2);
 const basicsValid=name.trim().length>=2&&countValid&&targetValid;
 const rulesValid=Number.isInteger(reserves)&&reserves>=0&&reserves<=30-count&&[points.win,points.draw,points.loss].every(n=>Number.isInteger(n)&&n>=0&&n<=10)&&points.win>points.draw&&points.draw>=points.loss;
 const eligible=(team:PreviewTeam)=>league&&!league.membershipRequired?team.members:confirmedTeamMembers(team);
 const ready=(team:PreviewTeam)=>eligible(team).length>=count&&eligible(team).some(m=>m.id===team.captainMemberId);
 const valid=basicsValid&&rulesValid&&ids.length===target&&ids.every(id=>teams.some(t=>t.id===id&&ready(t)))&&(format!=='LEAGUE_AND_PLAYOFF'||TEAM_PLAYOFF_SIZES.includes(qualifiers)&&qualifiers<=target);
 const preview=teamFormatPreview(targetValid?target:2,format,rounds,qualifiers);
 useEffect(()=>{if(recentTeamId){setIds(current=>current.includes(recentTeamId)||current.length>=(Number.isInteger(target)?target:TEAM_LEAGUE_MAX_TEAMS)?current:[...current,recentTeamId]);setSearch('');}},[recentTeamId]);
 const changeCount=(value:string)=>{setCountText(value);const next=Number(value);if(Number.isInteger(next)&&next>=1&&next<=30)setReserveText(current=>String(Math.min(Number(current)||0,30-next)));};
 const changeKind=(value:TeamTournamentKind)=>{setKind(value);if(value!=='CUSTOM'){if(!name.trim()||Object.values(teamTournamentKinds).some(label=>label===name))setName(teamTournamentKinds[value]);setFormat(value==='CUP'||value==='SINGLE_MATCH'?'PLAYOFF':value==='CHAMPIONS_LEAGUE'?'LEAGUE_AND_PLAYOFF':'LEAGUE');if(value==='SINGLE_MATCH'){setTargetText('2');setRounds(1);}}};
 const submit=(event:React.FormEvent)=>{event.preventDefault();if(step<3){if(step===1?basicsValid:valid)setStep((step+1) as 2|3);return;}if(valid)save({id,name,description,competitionType:kind,format,teamCount:target,teamIds:ids,starterCount:count,reserveLimit:reserves,points,rounds:kind==='SINGLE_MATCH'?1:rounds,qualifiers,...(canAssignAdmin?{adminUserId:administrator?.id||''}:{}),version:league?.version||0});};
 return <form onSubmit={submit}><fieldset disabled={busy} className="team-wizard-fields"><div className="team-wizard-body">
  <CompetitionSteps step={step} labels={['Turnir va o‘yin formati','Teamlar va qoidalar','Tasdiqlash']}/>
  <p className="competition-eyebrow">{step}/3 · {step===1?'Asosiy ma’lumotlar':step===2?'Teamlar va reglament':'Tekshirish va yaratish'}</p>
  {step===1&&<>
   <label className="competition-field">Turnir turi<select aria-label="Turnir turi" value={kind} onChange={e=>changeKind(e.target.value as TeamTournamentKind)}>{Object.entries(teamTournamentKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   {kind==='SINGLE_MATCH'&&<p className="competition-note">Aynan ikki team o‘rtasida bitta uchrashuv. 1v1 tanlasangiz, turnir bitta individual o‘yindan iborat bo‘ladi.</p>}
   {kind==='CHAMPIONS_LEAGUE'&&<p className="competition-note">Avval liga bosqichi, keyin eng yaxshi teamlar pley-offga chiqadi.</p>}
   <label className="competition-field">Turnir nomi<input required minLength={2} maxLength={60} autoFocus placeholder="Masalan, EFLUZ Team Cup" value={name} onChange={e=>setName(e.target.value)}/></label>
   <section className="competition-panel team-rule-settings"><h3 className="team-section-title">Nechta o‘yinchi o‘ynaydi?</h3><p className="competition-muted">Har uchrashuvda har bir teamdan nechta asosiy o‘yinchi qatnashishini tanlang.</p>
    <div className="team-rule-presets" role="group" aria-label="O‘yinchilar sonini tez tanlash">{[1,2,3,4,5,7,10,11].map(n=><button type="button" className={`competition-button ${count===n?'primary':''}`} aria-pressed={count===n} key={n} onClick={()=>changeCount(String(n))}>{n}v{n}</button>)}</div>
    <label className="competition-field">Asosiy tarkib (har teamdan)<input aria-label="Asosiy o‘yinchilar soni" type="number" min={1} max={30} required value={countText} onChange={e=>changeCount(e.target.value)}/></label>
    <p className="competition-muted">Istalgan son: 1–30. {countValid?`${count}v${count} — har teamdan ${count} o‘yinchi, bitta team uchrashuvida ${count} ta individual o‘yin.`:'1 dan 30 gacha butun son kiriting.'}</p>
   </section>
   <section className="competition-panel team-rule-settings"><h3 className="team-section-title">Nechta team qatnashadi?</h3>
    {kind!=='SINGLE_MATCH'&&<div className="team-rule-presets team-count-presets" role="group" aria-label="Teamlar sonini tez tanlash">{[2,4,8,16,32,64].map(n=><button type="button" className={`competition-button ${target===n?'primary':''}`} aria-pressed={target===n} key={n} onClick={()=>setTargetText(String(n))}>{n} team</button>)}</div>}
    <label className="competition-field">Qatnashuvchi teamlar soni<input aria-label="Qatnashuvchi teamlar soni" type="number" required min={2} max={64} readOnly={kind==='SINGLE_MATCH'} value={targetText} onChange={e=>setTargetText(e.target.value)}/></label>
    {kind==='SINGLE_MATCH'?<p className="competition-muted">Bitta uchrashuv uchun aynan 2 team tanlanadi.</p>:<p className="competition-muted">2–64 team. Pley-offda 2, 4, 8, 16, 32 yoki 64 team bo‘lishi kerak.</p>}
    {!targetValid&&<p role="alert" className="competition-note error">Tanlangan formatga mos teamlar sonini kiriting.</p>}
   </section>
   <div><h3 className="team-section-title">Turnir formati</h3><div className="team-format-options">{([['LEAGUE',Trophy,'Barcha teamlar o‘zaro o‘ynaydi.'],['PLAYOFF',Swords,'Har juftlikda bitta uchrashuv. G‘olib keyingi bosqichga chiqadi.'],['LEAGUE_AND_PLAYOFF',Layers,'Avval liga, keyin eng yaxshi teamlar pley-offda o‘ynaydi.']] as const).map(([value,Icon,detail])=><button type="button" key={value} className="team-format-option" aria-pressed={format===value} onClick={()=>{setFormat(value);if(kind!=='CUSTOM'&&value!==(kind==='CUP'||kind==='SINGLE_MATCH'?'PLAYOFF':kind==='CHAMPIONS_LEAGUE'?'LEAGUE_AND_PLAYOFF':'LEAGUE'))setKind('CUSTOM');}}><Icon size={21}/><span><strong>{teamFormatLabels[value]}</strong><p>{detail}</p></span>{format===value&&<CheckCircle2 size={18}/>}</button>)}</div></div>
   <label className="competition-field">Tavsif (ixtiyoriy)<textarea maxLength={1000} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   {canAssignAdmin&&<TeamLeagueAdministratorPicker value={administrator} onChange={setAdministrator} disabled={busy}/>}
  </>}
  {step===2&&<>
   <div className="team-task"><h3>{count}v{count} · {target} team</h3><p>Har uchrashuvda {count} ta individual o‘yin. Sardor asosiy tarkib va ruxsat etilgan zaxirani tanlaydi.</p><button type="button" className="competition-button mt-3" onClick={()=>setStep(1)}>O‘yinchilar yoki teamlar sonini o‘zgartirish</button></div>
   <section className="competition-panel team-rule-settings"><h3 className="team-section-title">Tarkib va taqvim</h3><div className="team-two-columns">
    <label className="competition-field">Zaxira limiti (har teamdan)<input aria-label="Zaxira limiti" type="number" min={0} max={30-count} required value={reserveText} onChange={e=>setReserveText(e.target.value)}/></label>
    {format!=='PLAYOFF'&&<label className="competition-field">Liga davralari<select aria-label="Liga davralari" value={rounds} onChange={e=>setRounds(Number(e.target.value) as 1|2)}><option value={1}>Bitta uchrashuv · 1 davra</option><option value={2}>Uy / safar · 2 davra</option></select></label>}
    {format==='LEAGUE_AND_PLAYOFF'&&<label className="competition-field">Pley-offga chiqadi<select aria-label="Pley-offga chiqadi" value={qualifiers} onChange={e=>setQualifiers(Number(e.target.value))}>{TEAM_PLAYOFF_SIZES.filter(n=>n<=target).map(n=><option key={n} value={n}>{n} team</option>)}</select></label>}
   </div><p className="competition-muted">0 — zaxirasiz. Asosiy tarkib va zaxira jami 30 o‘yinchidan oshmaydi. {format==='PLAYOFF'?'Pley-off juftliklari bitta uchrashuvdan o‘ynaladi.':''}</p></section>
   {format!=='PLAYOFF'&&<section className="competition-panel team-rule-settings"><h3 className="team-section-title">Ochko qoidalari</h3><div className="team-points-settings">{[['G‘alaba uchun ochko',winText,setWinText],['Durang uchun ochko',drawText,setDrawText],['Mag‘lubiyat uchun ochko',lossText,setLossText]].map(([label,value,change])=><label className="competition-field" key={label as string}>{label as string}<input aria-label={label as string} type="number" required min={0} max={10} value={value as string} onChange={e=>(change as (value:string)=>void)(e.target.value)}/></label>)}</div><p className="competition-muted">G‘alaba ochkosi durangdan ko‘p, durang ochkosi mag‘lubiyatdan kam bo‘lmasin.</p></section>}
   {!rulesValid&&<p role="alert" className="competition-note error">Zaxira va ochko qoidalarini tekshiring.</p>}
   <div className="team-between"><h3 className="team-section-title">Qatnashuvchi teamlar</h3><div className="team-row"><span className="team-status">{ids.length}/{target} tanlangan</span>{onCreateTeam&&<button type="button" className="competition-button" disabled={busy||teams.length>=TEAM_DIRECTORY_LIMIT||ids.length>=target} onClick={onCreateTeam}>+ Team qo‘shish</button>}</div></div>
   <label className="competition-field">Team qidirish<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Team nomi"/></label>
   <div className="team-pick-list">{teams.filter(t=>t.name.toLowerCase().includes(search.toLowerCase())).map(t=><label key={t.id} className={`team-picker ${ids.includes(t.id)?'selected':''}`}><input type="checkbox" checked={ids.includes(t.id)} disabled={busy||!ids.includes(t.id)&&ids.length>=target} onChange={e=>setIds(e.target.checked?[...ids,t.id]:ids.filter(id=>id!==t.id))}/><TeamBadge team={t}/><span><strong>{t.name}</strong><small>{eligible(t).length} qatnasha oladigan / {t.members.length} o‘yinchi · Sardor: {t.members.find(m=>m.id===t.captainMemberId)?.name||'—'}</small>{!ready(t)&&<small className="team-error-text">Kamida {count} tasdiqlangan o‘yinchi va sardor kerak</small>}</span></label>)}</div>
   {ids.length!==target&&<p className="competition-note">Aynan {target} team tanlang. Hozir {ids.length} ta tanlangan.</p>}
   {!teams.length&&<p className="competition-note">{onCreateTeam?'Shu oynaning o‘zida “Team qo‘shish” orqali team yarating.':'Avval TEAMS → Yangi team orqali team yarating va o‘yinchilarni tasdiqlang.'}</p>}
   {format==='LEAGUE_AND_PLAYOFF'&&qualifiers>target&&<p className="competition-note">Pley-offga chiqadiganlar sonini qayta tanlang.</p>}
  </>}
  {step===3&&<>
   <div className="team-task"><h3>{name}</h3><p>{kind==='SINGLE_MATCH'?'Bitta uchrashuv':teamFormatLabels[format]} · {target} team · {count}v{count}</p></div>
   <div className="competition-panel">{[['Turnir turi',teamTournamentKinds[kind]],['Administrator',administrator?.name||league?.adminName||'Loyiha egasi'],['Qatnashuvchi teamlar',target],['Har teamdan asosiy o‘yinchi',count],['Har teamdan zaxira',reserves],['Team uchrashuvlari',preview.matches],['Asosiy individual o‘yinlar',preview.matches*count],['Jami turlar / bosqichlar',preview.rounds],['Liga davrasi',format==='PLAYOFF'?'Bitta uchrashuvdan':rounds],['Pley-offga chiqadi',format==='LEAGUE_AND_PLAYOFF'?`${qualifiers} team`:'—'],['Ochko tizimi',format==='PLAYOFF'?'Yutgan team davom etadi':`G‘alaba ${points.win} · durang ${points.draw} · mag‘lubiyat ${points.loss}`]].map(([label,value])=><div className="team-summary-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <div className="team-statuses">{teams.filter(t=>ids.includes(t.id)).map(t=><span className="team-status" key={t.id}>{t.name}</span>)}</div>
   <p className="competition-note">Turnir avval tayyorlanayotgan holatda saqlanadi. Boshlashdan oldin barcha qoidalarni o‘zgartira olasiz. Boshlangach reglament yopiladi. {format!=='LEAGUE'?'Pley-off durangida hal qiluvchi o‘yin g‘olibi va izohi tasdiqlanadi.':''}</p>{description&&<p className="competition-muted">{description}</p>}
  </>}
 </div><footer className="team-wizard-footer"><button type="button" className="competition-button" disabled={busy||step===1} onClick={()=>setStep((step-1) as 1|2)}><ArrowLeft size={15}/>Ortga</button><button className="competition-button primary" disabled={busy||!(step===1?basicsValid:valid)}>{busy?'Saqlanmoqda…':step===3?(league?'O‘zgarishlarni saqlash':'Turnir yaratish'):'Davom etish'}{step<3&&<ArrowRight size={15}/>}</button></footer></fieldset></form>;
}
