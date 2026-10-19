import React from 'react';

export type StandingsView = 'short' | 'full' | 'form';

/** The same matchday strip is used by domestic leagues and organizer tournaments. */
export function CompetitionRounds<T extends string | number>({items, value, onChange, label='Tur', ariaLabel='Tur tanlash'}:{items:readonly {id:T;label:string}[];value:T;onChange:(id:T)=>void;label?:string;ariaLabel?:string}) {
 return <nav className="competition-rounds p-2.5 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] flex items-center gap-2 overflow-x-auto scrollbar-none shadow-xs" aria-label={ariaLabel}>
  <span className="text-[11px] font-black text-[var(--efl-text-2)] uppercase tracking-wider shrink-0 mr-1">{label}:</span>
  {items.map(item=><button key={item.id} type="button" aria-pressed={item.id===value} onClick={()=>onChange(item.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all min-h-[34px] border ${item.id===value?'bg-[var(--efl-primary)] text-white font-black shadow-xs border-transparent':'bg-[var(--efl-surface-2)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface)] hover:text-[var(--efl-text)]'}`}>{item.label}</button>)}
 </nav>;
}

export function CompetitionTableViews({value,onChange,labels={short:'Qisqa',full:'To‘liq',form:'Forma'},label='Jadval ko‘rinishi'}:{value:StandingsView;onChange:(view:StandingsView)=>void;labels?:Record<StandingsView,string>;label?:string}) {
 return <div className="efl-standings-view-switch" role="group" aria-label={label}>{(['short','full','form'] as const).map(view=><button key={view} type="button" aria-pressed={view===value} onClick={()=>onChange(view)}>{labels[view]}</button>)}</div>;
}

/** Slots retain each competition's permissions, ownership links and scoring rules. */
export function CompetitionFixtureCard({caption,status,home,away,score,children,onClick,onOpen,statusTone='neutral',highlighted=false,className=''}:{caption:React.ReactNode;status:React.ReactNode;home:React.ReactNode;away:React.ReactNode;score:React.ReactNode;children?:React.ReactNode;onClick?:()=>void;onOpen?:()=>void;statusTone?:'neutral'|'success'|'warning';highlighted?:boolean;className?:string}) {
 return <article onClick={onOpen} role={onOpen?'group':undefined} tabIndex={onOpen?0:undefined} onKeyDown={event=>{if(onOpen&&event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onOpen();}}} className={`competition-fixture-card p-3.5 sm:p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-xs bg-[var(--efl-surface)] border border-[var(--efl-border)] ${highlighted?'border-[var(--efl-primary)]/40 bg-[var(--efl-primary-soft)]/40':''} ${className}`}>
  <div className="competition-fixture-caption flex items-center justify-between gap-2 text-[11px] text-[var(--efl-text-2)] border-b border-[var(--efl-border)] pb-2"><span className="font-bold">{caption}</span><span className={`competition-fixture-status competition-fixture-status--${statusTone}`}>{status}</span></div>
  {onClick?<button type="button" className="competition-fixture-teams" onClick={onClick} aria-label="Uchrashuvni ochish"><span className="competition-fixture-side">{home}</span><span className="competition-fixture-score">{score}</span><span className="competition-fixture-side competition-fixture-away">{away}</span></button>:<div className="competition-fixture-teams"><div className="competition-fixture-side">{home}</div><div className="competition-fixture-score">{score}</div><div className="competition-fixture-side competition-fixture-away">{away}</div></div>}
  {children}
 </article>;
}

export interface CompetitionStanding {
 id:string;position:number;identity:React.ReactNode;played:number;won:number;drawn:number;lost:number;goalsFor:number;goalsAgainst:number;goalDifference:number;points:number;form?:string[];highlighted?:boolean;positionMarker?:React.ReactNode;
}
export function CompetitionStandings({rows,title,view,onViewChange,legend,note,clubLabel='Klub',goalsLabel='Gollar',labels={played:'O‘',won:'G‘',drawn:'D',lost:'M',difference:'TF',points:'Och',form:'Forma',short:'Qisqa',full:'To‘liq',view:'Jadval ko‘rinishi',win:'G‘alaba',draw:'Durang',loss:'Mag‘lubiyat',empty:'Natija yo‘q'}}:{rows:CompetitionStanding[];title:React.ReactNode;view:StandingsView;onViewChange:(view:StandingsView)=>void;legend?:React.ReactNode;note?:React.ReactNode;clubLabel?:string;goalsLabel?:string;labels?:Record<'played'|'won'|'drawn'|'lost'|'difference'|'points'|'form'|'short'|'full'|'view'|'win'|'draw'|'loss'|'empty',string>}) {
 return <section className={`competition-standings efl-standings efl-standings--${view} space-y-4`}>
  <div className="efl-standings-toolbar"><CompetitionTableViews value={view} onChange={onViewChange} labels={labels} label={labels.view}/>{view==='form'&&<div className="efl-standings-form-legend"><span className="efl-result-win">{labels.win}</span><span className="efl-result-draw">{labels.draw}</span><span className="efl-result-loss">{labels.loss}</span></div>}</div>
  <div className="preview-surface overflow-hidden shadow-sm rounded-2xl border border-[var(--efl-border)]">
   <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-[var(--efl-surface-2)] border-b border-[var(--efl-border)] text-[10px]"><div className="font-bold text-[var(--efl-text)]">{title}</div>{legend&&<div className="efl-standings-qualification-legend flex flex-wrap items-center gap-2.5">{legend}</div>}</div>
   <div className="overflow-x-auto scrollbar-none"><table className="w-full text-left text-xs border-collapse"><thead><tr className="border-b border-[var(--efl-border)] bg-[var(--efl-surface-2)] text-[var(--efl-text-2)] font-bold uppercase text-[10px] tracking-wider">
    <th className="py-3 px-3 w-12 text-center" scope="col">#</th><th className="py-3 px-3" scope="col">{clubLabel}</th>{[[labels.played,''],[labels.won,'efl-col-won'],[labels.drawn,'efl-col-drawn'],[labels.lost,'efl-col-lost'],['GF','efl-col-goalsFor'],['GA','efl-col-goalsAgainst'],[labels.difference,'efl-col-goalDifference'],[labels.form,'efl-col-form'],[labels.points,'competition-points']].map(([label,cls],i)=><th key={i} scope="col" className={`${cls} py-3 px-2 text-center`} title={i===4||i===5?goalsLabel:undefined}>{label}</th>)}
   </tr></thead><tbody className="divide-y divide-[var(--efl-border)]">{rows.map(row=><tr key={row.id} className={row.highlighted?'active-club-highlight bg-[var(--efl-primary-soft)] font-bold':'hover:bg-[var(--efl-surface-2)]'}>
    <td className="py-2.5 px-3 text-center"><div className="flex items-center justify-center gap-1">{row.positionMarker}<span className="font-black text-[var(--efl-text)] text-xs">{row.position}</span></div></td><td className="py-2.5 px-3"><div className="competition-standing-identity flex items-center gap-2.5 min-w-0">{row.identity}</div></td>
    <td className="py-2.5 px-2 text-center font-semibold text-[var(--efl-text)]">{row.played}</td><td className="efl-col-won py-2.5 px-2 text-center efl-result-win">{row.won}</td><td className="efl-col-drawn py-2.5 px-2 text-center efl-result-draw">{row.drawn}</td><td className="efl-col-lost py-2.5 px-2 text-center efl-result-loss">{row.lost}</td><td className="efl-col-goalsFor py-2.5 px-2 text-center">{row.goalsFor}</td><td className="efl-col-goalsAgainst py-2.5 px-2 text-center">{row.goalsAgainst}</td><td className="efl-col-goalDifference py-2.5 px-2 text-center font-bold">{row.goalDifference>0?'+':''}{row.goalDifference}</td>
    <td className="efl-col-form py-2.5 px-2 text-center"><div className="efl-standings-form">{row.form?.length?row.form.slice(-5).map((result,i)=><span key={i} className={`efl-form-result efl-form-result--${result.toLowerCase()}`} title={result==='W'?labels.win:result==='D'?labels.draw:labels.loss}>{result==='W'?labels.won:result==='D'?labels.drawn:labels.lost}</span>):<span title={labels.empty}>—</span>}</div></td><td className="competition-points py-2.5 px-3 text-center font-black text-[var(--efl-primary)]">{row.points}</td>
   </tr>)}</tbody></table></div>
   {!rows.length&&<p className="competition-empty">Jadval hali shakllanmagan.</p>}
  </div>{note&&<p className="text-[11px] text-[var(--efl-text-2)]">{note}</p>}
 </section>;
}
