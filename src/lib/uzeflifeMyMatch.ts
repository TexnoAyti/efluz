import type {UState} from '../types/uzeflife';
export function uzeflifeOpponentUsername(s:UState,id:string|null){
 if(!id)return null;
 const slot=s.roster?.find(r=>r.userId===id||`uze-slot-${r.group}-${r.slot}`===id);
 const label=s.participants.find(p=>p.id===id)?.name;
 const name=slot?.username||(label?.startsWith('@')?label.slice(1):null);
 return name&&/^[A-Za-z0-9_]{5,32}$/.test(name)?name:null;
}
export function uzeflifeMyMatch(s:UState,id?:string){return id&&s.participants.some(p=>p.id===id&&p.status==='approved')?s.matches.find(m=>m.round===s.round&&[m.home,m.away].includes(id))||null:null;}
