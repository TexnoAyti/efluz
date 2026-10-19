import {CompetitionTabs} from '../CompetitionChrome';
import {CompetitionRounds, CompetitionFixtureCard, CompetitionStandings, type StandingsView} from '../CompetitionContent';
import {TournamentRulesSummary} from './TournamentRulesSummary';
import {isCustomMatchReady,customMatchNeedsPenalties,customScheduleView} from '../../lib/customTournamentMatches';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Trophy,
  Users,
  Calendar,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Globe,
  Settings,
  Share2,
  ChevronRight,
  LogOut,
  UploadCloud,
  X,
  Swords,
} from 'lucide-react';
import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentStandingsRow,
} from '../../types/customTournament';
import { CustomPlayoffBracket } from './CustomPlayoffBracket';
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TournamentAdminDrawer } from './TournamentAdminDrawer';
import { ClubCrest } from '../ClubCrest';
import { TournamentClubPicker } from './TournamentClubPicker';
import {tournamentStatusLabel,fixtureStageLabel,fixtureStatusLabel} from '../../lib/customTournamentLabels';
import {TournamentOverview} from './TournamentOverview';
import { useAuth } from '../../context/AuthContext';

interface TournamentDetailViewProps {
  tournamentId: string;
  inviteToken?: string;
  onBack: () => void;
}

export const TournamentDetailView: React.FC<TournamentDetailViewProps> = ({
  tournamentId,
  inviteToken,
  onBack,
}) => {
  const { user } = useAuth();
  const requestSequence = useRef(0);
  const lastLoadedAt=useRef(0);
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures' | 'participants' | 'rules'>('standings');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [tournament, setTournament] = useState<CustomTournament | null>(null);
  const [participants, setParticipants] = useState<CustomTournamentParticipant[]>([]);
  const [fixtures, setFixtures] = useState<CustomTournamentFixture[]>([]);
  const [standings, setStandings] = useState<CustomTournamentStandingsRow[] | undefined>();
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [tableView,setTableView] = useState<StandingsView>('short');
  const [selectedRound, setSelectedRound] = useState('');
  const [onlyMyMatches,setOnlyMyMatches]=useState(false);
  const [fixtureGroup,setFixtureGroup]=useState<number|undefined>();
  const [canManage, setCanManage] = useState(false);
  const [canJoin, setCanJoin] = useState(false);

  // Modals
  const [showAdminDrawer, setShowAdminDrawer] = useState(false);
  const [adminFixtureId,setAdminFixtureId]=useState('');
  const [scoreError,setScoreError]=useState<string|null>(null);
  const [adminTab,setAdminTab] = useState<'overview'|'participants'|'matches'>('overview');
  const [showClubPickerModal, setShowClubPickerModal] = useState(false);
  const [selectedMatchForScore, setSelectedMatchForScore] = useState<CustomTournamentFixture | null>(null);

  // Score submission form
  const [submitHomeScore, setSubmitHomeScore] = useState<number>(0);
  const [submitAwayScore, setSubmitAwayScore] = useState<number>(0);
  const [submitPenHome, setSubmitPenHome] = useState<string>('');
  const [submitPenAway, setSubmitPenAway] = useState<string>('');
  const [submitProofUrl, setSubmitProofUrl] = useState<string>('');
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);

  // Club claim search
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimingClubId, setClaimingClubId] = useState<string | null>(null);

  const loadData = async () => {
    lastLoadedAt.current=Date.now();
    const sequence = ++requestSequence.current;
    try {
      setErrorMessage(null);
      const res = await customTournamentApi.getTournamentDetails(tournamentId, inviteToken);
      if (sequence !== requestSequence.current) return;
      setTournament(res.tournament);
      setParticipants(res.participants);
      setFixtures(res.fixtures);
      setStandings(res.standings);
      setCanManage(res.canManage);
      setCanJoin(res.canJoin);
    } catch (err: any) {
      if (sequence === requestSequence.current) setErrorMessage(err.message || 'Turnir ma’lumotlarini yuklab bo‘lmadi.');
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadData();
    return () => { requestSequence.current++; };
  }, [tournamentId, inviteToken, user?.id]);

  useEffect(()=>{
    const refreshOnReturn=()=>{
      if(document.visibilityState!=='visible'||showAdminDrawer||showClubPickerModal||selectedMatchForScore||Date.now()-lastLoadedAt.current<15000)return;
      loadData();
    };
    window.addEventListener('focus',refreshOnReturn);
    document.addEventListener('visibilitychange',refreshOnReturn);
    return()=>{window.removeEventListener('focus',refreshOnReturn);document.removeEventListener('visibilitychange',refreshOnReturn);};
  },[tournamentId,inviteToken,user?.id,showAdminDrawer,showClubPickerModal,selectedMatchForScore]);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-[var(--efl-text-2)] space-y-3">
        <div className="w-8 h-8 border-2 border-[var(--efl-primary)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs">Turnir yuklanmoqda...</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <p className="text-sm font-bold text-rose-300">{errorMessage || 'Turnir topilmadi.'}</p>
        <button type="button" onClick={loadData} className="min-h-[44px] px-4 py-2 rounded-xl bg-[var(--efl-primary)] text-white text-xs font-bold">Qayta urinish</button>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-[var(--efl-surface-2)] text-[var(--efl-text)] text-xs font-bold hover:bg-slate-700 transition-colors"
        >
          Orqaga qaytish
        </button>
      </div>
    );
  }

  const myParticipant = user ? participants.find((p) => p.userId === user.id) : undefined;
  const isJoined = Boolean(myParticipant);

  const groupIndexes = [...new Set((standings || []).map(r => r.groupIndex).filter((g): g is number => g !== undefined))].sort();
  const displayedStandings = (standings || []).filter(r => !groupIndexes.length || r.groupIndex === selectedGroup);
  const schedule=customScheduleView(fixtures,{userId:user?.id,mine:onlyMyMatches,group:fixtureGroup,round:selectedRound});
  const rounds=schedule.rounds,displayedFixtures=schedule.fixtures;

  const handleClaimClub = async (clubId: string) => {
    if (claimingClubId) return;
    setClaimError(null);
    try {
      setClaimingClubId(clubId);
      await customTournamentApi.joinClub(tournament.id, clubId, inviteToken);
      setShowClubPickerModal(false);
      await loadData();
    } catch (err: any) {
      setClaimError(err.message || 'Klubni band qilib bo‘lmadi.');
    } finally {
      setClaimingClubId(null);
    }
  };

  const handleLeaveTournament = async () => {
    if (!confirm('Turnirdan chiqmoqchimisiz? Tanlagan klubingiz bo‘shatiladi.')) return;
    try {
      await customTournamentApi.leaveTournament(tournament.id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Chiqib ketishda xatolik.');
    }
  };

  const handleOpenScoreModal = (fix: CustomTournamentFixture) => {
    if(!isCustomMatchReady(fix,fixtures))return;
    if(canManage){setAdminFixtureId(fix.id);setAdminTab('matches');setShowAdminDrawer(true);return;}
    setScoreError(null);
    setSelectedMatchForScore(fix);
    setSubmitHomeScore(fix.homeScore ?? 0);
    setSubmitAwayScore(fix.awayScore ?? 0);
    setSubmitPenHome(fix.penaltyHomeScore !== null && fix.penaltyHomeScore !== undefined ? String(fix.penaltyHomeScore) : '');
    setSubmitPenAway(fix.penaltyAwayScore !== null && fix.penaltyAwayScore !== undefined ? String(fix.penaltyAwayScore) : '');
    setSubmitProofUrl(fix.proofUrl || '');
  };

  const handleSubmitScore = async () => {
    if (!selectedMatchForScore||isSubmittingScore) return;
    setScoreError(null);
    try {
      setIsSubmittingScore(true);
      await customTournamentApi.submitMatchResult(tournament.id, selectedMatchForScore.id, {
        homeScore: Number(submitHomeScore),
        awayScore: Number(submitAwayScore),
        penaltyHomeScore: scoreNeedsPenalties&&submitPenHome !== '' ? Number(submitPenHome) : undefined,
        penaltyAwayScore: scoreNeedsPenalties&&submitPenAway !== '' ? Number(submitPenAway) : undefined,
        proofUrl: submitProofUrl || undefined,
      });
      setSelectedMatchForScore(null);
      loadData();
    } catch (err: any) {
      setScoreError(err.message || 'Hisobni saqlashda xatolik.');
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const scoreNeedsPenalties=!!selectedMatchForScore&&customMatchNeedsPenalties(selectedMatchForScore,fixtures,submitHomeScore,submitAwayScore);
  return (
    <div className="efl-custom-tournaments tourney-page competition-detail">
      {errorMessage && <div role="alert" className="p-3 rounded-xl text-xs text-rose-400">{errorMessage}<button type="button" onClick={loadData} className="min-h-[44px] px-3 underline">Qayta urinish</button></div>}
      <TournamentOverview tournament={tournament} participants={participants} fixtures={fixtures} userId={user?.id} canManage={canManage} canJoin={canJoin} onBack={onBack} onManage={tab=>{setAdminFixtureId('');setAdminTab(tab);setShowAdminDrawer(true);}} onJoin={()=>{setClaimError(null);setShowClubPickerModal(true);}} onMatch={handleOpenScoreModal} onRefresh={loadData}/>
      {myParticipant&&tournament.status==='REGISTRATION_OPEN'&&<button onClick={handleLeaveTournament} className="tourney-muted min-h-[44px] underline justify-self-start">Turnirdan chiqish</button>}
      {/* Sub Tabs */}
      <CompetitionTabs<'standings'|'fixtures'|'participants'|'rules'> value={activeTab} onChange={setActiveTab} label="Turnir bo‘limlari" items={[{id:'participants',label:'Klublar',icon:Users},{id:'fixtures',label:'O‘yinlar',icon:Swords},{id:'standings',label:tournament.format==='PLAYOFF'?'Pley-off':'Jadval',icon:Trophy},{id:'rules',label:'Reglament',icon:Shield}]}/>

      {/* TAB 1: STANDINGS OR PLAYOFF BRACKET */}
      {activeTab === 'standings' && (
        <div className="space-y-4">
          {tournament.format === 'PLAYOFF' ? (
            <div className="p-4 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] space-y-3">
              <h3 className="font-bold text-[var(--efl-text)] text-sm">Pley-off Juftliklari</h3>
              {fixtures.length === 0 ? (
                <p className="text-xs text-[var(--efl-muted)] italic p-6 text-center">Turnir boshlangach juftliklar tuziladi.</p>
              ) : (
                <CustomPlayoffBracket fixtures={fixtures} />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {groupIndexes.length>0&&<CompetitionRounds<number> items={groupIndexes.map(g=>({id:g,label:`${String.fromCharCode(65+g)} guruhi`}))} value={selectedGroup} onChange={setSelectedGroup} label="Guruh" ariaLabel="Jadval guruhi"/>}
              <CompetitionStandings title={`${tournament.name}${groupIndexes.length?` · ${String.fromCharCode(65+selectedGroup)} guruhi`:''}`} view={tableView} onViewChange={setTableView} rows={displayedStandings.map(row=>({...row,id:row.clubId,highlighted:row.userId===user?.id&&!!user,
                form:fixtures.filter(f=>f.status==='CONFIRMED'&&!f.stage.startsWith('PLAYOFF')&&(f.homeClubId===row.clubId||f.awayClubId===row.clubId)).sort((a,b)=>a.roundOrMatchday-b.roundOrMatchday||a.leg-b.leg).map(f=>{const home=f.homeClubId===row.clubId,own=home?f.homeScore!:f.awayScore!,other=home?f.awayScore!:f.homeScore!;return own>other?'W':own<other?'L':'D';}),
                identity:<><ClubCrest clubId={row.clubId} logoUrl={row.clubLogoUrl} name={row.clubName} shortName={row.clubShortName} size="xs" className="w-5 h-5 shrink-0"/><span className="efl-standings-club-name" title={row.clubName}>{row.clubName}</span></>
              }))}/>
            </div>
          )}
        </div>
      )}

      {activeTab === 'standings' && tournament.format === 'LEAGUE_AND_PLAYOFF' && fixtures.some(f => f.stage.startsWith('PLAYOFF_')) && (
        <CustomPlayoffBracket fixtures={fixtures} />
      )}

      {/* TAB 2: FIXTURES */}
      {activeTab === 'fixtures' && (
        <div className="space-y-3">
          {myParticipant&&<div className="tourney-tabs" aria-label="O‘yinlar filtri"><button aria-pressed={!onlyMyMatches} onClick={()=>{setOnlyMyMatches(false);setSelectedRound('');}}>Barcha o‘yinlar</button><button aria-pressed={onlyMyMatches} onClick={()=>{setOnlyMyMatches(true);setSelectedRound('');}}>Mening o‘yinlarim</button></div>}
          {tournament.rules.groupStageMode==='GROUPS'&&<label className="block text-xs text-[var(--efl-text-2)]">Guruh bo‘yicha<select className="w-full p-3 mt-1 bg-[var(--efl-surface)] border border-[var(--efl-border)] rounded-xl" value={fixtureGroup??'ALL'} onChange={e=>{setFixtureGroup(e.target.value==='ALL'?undefined:Number(e.target.value));setSelectedRound('');}}><option value="ALL">Barcha guruhlar</option>{Array.from({length:tournament.rules.groupsCount??2},(_,g)=><option key={g} value={g}>{String.fromCharCode(65+g)} guruhi</option>)}</select></label>}
          {rounds.length>0&&<CompetitionRounds<string> items={rounds.map(r=>({id:r,label:`${fixtureStageLabel[r.split(':')[0] as CustomTournamentFixture['stage']]} · Tur ${r.split(':')[1]}`}))} value={schedule.round} onChange={setSelectedRound} label="Tur"/>}
          {displayedFixtures.length === 0 ? (
            <p className="text-xs text-[var(--efl-muted)] italic p-8 text-center bg-[var(--efl-surface)] rounded-2xl border border-[var(--efl-border)]">
              {fixtures.length===0?'O‘yinlar hali rejalashtirilmagan. Turnir boshlanganda avtomatik shakllanadi.':'Bu filtrda o‘yin yo‘q. Boshqa guruh yoki barcha o‘yinlarni tanlang.'}
            </p>
          ) : (
            <div className="competition-fixture-grid">{displayedFixtures.map((fix) => {
              const isMyMatch=!!user&&(fix.homeUserId===user.id||fix.awayUserId===user.id);
              return <CompetitionFixtureCard key={fix.id} highlighted={isMyMatch}
                caption={<>{tournament.name} · {fixtureStageLabel[fix.stage]} · {fix.roundOrMatchday}-tur{fix.groupIndex!==undefined?` · ${String.fromCharCode(65+fix.groupIndex)} guruhi`:''}{fix.stage.startsWith('PLAYOFF')&&tournament.rules.playoffLegMode==='TWO_LEG'&&fix.stage!=='PLAYOFF_FINAL'?` · ${fix.leg}-o‘yin`:''}</>}
                status={fixtureStatusLabel[fix.status]} statusTone={fix.status==='CONFIRMED'?'success':fix.status==='PENDING_CONFIRMATION'||fix.status==='DISPUTED'?'warning':'neutral'}
                home={<><ClubCrest clubId={fix.homeClubId} logoUrl={fix.homeClubLogoUrl} name={fix.homeClubName} size="sm"/><span><b title={fix.homeClubName}>{fix.homeClubName}</b><small>{standings?.find(r=>r.clubId===fix.homeClubId)?.position?`${standings.find(r=>r.clubId===fix.homeClubId)!.position}-o‘rin`:''}</small></span></>}
                away={<><span><b title={fix.awayClubName}>{fix.awayClubName}</b><small>{standings?.find(r=>r.clubId===fix.awayClubId)?.position?`${standings.find(r=>r.clubId===fix.awayClubId)!.position}-o‘rin`:''}</small></span><ClubCrest clubId={fix.awayClubId} logoUrl={fix.awayClubLogoUrl} name={fix.awayClubName} size="sm"/></>}
                score={fix.status==='CONFIRMED'?<>{fix.homeScore} : {fix.awayScore}{fix.penaltyHomeScore!=null&&<small>pen: {fix.penaltyHomeScore}-{fix.penaltyAwayScore}</small>}</>:'vs'}>
                {!isCustomMatchReady(fix,fixtures)&&fix.status!=='BYE_AUTO_ADVANCED'&&<p className="text-xs text-[var(--efl-warning)]">{['TBD','BYE'].includes(fix.homeClubId)||['TBD','BYE'].includes(fix.awayClubId)?'Oldingi bosqich g‘olibi kutilmoqda.':'Avval birinchi o‘yin natijasi tasdiqlanishi kerak.'}</p>}
                {tournament.status==='IN_PROGRESS'&&(isMyMatch||canManage)&&!['CONFIRMED','BYE_AUTO_ADVANCED'].includes(fix.status)&&isCustomMatchReady(fix,fixtures)&&(fix.status!=='DISPUTED'||canManage)&&<button onClick={()=>handleOpenScoreModal(fix)} className="tourney-button primary self-end">Hisob</button>}
              </CompetitionFixtureCard>;
            })}</div>
          )}
        </div>
      )}

      {/* TAB 3: PARTICIPANTS */}
      {activeTab === 'participants' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {participants.length === 0 ? (
            <p className="text-xs text-[var(--efl-muted)] italic p-8 text-center col-span-2">Qatnashchilar hali qo‘shilmagan.</p>
          ) : (
            participants.map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] flex items-center gap-3 text-xs"
              >
                <div className="w-9 h-9 flex items-center justify-center shrink-0">
                  <ClubCrest
                    clubId={p.clubId}
                    logoUrl={p.clubLogoUrl}
                    name={p.clubName}
                    shortName={p.clubShortName}
                    size="sm"
                  />
                </div>
                <div className="truncate flex-1">
                  <h4 className="font-bold text-[var(--efl-text)] truncate">{p.clubName}</h4>
                  <p className="text-[11px] text-[var(--efl-text-2)] truncate">@{p.username || 'efl_user'}{p.status === 'PENDING_APPROVAL' ? ' · Tasdiq kutilmoqda' : ''}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: REGLAMENT */}
      {activeTab === 'rules' && (
        <div className="p-5 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] space-y-4 text-xs text-[var(--efl-text-2)] leading-relaxed">
          <h3 className="font-bold text-[var(--efl-text)] text-sm">Turnir Reglamenti</h3>
          <TournamentRulesSummary format={tournament.format} rules={tournament.rules}/>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Liga bosqichi tenglik qoidasi:</strong> Ochko → To‘plar farqi → Urilgan gollar → O‘zaro uchrashuv natijasi.
            </li>
            <li>
              <strong>Pley-off durangi:</strong> Ikki o‘yinli yoki bir o‘yinli pley-offda durang bo‘lsa, alohida penaltilar seriyasi o‘ynaladi va kiritiladi. Safar goli qoidasi qo‘llanmaydi.
            </li>
            <li>
              <strong>O‘yin muddati:</strong> Har bir turning o‘yinlarini yakunlash uchun {tournament.rules.matchDurationHours} soat vaqt beriladi.
            </li>
            <li>
              <strong>Klub egaligi:</strong> Bir foydalanuvchi bir turnirda faqat 1 ta klubni boshqara oladi. Bir klubni 2 kishi tanlay olmaydi.
            </li>
            <li>
              <strong>Nizolarni hal qilish:</strong> Hisoblar mos kelmasa yoki bahs yuzaga kelsa, tashkilotchi yoki yordamchi admin yakuniy qarorni qabul qiladi.
            </li>
          </ul>
        </div>
      )}

      {/* ADMIN DRAWER */}
      {showAdminDrawer && (
        <TournamentAdminDrawer
          isOpen={showAdminDrawer}
          onClose={() => setShowAdminDrawer(false)}
          tournament={tournament}
          initialTab={adminTab}
          initialFixtureId={adminFixtureId}
          isOrganizer={tournament.organizerUserId === user?.id}
          participants={participants}
          fixtures={fixtures}
          onRefresh={loadData}
        />
      )}

      {/* CLUB PICKER MODAL */}
      {showClubPickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label="Turnir klubini tanlash" className="w-full max-w-md bg-[var(--efl-surface)] border border-[var(--efl-border)] rounded-3xl p-5 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--efl-border)]">
              <h3 className="font-black text-[var(--efl-text)] text-base">Bo‘sh Klubni Tanlang</h3>
              <button
                aria-label="Klub tanlashni yopish"
                disabled={!!claimingClubId}
                onClick={() => setShowClubPickerModal(false)}
                className="p-1 rounded-lg text-[var(--efl-text-2)] hover:text-[var(--efl-text)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {claimError && <p role="alert" className="text-xs text-rose-400">{claimError}</p>}
            {claimingClubId && <p role="status" className="text-xs text-[var(--efl-primary)]">Klub band qilinmoqda…</p>}
            <div className="overflow-y-auto min-h-0">
              <TournamentClubPicker selectedLeagueId={tournament.leagueScope === 'SINGLE_LEAGUE' ? tournament.selectedLeagueId : undefined} participants={participants} busy={!!claimingClubId} onSelect={handleClaimClub} />
            </div>
          </div>
        </div>
      )}

      {/* SCORE SUBMISSION MODAL */}
      {selectedMatchForScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label="O‘yin natijasi" className="w-full max-w-sm max-h-[90dvh] overflow-y-auto bg-[var(--efl-surface)] border border-[var(--efl-border)] rounded-3xl p-5 space-y-4 shadow-2xl">
            {scoreError&&<p role="alert" className="text-sm text-rose-400">{scoreError}</p>}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--efl-border)]">
              <h3 className="font-black text-[var(--efl-text)] text-base">O‘yin Natijasi</h3>
              <button
                onClick={() => setSelectedMatchForScore(null)}
                className="p-1 rounded-lg text-[var(--efl-text-2)] hover:text-[var(--efl-text)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center space-y-1">
              <span className="text-[11px] text-[var(--efl-text-2)]">Tur: {selectedMatchForScore.roundOrMatchday}</span>
              <div className="font-bold text-[var(--efl-text)] text-sm">
                {selectedMatchForScore.homeClubName} vs {selectedMatchForScore.awayClubName}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[var(--efl-text-2)] block mb-1 truncate">{selectedMatchForScore.homeClubName}</label>
                <input
                  type="number"
                  min="0" max="99" step="1"
                  value={submitHomeScore}
                  onChange={(e) => setSubmitHomeScore(Number(e.target.value))}
                  className="w-full bg-[var(--efl-surface-2)] border border-[var(--efl-border)] rounded-xl px-3 py-2 text-center text-base font-black text-[var(--efl-text)]"
                />
              </div>
              <div>
                <label className="text-[11px] text-[var(--efl-text-2)] block mb-1 truncate">{selectedMatchForScore.awayClubName}</label>
                <input
                  type="number"
                  min="0" max="99" step="1"
                  value={submitAwayScore}
                  onChange={(e) => setSubmitAwayScore(Number(e.target.value))}
                  className="w-full bg-[var(--efl-surface-2)] border border-[var(--efl-border)] rounded-xl px-3 py-2 text-center text-base font-black text-[var(--efl-text)]"
                />
              </div>
            </div>

            {/* Penalty input */}
            {scoreNeedsPenalties&&<div className="p-2.5 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] space-y-2">
              <span className="text-[10px] font-bold text-amber-400 block uppercase">
                Penaltilar (Pley-off durang bo‘lsa)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  aria-label="Mezbon penaltilari" min={0} max={99} step={1} placeholder="Mezbon"
                  value={submitPenHome}
                  onChange={(e) => setSubmitPenHome(e.target.value)}
                  className="w-full bg-[var(--efl-surface)] border border-[var(--efl-border)] rounded-lg px-2 py-1 text-xs text-[var(--efl-text)] text-center"
                />
                <input
                  type="number"
                  aria-label="Mehmon penaltilari" min={0} max={99} step={1} placeholder="Mehmon"
                  value={submitPenAway}
                  onChange={(e) => setSubmitPenAway(e.target.value)}
                  className="w-full bg-[var(--efl-surface)] border border-[var(--efl-border)] rounded-lg px-2 py-1 text-xs text-[var(--efl-text)] text-center"
                />
              </div>
            </div>}

            <div>
              <label className="text-[11px] text-[var(--efl-text-2)] block mb-1">Screenshot / Rasm havolasi (ixtiyoriy)</label>
              <input
                type="text"
                placeholder="https://..."
                value={submitProofUrl}
                onChange={(e) => setSubmitProofUrl(e.target.value)}
                className="w-full bg-[var(--efl-surface-2)] border border-[var(--efl-border)] rounded-xl px-3 py-2 text-xs text-[var(--efl-text)]"
              />
            </div>

            <button
              onClick={handleSubmitScore}
              disabled={isSubmittingScore}
              className="w-full py-2.5 px-4 rounded-xl bg-[var(--efl-primary)] hover:brightness-110 disabled:opacity-50 text-white font-black text-xs transition-colors"
            >
              {isSubmittingScore ? 'Yuborilmoqda...' : 'Natijani yuborish / tasdiqlash'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
