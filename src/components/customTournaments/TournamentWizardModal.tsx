import {CompetitionSteps} from '../CompetitionWorkspace';
import {TournamentRulesSummary} from './TournamentRulesSummary';
import React, { useState, useEffect, useRef } from 'react';
import { X, Trophy, Layers, CheckCircle2, Ticket, Sparkles, AlertCircle, HelpCircle } from 'lucide-react';
import {
  CustomTournamentFormat,
  CustomTournamentLeagueScope,
  CustomTournamentVisibility,
  CustomTournamentSpectatorAccess,
  CustomTournamentPlayoffLegMode,
  CustomTournamentGroupStageMode,
  TournamentFormatPreview,
} from '../../types/customTournament';
import { generateTournamentPreview } from '../../lib/customTournamentEngine';
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TOP5_CLUBS, TOP5_LEAGUES } from '../../constants/top5Clubs';

interface TournamentWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTournamentCreated: (tournamentId: string) => void;
  initialStep?: 1 | 2 | 3;
}

export const TournamentWizardModal: React.FC<TournamentWizardModalProps> = ({
  isOpen,
  onClose,
  onTournamentCreated,
  initialStep = 1,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [isAdvancedMode, setIsAdvancedMode] = useState<boolean>(false);
  const submitting = useRef(false);
  const creationKey = useRef<string>('');
  const creationPayload = useRef<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ticket balance
  const [ticketBalance, setTicketBalance] = useState<number | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState<boolean>(true);

  // Form fields
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [format, setFormat] = useState<CustomTournamentFormat>('LEAGUE');
  const [leagueScope, setLeagueScope] = useState<CustomTournamentLeagueScope>('TOP5_ALL');
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [maxParticipants, setMaxParticipants] = useState<number>(8);
  const [visibility, setVisibility] = useState<CustomTournamentVisibility>('PUBLIC_OPEN');

  const [spectatorAccess, setSpectatorAccess] = useState<CustomTournamentSpectatorAccess>('PUBLIC_LINK');
  const participantLimit = leagueScope === 'TOP5_ALL' ? 32 : TOP5_CLUBS.filter(c => c.leagueId === selectedLeagueId).length;

  // Rules (Advanced)
  const [roundsCount, setRoundsCount] = useState<1 | 2>(1);
  const [playoffLegMode, setPlayoffLegMode] = useState<CustomTournamentPlayoffLegMode>('SINGLE_LEG');
  const [playoffQualifiersCount, setPlayoffQualifiersCount] = useState<2 | 4 | 8 | 16>(4);
  const [groupStageMode, setGroupStageMode] = useState<CustomTournamentGroupStageMode>('SINGLE_TABLE');
  const [groupsCount, setGroupsCount] = useState<2 | 4>(2);
  const [matchDurationHours, setMatchDurationHours] = useState<number>(36);

  const validParticipants=Number.isInteger(maxParticipants)&&maxParticipants>=4&&maxParticipants<=participantLimit;
  const preview = generateTournamentPreview(format, maxParticipants, {roundsCount,playoffLegMode,playoffQualifiersCount,groupStageMode,groupsCount,matchDurationHours});

  useEffect(() => {
    if (isOpen) {
      setStep(initialStep); setErrorMessage(null); setName(''); setDescription('');
      setFormat('LEAGUE'); setLeagueScope('TOP5_ALL'); setSelectedLeagueId('league-premier-league');
      setMaxParticipants(8); setVisibility('PUBLIC_OPEN'); setSpectatorAccess('PUBLIC_LINK');
      setRoundsCount(1); setPlayoffLegMode('SINGLE_LEG'); setPlayoffQualifiersCount(4);
      setGroupStageMode('SINGLE_TABLE'); setGroupsCount(2); setMatchDurationHours(36); setIsAdvancedMode(false);
      creationKey.current = crypto.randomUUID();
      creationPayload.current = '';
      fetchTicketBalance();
    }
  }, [isOpen]);

  useEffect(() => {
    if (maxParticipants > participantLimit) {setMaxParticipants(participantLimit);return;}
    if (!Number.isInteger(maxParticipants)||maxParticipants<4) return;
    if (groupsCount === 4 && maxParticipants < 8) setGroupsCount(2);
    const valid = [2, 4, 8, 16].filter(n => n <= maxParticipants && (groupStageMode !== 'GROUPS' || n % groupsCount === 0));
    if (!valid.includes(playoffQualifiersCount)) setPlayoffQualifiersCount(valid[0] as 2 | 4 | 8 | 16);
  }, [participantLimit, maxParticipants, groupsCount, groupStageMode, playoffQualifiersCount]);

  const fetchTicketBalance = async () => {
    try {
      setLoadingTickets(true);
      setTicketError(null);
      setTicketBalance(null);
      const account = await customTournamentApi.getTicketBalance();
      setTicketBalance(account.balance);
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Chipta balansini yuklab bo‘lmadi.');
    } finally {
      setLoadingTickets(false);
    }
  };

  if (!isOpen) return null;

  const handleCreateTournament = async () => {
    if (submitting.current||!name.trim()||!validParticipants) return;
    submitting.current=true;
    try {
      setIsLoading(true);
      setErrorMessage(null);

      // One authenticated, atomic create request
      const payload = {
          name,
          description,
          format,
          leagueScope,
          selectedLeagueId: leagueScope === 'SINGLE_LEAGUE' ? selectedLeagueId : undefined,
          maxParticipants,
          visibility,
          spectatorAccess,
          rules: {
            roundsCount,
            playoffLegMode,
            playoffQualifiersCount: format === 'LEAGUE_AND_PLAYOFF' ? playoffQualifiersCount : undefined,
            groupStageMode: format === 'LEAGUE_AND_PLAYOFF' ? groupStageMode : undefined,
            groupsCount: format === 'LEAGUE_AND_PLAYOFF' && groupStageMode === 'GROUPS' ? groupsCount : undefined,
            matchDurationHours,
          },
      };
      const signature = JSON.stringify(payload);
      if (creationPayload.current && creationPayload.current !== signature) creationKey.current = crypto.randomUUID();
      creationPayload.current = signature;
      const tournament = await customTournamentApi.createTournament({...payload, idempotencyKey: creationKey.current});
      const tournamentId = tournament.id;
      onTournamentCreated(tournamentId);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Xatolik yuz berdi.');
    } finally {
      submitting.current=false;
      setIsLoading(false);
    }
  };

  const formats = [
    {id:'LEAGUE',label:'Liga',description:'Har bir klub boshqalar bilan o‘ynaydi. Ochko bo‘yicha g‘olib aniqlanadi.'},
    {id:'PLAYOFF',label:'Pley-off',description:'Mag‘lub klub chiqib ketadi. G‘olib finalgacha davom etadi.'},
    {id:'LEAGUE_AND_PLAYOFF',label:'Liga + pley-off',description:'Avval liga yoki guruhlar, keyin eng yaxshilar pley-offga chiqadi.'},
  ] as const;
  return <div className="efl-custom-tournaments tourney-dialog-backdrop">
    <section role="dialog" aria-modal="true" aria-label="Yangi turnir yaratish" className="tourney-dialog">
      <header><div><p className="tourney-eyebrow">{step} / 3 · {step===1?'Asosiy ma’lumot':step===2?'Qatnashish qoidalari':'Tekshirish'}</p><h2>Turnir yaratish</h2></div><button aria-label="Turnir yaratishni yopish" disabled={isLoading} onClick={onClose} className="tourney-button !p-2"><X size={18}/></button></header>
      <div className="tourney-dialog-body">
        <CompetitionSteps step={step} labels={['Ma’lumotlar','Qatnashish qoidalari','Tasdiqlash']}/>
        {errorMessage&&<p role="alert" className="tourney-note error">{errorMessage}</p>}
        {step===1&&<>
          <label className="tourney-field">Turnir nomi<input autoFocus required maxLength={60} placeholder="Masalan: Do‘stlar kubogi" value={name} onChange={e=>setName(e.target.value)}/></label>
          <label className="tourney-field">Qisqa tavsif · ixtiyoriy<textarea maxLength={160} rows={2} value={description} placeholder="Ishtirokchilar bilishi kerak bo‘lgan ma’lumot" onChange={e=>setDescription(e.target.value)}/></label>
          <div><p className="tourney-field mb-2">Format</p><div className="tourney-choice-grid">{formats.map(f=><button key={f.id} aria-pressed={format===f.id} onClick={()=>setFormat(f.id)} className="tourney-choice"><Trophy size={18}/><div><strong>{f.label}</strong><p>{f.description}</p></div></button>)}</div></div>
          <p className="tourney-note">O‘zingiz ham turnir ochilgach, boshqalar kabi klub tanlab qo‘shilasiz.</p>
        </>}
        {step===2&&<>
          <div className="tourney-meta-grid"><label className="tourney-field">Qatnashchilar limiti<input type="number" min={4} max={participantLimit} step={1} value={maxParticipants||''} onChange={e=>setMaxParticipants(Number(e.target.value))}/></label><label className="tourney-field">O‘yin uchun muddat<select value={matchDurationHours} onChange={e=>setMatchDurationHours(Number(e.target.value))}>{[12,24,36,48,72].map(h=><option key={h} value={h}>{h} soat</option>)}</select></label></div>
          {!validParticipants&&<p role="alert" className="tourney-note error">Qatnashchilar soni 4–{participantLimit} oralig‘idagi butun son bo‘lsin.</p>}
          <label className="tourney-field">Klublar bazasi<select value={leagueScope==='TOP5_ALL'?'ALL':selectedLeagueId} onChange={e=>{setLeagueScope(e.target.value==='ALL'?'TOP5_ALL':'SINGLE_LEAGUE');if(e.target.value!=='ALL')setSelectedLeagueId(e.target.value);}}><option value="ALL">Top-5 barcha ligalar</option>{TOP5_LEAGUES.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="tourney-field">Kim qo‘shila oladi?<select value={visibility} onChange={e=>setVisibility(e.target.value as CustomTournamentVisibility)}><option value="PUBLIC_OPEN">Hamma · erkin qo‘shilish</option><option value="PUBLIC_MODERATED">Hamma · tashkilotchi tasdig‘i bilan</option><option value="PRIVATE">Faqat taklif havolasi orqali</option></select></label>
          <label className="tourney-field">Kim kuzata oladi?<select value={spectatorAccess} onChange={e=>setSpectatorAccess(e.target.value as CustomTournamentSpectatorAccess)}><option value="PUBLIC_LINK">Havolasi bor kuzatuvchilar</option><option value="MEMBERS_ONLY">Faqat turnir a’zolari</option></select></label>
          {format==='LEAGUE_AND_PLAYOFF'&&<label className="tourney-field">Pley-offga chiqadigan klublar<select value={playoffQualifiersCount} onChange={e=>setPlayoffQualifiersCount(Number(e.target.value) as 2|4|8|16)}>{[2,4,8,16].filter(n=>n<=maxParticipants&&(groupStageMode!=='GROUPS'||n%groupsCount===0)).map(n=><option key={n} value={n}>{n} klub</option>)}</select></label>}
          <details open={isAdvancedMode} onToggle={e=>setIsAdvancedMode(e.currentTarget.open)}><summary className="tourney-muted cursor-pointer min-h-[44px] flex items-center">Qo‘shimcha reglament</summary><div className="grid gap-3 pt-3">
            {format!=='PLAYOFF'&&<label className="tourney-field">Liga o‘yinlari<select value={roundsCount} onChange={e=>setRoundsCount(Number(e.target.value) as 1|2)}><option value={1}>Har raqib bilan 1 o‘yin</option><option value={2}>Har raqib bilan 2 o‘yin</option></select></label>}
            {format!=='LEAGUE'&&<label className="tourney-field">Pley-off juftligi<select value={playoffLegMode} onChange={e=>setPlayoffLegMode(e.target.value as CustomTournamentPlayoffLegMode)}><option value="SINGLE_LEG">1 o‘yin</option><option value="TWO_LEG">2 o‘yin · final 1 o‘yin</option></select></label>}
            {format==='LEAGUE_AND_PLAYOFF'&&<><label className="tourney-field">Liga bosqichi<select value={groupStageMode} onChange={e=>setGroupStageMode(e.target.value as CustomTournamentGroupStageMode)}><option value="SINGLE_TABLE">Umumiy jadval</option><option value="GROUPS">Guruhlar</option></select></label>{groupStageMode==='GROUPS'&&<label className="tourney-field">Guruhlar soni<select value={groupsCount} onChange={e=>setGroupsCount(Number(e.target.value) as 2|4)}><option value={2}>2 guruh</option>{maxParticipants>=8&&<option value={4}>4 guruh</option>}</select></label>}</>}
          </div></details>
        </>}
        {step===3&&<>
          <h3 className="text-xl font-bold break-words">{name||'Turnir rejasi'}</h3>
          {[['Format',formats.find(f=>f.id===format)?.label],['Qatnashchilar',`${maxParticipants} klubgacha`],['Qo‘shilish',visibility==='PRIVATE'?'Taklif bilan':visibility==='PUBLIC_MODERATED'?'Tasdiq bilan':'Ochiq'],['Kuzatish',spectatorAccess==='MEMBERS_ONLY'?'Faqat a’zolar':'Havola orqali'],['Taqvim',`${preview.totalMatches} o‘yin · ${preview.totalStagesOrRounds} tur`]].map(([label,value])=><div key={label} className="tourney-summary-row"><span>{label}</span><strong>{value}</strong></div>)}
          <TournamentRulesSummary format={format} rules={{roundsCount,playoffLegMode,playoffQualifiersCount,groupStageMode,groupsCount,matchDurationHours}}/>
          <p className="tourney-muted">Taqvim to‘liq {maxParticipants} klub uchun hisoblandi. Kamroq klub bilan boshlasangiz, taqvim moslashadi.</p>
          <div className="tourney-note"><strong className="block">Yaratish — 1 ticket</strong><span>Qabul darhol ochiladi. Turnirni keyin boshqaruvdan boshlaysiz. Qatnashish bepul.</span></div>
          {loadingTickets?<p className="tourney-muted">Ticket balansi tekshirilmoqda…</p>:ticketError?<div className="tourney-note error">{ticketError}<button onClick={fetchTicketBalance} className="tourney-button mt-2">Qayta urinish</button></div>:<p className="tourney-muted">Balansingiz: {ticketBalance} ticket.{ticketBalance===0&&<> Yangi ticket uchun <a className="underline" href="https://t.me/texnoadmin" target="_blank" rel="noreferrer">@texnoadmin</a> bilan bog‘laning.</>}</p>}
        </>}
      </div>
      <footer><button disabled={isLoading} className="tourney-button" onClick={()=>step===1?onClose():setStep(step-1 as 1|2|3)}>{step===1?'Bekor qilish':'Orqaga'}</button>{step<3?<button className="tourney-button primary" disabled={!name.trim()||(step===2&&!validParticipants)} onClick={()=>setStep(step+1 as 1|2|3)}>Davom etish</button>:<button className="tourney-button primary" disabled={!validParticipants||!name.trim()||isLoading||loadingTickets||!!ticketError||ticketBalance===null||ticketBalance<1} onClick={handleCreateTournament}>{isLoading?'Yaratilmoqda…':'Yaratish · 1 ticket'}</button>}</footer>
    </section>
  </div>;
};
