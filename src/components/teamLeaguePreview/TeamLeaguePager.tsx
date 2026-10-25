import React,{useEffect,useRef} from 'react';
import {ChevronLeft,ChevronRight,Trophy} from 'lucide-react';
import type {TeamLeague} from '../../types/teamLeaguePreview';
import {orderedTeamLeagues,swipedTeamLeague} from '../../lib/teamLeagueBrowsing';

type Props={leagues:TeamLeague[];selected:string;onChange:(id:string)=>void;children:React.ReactNode};
export function TeamLeaguePager({leagues,selected,onChange,children}:Props){
 const ordered=orderedTeamLeagues(leagues),index=ordered.findIndex(l=>l.id===selected),strip=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{const active=strip.current?.querySelector<HTMLElement>('[aria-current="true"]');if(active&&strip.current){const el=strip.current;el.scrollTo({left:active.offsetLeft-(el.clientWidth-active.clientWidth)/2,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}},[selected]);
 return <div className="team-league-pager">
  {ordered.length>1&&<nav className="team-league-selector" aria-label="TEAMS ligalarini almashtirish">
   <button type="button" className="competition-button team-league-arrow" aria-label="Oldingi liga" disabled={index<=0} onClick={()=>onChange(ordered[index-1].id)}><ChevronLeft size={18}/></button>
   <div className="team-league-strip" ref={strip}>{ordered.map((league,i)=><button type="button" key={league.id} aria-current={league.id===selected?'true':undefined} onClick={()=>onChange(league.id)}><Trophy size={15}/><span>{league.name}<small>{i+1} / {ordered.length}</small></span></button>)}</div>
   <button type="button" className="competition-button team-league-arrow" aria-label="Keyingi liga" disabled={index<0||index>=ordered.length-1} onClick={()=>onChange(ordered[index+1].id)}><ChevronRight size={18}/></button>
  </nav>}
  <div className="team-league-slide" onTouchStart={event=>{
   start.current=null;if(event.touches.length!==1||ordered.length<2)return;
   const target=event.target as HTMLElement;
   if(target.closest('button,a,input,textarea,select,summary,table,[role="tablist"]'))return;
   for(let el:HTMLElement|null=target;el&&el!==event.currentTarget;el=el.parentElement){if(el.scrollWidth>el.clientWidth+2&&['auto','scroll'].includes(getComputedStyle(el).overflowX))return;}
   start.current={x:event.touches[0].clientX,y:event.touches[0].clientY};
  }} onTouchMove={event=>{if(event.touches.length!==1)start.current=null;}} onTouchCancel={()=>{start.current=null;}} onTouchEnd={event=>{
   const origin=start.current;start.current=null;if(!origin||!event.changedTouches.length)return;
   const touch=event.changedTouches[0],next=swipedTeamLeague(ordered,selected,touch.clientX-origin.x,touch.clientY-origin.y);if(next!==selected)onChange(next);
  }}>{children}</div>
 </div>;
}
