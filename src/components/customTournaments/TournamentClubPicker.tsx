import React, { useState } from 'react';
import { Search, CheckCircle2, Lock } from 'lucide-react';
import { TOP5_CLUBS, TOP5_LEAGUES } from '../../constants/top5Clubs';
import { CustomTournamentParticipant } from '../../types/customTournament';
import { ClubCrest } from '../ClubCrest';

interface Props {
  selectedLeagueId?: string;
  selectedClubId?: string;
  participants?: CustomTournamentParticipant[];
  busy?: boolean;
  onSelect: (clubId: string) => void;
}

/** Tournament ownership is independent of domestic season club ownership. */
export function TournamentClubPicker({ selectedLeagueId, selectedClubId, participants = [], busy = false, onSelect }: Props) {
  const [leagueId, setLeagueId] = useState('ALL');
  const [search, setSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const owners = new Map(participants.map(p => [p.clubId, p]));
  const clubs = TOP5_CLUBS.filter(c =>
    (!selectedLeagueId || c.leagueId === selectedLeagueId) &&
    (selectedLeagueId || leagueId === 'ALL' || c.leagueId === leagueId) &&
    (!onlyAvailable || !owners.has(c.id)) &&
    `${c.name} ${c.shortName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return <div className="space-y-3">
    {!selectedLeagueId && <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Liga filtri">
      {[{id:'ALL',name:'Barchasi'}, ...TOP5_LEAGUES].map(l => <button key={l.id} type="button" aria-pressed={leagueId === l.id} onClick={() => setLeagueId(l.id)} className={`shrink-0 min-h-[44px] px-3 rounded-xl text-xs font-bold border ${leagueId === l.id ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400' : 'border-slate-800 text-slate-400'}`}>{l.name}</button>)}
    </div>}
    <label className="relative block">
      <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
      <input aria-label="Klub qidirish" value={search} onChange={e => setSearch(e.target.value)} placeholder="Klub nomi bo‘yicha qidirish" className="w-full min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3 text-sm text-slate-200" />
    </label>
    {participants.length > 0 && <label className="flex gap-2 items-center min-h-[44px] text-xs text-slate-400"><input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} />Faqat bo‘sh klublar</label>}
    <div className="grid grid-cols-2 gap-2 max-h-[38vh] overflow-y-auto">
      {clubs.map(c => {
        const owner = owners.get(c.id), selected = c.id === selectedClubId;
        return <button key={c.id} type="button" disabled={busy || !!owner} aria-pressed={selected} onClick={() => onSelect(c.id)} className={`min-h-[88px] p-3 rounded-2xl border text-left flex gap-2 items-center disabled:cursor-default ${selected ? 'bg-emerald-500/15 border-emerald-500' : 'bg-slate-950/60 border-slate-800'} ${owner ? 'opacity-60' : ''}`}>
          <ClubCrest clubId={c.id} logoUrl={c.logoUrl} name={c.name} shortName={c.shortName} size="sm" />
          <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-200 break-words">{c.name}</span><span className="block text-[10px] text-slate-400 mt-1 break-words">{owner ? `Band: ${owner.username ? '@' + owner.username : owner.firstName || 'Ishtirokchi'}` : selected ? 'Tanlandi' : 'Bo‘sh'}</span></span>
          {owner ? <Lock className="w-3 h-3 shrink-0 text-slate-400" /> : selected ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : null}
        </button>;
      })}
    </div>
    {clubs.length === 0 && <p className="p-4 text-center text-xs text-slate-400">Klub topilmadi.</p>}
  </div>;
}
