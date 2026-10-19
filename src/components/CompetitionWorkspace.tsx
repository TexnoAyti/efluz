import React from 'react';
import {Search,ChevronRight} from 'lucide-react';

/** Compact directory card following the domestic club card hierarchy. */
export function CompetitionEntry({emblem,title,meta,status,description,preview,footer,onClick}:{emblem:React.ReactNode;title:string;meta:React.ReactNode;status?:React.ReactNode;description?:string;preview?:React.ReactNode;footer:React.ReactNode;onClick:()=>void}) {
 return <button type="button" className="competition-entry tourney-card" onClick={onClick}>
  <span className="competition-entry-heading"><span className="competition-entry-emblem">{emblem}</span><span className="competition-entry-title"><h3>{title}</h3><span className="competition-entry-meta">{meta}</span></span>{status&&<span className="competition-entry-status">{status}</span>}</span>
  {description&&<span className="competition-entry-description line-clamp-2">{description}</span>}
  {preview&&<span className="competition-entry-preview">{preview}</span>}
  <span className="tourney-card-footer"><span>{footer}</span><ChevronRight size={15} aria-hidden="true"/></span>
 </button>;
}

export function CompetitionToolbar({value,onChange,label,placeholder='Nomi bo‘yicha qidirish',children}:{value:string;onChange:(value:string)=>void;label:string;placeholder?:string;children?:React.ReactNode}) {
 return <div className="competition-toolbar"><label className="competition-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label={label} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder}/></label>{children&&<div className="competition-toolbar-actions">{children}</div>}</div>;
}

export function CompetitionSteps({step,labels}:{step:number;labels:readonly string[]}) {
 return <ol className="competition-steps" aria-label={`${step}/${labels.length} bosqich`}>{labels.map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined} className={step>=index+1?'active':''}><span>{index+1}</span><b>{label}</b></li>)}</ol>;
}
