import React,{useState} from 'react';
import {Shield} from 'lucide-react';

/** A crest keeps its original silhouette; frames belong to cards, never the image. */
export function TeamBadge({team,className=''}:{team?:{name:string;logo?:string};className?:string}){
 const [failed,setFailed]=useState('');
 const logo=team?.logo?.trim(),name=team?.name||'Team';
 return <span className={`team-crest ${className}`} role="img" aria-label={`${name} logotipi`} title={name}>
  {logo&&failed!==logo?<img src={logo} alt="" decoding="async" draggable={false} onError={()=>setFailed(logo)}/>:<Shield className="team-crest-fallback" aria-hidden="true"/>}
 </span>;
}
