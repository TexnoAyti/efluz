import React from 'react';
import {CalendarDays,MessageSquare,Swords} from 'lucide-react';
import {openMatchChat} from '../../lib/matchChat';
import {MatchChatUnreadBadge} from '../MatchChatUnreadBadge';
import {uzeflifeMyMatch} from '../../lib/uzeflifeMyMatch';
import {uMatchFinished} from '../../lib/uzeflifeLeague';
import type {UViewState} from '../../lib/uzeflifeApi';
export function UzeflifeMyMatch({state:s,userId,onOpen}:{state:UViewState;userId?:string;onOpen:(id:string)=>void}){
 const m=uzeflifeMyMatch(s,userId),name=(id:string|null)=>s.participants.find(p=>p.id===id)?.name||'Raqib kutilmoqda';
 if(!m)return <section className="competition-panel"><h3>Mening o‘yinim</h3><p className="competition-muted">{userId?'Joriy turdagi o‘yiningiz topilmadi. Ro‘yxatdagi o‘rningizni ulang yoki admin bilan bog‘laning.':'O‘yiningizni ko‘rish uchun Telegram orqali kiring.'}</p></section>;
 const opponent=m.home===userId?m.away:m.home,finished=uMatchFinished(m);
 return <section className="competition-panel u-my-match" aria-label="Mening joriy o‘yinim">
  <div className="u-section-heading"><h3><Swords size={18}/>Mening o‘yinim</h3><span className="u-status">{m.round}-tur</span></div>
  <p className="competition-muted">{m.dispute?.status==='open'?'Hisoblar mos kelmadi · admin tekshirmoqda':finished?'Natija tasdiqlangan':m.proposal?m.proposal.by===userId?'Raqib tasdig‘i kutilmoqda':'Raqib hisob yubordi · tekshiring':'Raqibingiz bilan o‘yinni kelishib oling'}</p>
  <div className="u-dialog-score u-dialog-scoreboard"><div><span>{name(m.home)}</span><strong>{m.homeScore??m.proposal?.home??'—'}</strong></div><div><span>{name(m.away)}</span><strong>{m.awayScore??m.proposal?.away??'—'}</strong></div></div>
  {m.deadlineAt&&<p className="competition-note"><CalendarDays size={15}/>Muddat: {new Date(m.deadlineAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',dateStyle:'medium',timeStyle:'short'})}</p>}
  <div className="competition-actions"><button data-munfiz-control={m.proposal&&m.proposal.by!==userId?'result-review':'fixture-open'} className="competition-button primary" onClick={()=>onOpen(m.id)}>{finished?'Natijani ko‘rish':m.proposal&&m.proposal.by!==userId?'Hisobni tekshirish':'O‘yinni ochish va hisob kiritish'}</button><button type="button" data-guide="opponent-chat" className="competition-button" onClick={()=>openMatchChat({kind:'uzeflife',matchId:m.id,opponentName:s.participants.find(p=>p.id===opponent)?.name})}><MessageSquare size={16}/>Raqib bilan chat<MatchChatUnreadBadge kind="uzeflife" matchId={m.id}/></button></div>
 </section>;
}
