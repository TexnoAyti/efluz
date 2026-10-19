import React from 'react';
import type {LucideIcon} from 'lucide-react';

/** The domestic league banner and navigation, shared by team competitions. */
export function CompetitionBanner({children,className=''}:{children:React.ReactNode;className?:string}){
 return <header className={`relative overflow-hidden p-4 sm:p-6 shadow-xs border border-[var(--efl-border)] bg-[var(--efl-surface)] rounded-2xl preview-league-banner ${className}`}>{children}</header>;
}

export function CompetitionTabs<T extends string>({items,value,onChange,label,disabled=false}:{items:readonly {id:T;label:string;icon:LucideIcon}[];value:T;onChange:(id:T)=>void;label:string;disabled?:boolean}){
 return <nav className="efl-league-tabs flex items-center gap-2 border-b border-[var(--efl-border)] pb-2 overflow-x-auto scrollbar-none" aria-label={label}>
  {items.map(({id,label,icon:Icon})=><button key={id} type="button" disabled={disabled} aria-pressed={value===id} onClick={()=>onChange(id)} className={`flex shrink-0 whitespace-nowrap items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] border ${value===id?'bg-[var(--efl-primary-soft)] border-[var(--efl-primary)]/30 text-[var(--efl-primary)] font-black shadow-xs':'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:bg-[var(--efl-surface-2)] hover:text-[var(--efl-text)]'}`}><Icon className="w-4 h-4"/><span>{label}</span></button>)}
 </nav>;
}
