import React,{useMemo} from 'react';
import {Trophy} from 'lucide-react';
import {layoutKnockout} from '../../lib/knockoutLayout';
import {uDisplayMatches,uMatchNumber,uRoundLabel,uSourceLabel} from '../../lib/uzeflifePresentation';
import type {UMatch,UState} from '../../types/uzeflife';

export function UzeflifeBracket({state,bracket,onMatch}:{state:UState;bracket:number;onMatch:(match:UMatch)=>void}) {
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
    }),176,94,22,108),[state.matches,bracket]);
  const name=(m:UMatch,side:'home'|'away')=>state.participants.find(p=>p.id===m[side])?.name||uSourceLabel(m,side);
  return <section className="u-tree-section" aria-label={bracket?`${bracket}-setka pley-offi`:'Final bosqichi pley-offi'}>
    <div className="u-section-heading"><div><h3>{bracket?`${bracket}-setka`:'Final bosqichi'}</h3><p>{bracket?'32 ishtirokchidan bittasi final bosqichiga chiqadi.':'8 setka g‘olibidan bitta chempion.'}</p></div><Trophy size={20}/></div>
    <div className="u-tree-scroll" tabIndex={0} aria-label="Pley-off setkasi, yon tomonga suring">
      <div className="u-tree" style={{width:layout.width,height:layout.height}}>
        <svg width={layout.width} height={layout.height} aria-hidden="true" className="u-tree-lines">
          {fixtures.map(m=>{
            const from=layout.positions.get(m.id);
            const to=layout.positions.get(`r${m.round+1}m${Math.floor(Number(m.id.split('m')[1])/2)}`);
            if(!from||!to||m.round===lastRound)return null;
            const right=to.x>from.x,x1=from.x+(right?176:0),x2=to.x+(right?0:176),y1=from.y+47,y2=to.y+47,mid=(x1+x2)/2;
            return <path key={m.id} d={`M${x1},${y1}H${mid}V${y2}H${x2}`}/>;
          })}
        </svg>
        {layout.columns.map(c=><span className="u-tree-heading" style={{left:c.x,width:176}} key={`${c.key}-${c.side}`}>{uRoundLabel(c.key==='FINAL'?lastRound:Number(c.key))}</span>)}
        {fixtures.map(m=>{
          const pos=layout.positions.get(m.id);if(!pos)return null;
          return <button key={m.id} type="button" className={`u-tree-match ${m.round===lastRound?'u-tree-final':''}`} style={{left:pos.x,top:pos.y,width:176,height:94}} onClick={()=>onMatch(m)}>
            <span className="u-tree-match-meta">{m.round===lastRound?<Trophy size={10}/>:null}{m.round===lastRound?'Final':`${uMatchNumber(m)}-o‘yin`}<b>{m.winner?'Yakunlandi':m.proposal?'Tasdiq kutilmoqda':''}</b></span>
            {(['home','away'] as const).map(side=><span key={side} className={`u-tree-player ${m[side]&&m.winner===m[side]?'u-tree-winner':''}`}><span title={name(m,side)}>{name(m,side)}</span><strong>{m[`${side}Score`]??'–'}</strong></span>)}
          </button>;
        })}
      </div>
    </div>
    <p className="text-[10px] tourney-muted mt-3">Setkani ko‘rish uchun yon tomonga suring. O‘yin ustiga bosib tafsilotlarni oching.</p>
  </section>;
}
