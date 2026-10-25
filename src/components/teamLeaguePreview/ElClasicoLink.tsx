import React,{useRef,useState} from 'react';
import {Copy,ExternalLink} from 'lucide-react';
import {EL_CLASICO_LINK} from '../../lib/elClasicoLinks';
export function ElClasicoLink(){
 const input=useRef<HTMLInputElement>(null),[status,setStatus]=useState('');
 return <div className="p-3 border-t border-[var(--efl-border)]"><label className="competition-field">El‑Clasico kirish havolasi<input ref={input} readOnly value={EL_CLASICO_LINK} onFocus={e=>e.target.select()}/></label><div className="competition-actions mt-2"><button className="competition-button" onClick={async()=>{try{await navigator.clipboard.writeText(EL_CLASICO_LINK);setStatus('Havola nusxalandi.');}catch{input.current?.focus();input.current?.select();setStatus('Havola belgilandi — nusxalab oling.');}}}><Copy size={15}/>Havolani nusxalash</button><a className="competition-button" href={EL_CLASICO_LINK} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Havolani ochish</a></div>{status&&<p className="competition-muted mt-2" role="status">{status}</p>}</div>;
}
