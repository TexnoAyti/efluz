import React from 'react';
import type {LucideIcon} from 'lucide-react';

/** The domestic league banner and navigation, shared by team competitions. */
export function CompetitionBanner({children,className=''}:{children:React.ReactNode;className?:string}){
 return <header className={`relative overflow-hidden p-4 sm:p-6 shadow-xs border border-[var(--efl-border)] bg-[var(--efl-surface)] rounded-2xl preview-league-banner ${className}`}>{children}</header>;
}

export function CompetitionTabs<T extends string>({items,value,onChange,label,disabled=false,layout='row'}:{items:readonly {id:T;label:string;icon:LucideIcon}[];value:T;onChange:(id:T)=>void;label:string;disabled?:boolean;layout?:'row'|'grid'}){
 return <nav className={`efl-league-tabs flex items-center gap-2 border-b border-[var(--efl-border)] pb-2 overflow-x-auto scrollbar-none ${layout==='grid'?'competition-tabs-grid':''}`} style={layout==='grid'?{'--competition-tab-count':items.length,'--competition-mobile-tab-count':Math.min(3,items.length)} as React.CSSProperties:undefined} aria-label={label}>
  {items.map(({id,label,icon:Icon})=><button key={id} type="button" disabled={disabled} aria-pressed={value===id} onClick={()=>onChange(id)} className={`flex shrink-0 whitespace-nowrap items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] border ${value===id?'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/30 text-[var(--efl-primary)] font-black shadow-xs':'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'}`}><Icon className="w-4 h-4"/><span>{label}</span></button>)}
 </nav>;
}

/** Shared league heading: UZEFLIFE and domestic leagues use identical geometry. */
export function CompetitionHeading({emblem,eyebrow,title,meta}:{emblem:React.ReactNode;eyebrow:React.ReactNode;title:string;meta:React.ReactNode}) {
 return <div className="efl-league-banner-content flex items-center gap-4">
  <div className="efl-theme-league-logo w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[var(--efl-surface-2)] p-2.5 border border-[var(--efl-border)] flex items-center justify-center shadow-xs shrink-0">{emblem}</div>
  <div><div className="efl-fit-wrap flex items-center gap-2">{eyebrow}</div><h1 className="text-xl sm:text-2xl font-black text-[var(--efl-text)] tracking-tight mt-0.5">{title}</h1><div className="efl-fit-wrap flex items-center gap-3 mt-1.5 text-xs text-[var(--efl-text-2)]">{meta}</div></div>
 </div>;
}
