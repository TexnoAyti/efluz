import React,{useMemo,useId} from 'react';
import {Trophy,Check,UserRound,Clock3,ChevronRight} from 'lucide-react';
import {layoutKnockout} from '../../lib/knockoutLayout';
import {uDisplayMatches,uMatchNumber,uRoundLabel,uSourceLabel} from '../../lib/uzeflifePresentation';
import type {UMatch,UState} from '../../types/uzeflife';

export function UzeflifeBracket({state,bracket,onMatch,userId}:{state:UState;bracket:number;userId?:string;onMatch:(match:UMatch)=>void}) {
  const gradientId='uzeflife-cup-line-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const fixtures=uDisplayMatches(state).filter(m=>m.bracket===bracket);
  const lastRound=bracket===0?8:5;
  const firstRound=bracket===0?6:1;
  const layout=useMemo(()=>layoutKnockout(
    Array.from({length:lastRound-firstRound+1},(_,i)=>{
      const r=firstRound+i;
      return {key:r===lastRound?'FINAL':String(r),nodes:fixtures.filter(m=>m.round===r).map(m=>({
        id:m.id,round:r===lastRound?'FINAL':String(r),
        targetId:r===lastRound?null:`r${r+1}m${Math.floor(Number(m.id.split('m')[1])/2)}`,
      }))};
    }),200,108,22,124),[state.matches,bracket]);
  const name=(m:UMatch,side:'home'|'away')=>state.participants.find(p=>p.id===m[side])?.name||uSourceLabel(m,side);
  return <section className="u-tree-section" aria-label={bracket?`${bracket}-setka pley-offi`:'Final bosqichi pley-offi'}>
    <div className="u-section-heading"><div><h3>{bracket?`${bracket}-setka`:'Final bosqichi'}</h3><p>{bracket?'32 ishtirokchidan bittasi final bosqichiga chiqadi.':'8 setka g‘olibidan bitta chempion.'}</p></div><Trophy size={20}/></div>
    <div className="u-tree-scroll" tabIndex={0} aria-label="Pley-off setkasi, yon tomonga suring">
      <div className="u-tree" style={{width:layout.width,height:layout.height}}>
        <svg width={layout.width} height={layout.height} aria-hidden="true" className="u-tree-lines" fill="none">
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" className="efl-theme-connector-start" stopColor="rgba(96,165,250,0.34)"/><stop offset="100%" className="efl-theme-connector-end" stopColor="rgba(251,191,36,0.42)"/></linearGradient></defs>
          {fixtures.map(m=>{
            const from=layout.positions.get(m.id);
            const to=layout.positions.get(`r${m.round+1}m${Math.floor(Number(m.id.split('m')[1])/2)}`);
            if(!from||!to||m.round===lastRound)return null;
            const right=to.x>from.x,x1=from.x+(right?200:0),x2=to.x+(right?0:200),y1=from.y+54,y2=to.y+54,mid=(x1+x2)/2;
            return <path key={m.id} className={m.winner?'u-tree-link-complete':undefined} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke={`url(#${gradientId})`} strokeWidth={m.winner?2.25:1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke"/>;
          })}
        </svg>
        {layout.columns.map(c=><span className={`u-tree-heading ${Number(c.key)===state.round||c.key==='FINAL'&&state.round===lastRound?'is-current':''} ${c.key==='FINAL'?'is-final':''}`} style={{left:c.x,width:200}} key={`${c.key}-${c.side}`}>{c.key==='FINAL'?<Trophy size={12}/>:<span className="u-tree-round-dot"/>}{uRoundLabel(c.key==='FINAL'?lastRound:Number(c.key))}</span>)}
        {fixtures.map(m=>{
          const pos=layout.positions.get(m.id);if(!pos)return null;
          const isMine=!!userId&&[m.home,m.away].includes(userId);
          const ready=!!m.home&&!!m.away;
          const current=ready&&!m.winner&&m.round===state.round&&state.status==='playing';
          const status=m.winner?'Yakunlandi':m.proposal?'Tasdiq kutilmoqda':!ready?'Raqib kutilmoqda':m.scheduledAt?new Date(m.scheduledAt).toLocaleTimeString('uz-UZ',{timeZone:'Asia/Tashkent',hour:'2-digit',minute:'2-digit'}):'Kutilmoqda';
          return <button key={m.id} type="button" className={`u-tree-match ${m.round===lastRound?'u-tree-final efl-theme-final':''} ${m.winner?'is-complete':current?'is-current':!ready?'is-placeholder':''} ${isMine?'is-mine':''}`} style={{left:pos.x,top:pos.y,width:200,height:108}} onClick={()=>onMatch(m)} aria-label={`${uRoundLabel(m.round)}, ${uMatchNumber(m)}-o‘yin: ${name(m,'home')} — ${name(m,'away')}. ${status}${m.winner?`. Hisob ${m.homeScore}:${m.awayScore}${m.penaltyHome!==null?`, penaltilar ${m.penaltyHome}:${m.penaltyAway}`:''}. G‘olib: ${state.participants.find(p=>p.id===m.winner)?.name||'Aniqlanmagan'}`:''}${isMine?'. Sizning o‘yiningiz':''}`}>
            <span className="u-tree-match-meta"><span className="u-tree-match-number">{m.round===lastRound?<Trophy size={11}/>:<span className="u-tree-match-dot"/>}{m.round===lastRound?'Final':`${uMatchNumber(m)}-o‘yin`}</span><span className="u-tree-match-state">{m.winner?<Check size={10}/>:m.proposal||m.scheduledAt?<Clock3 size={10}/>:null}{status}</span></span>
            {(['home','away'] as const).map(side=>{
              const winner=!!m[side]&&m.winner===m[side],playerName=name(m,side);
              const initials=m[side]?playerName.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase():null;
              const penalty=m[side==='home'?'penaltyHome':'penaltyAway'];
              return <span key={side} className={`u-tree-player ${winner?'u-tree-winner':m.winner?'u-tree-loser':''}`}>
                <span className="u-tree-identity"><span className={`u-tree-avatar ${m[side]===userId?'is-you':''}`} aria-hidden="true">{winner?<Check size={12}/>:initials||<UserRound size={12}/>}</span><span className="u-tree-name" title={playerName}>{playerName}</span></span>
                <strong className="u-tree-score">{m[`${side}Score`]??'–'}{penalty!==null&&<small title="Penaltilar">({penalty})</small>}</strong>
              </span>;
            })}
          </button>;
        })}
      </div>
    </div>
    <div className="u-tree-footnote"><div className="u-tree-legend" aria-label="Setka belgilari"><span><i className="is-current"/>Joriy bosqich</span><span><Check size={11}/>G‘olib</span>{userId&&<span><i className="is-you"/>Sizning o‘yiningiz</span>}</div><p>Yon tomonga suring <ChevronRight size={12}/> O‘yin kartasini bosib tafsilotlarni oching.</p></div>
  </section>;
}
