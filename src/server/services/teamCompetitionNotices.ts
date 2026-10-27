import type {Transaction} from 'firebase-admin/firestore';
import type {TeamLeague} from '../../types/teamLeaguePreview';
import type {ClasicoEvent} from '../../types/elClasico';
import {CLASICO_SIDE_SIZE,clasicoSides} from '../../types/elClasico';
import {EL_CLASICO_LINK} from '../../lib/elClasicoLinks';
import {teamTournamentTelegramLink} from '../../lib/teamNavigation';
import {teamFixtureScore,teamFixtureWinner} from '../../lib/teamLeagueEngine';
import {noticeGuard,noticeHash,writeCompetitionNotices,type CompetitionNotice} from './competitionNotices';
export function writeClasicoNotices(tx:Transaction,before:ClasicoEvent,after:ClasicoEvent){
 const notices:CompetitionNotice[]=[],name=(id:string)=>after.players.find(p=>p.userId===id)?.name||'O‘yinchi';
 const add=(users:string[],title:string,body:string,paths:string[])=>{for(const userId of new Set(users))notices.push({userId,title:'El‑Clasico · '+title,body,url:EL_CLASICO_LINK,entityType:'team-event',entityId:'el-clasico',guard:noticeGuard('el_clasico_events',after.id,paths,after)});};
 for(const p of after.players){const old=before.players.find(o=>o.userId===p.userId);if(old?.side!==p.side)add([p.userId],old?'Tomoningiz o‘zgardi':'Ro‘yxatga qo‘shildingiz',`${clasicoSides[p.side]} tomonida o‘ynaysiz. O‘yin boshlanganda raqibingiz yuboriladi.`,[`players.${after.players.indexOf(p)}`]);}
 for(const p of before.players)if(!after.players.some(n=>n.userId===p.userId))add([p.userId],'Ro‘yxatdan chiqdingiz','El‑Clasico eventidagi o‘rningiz bo‘shatildi.',['players']);
 const full=(event:ClasicoEvent)=>(['REAL','BARCA'] as const).every(side=>event.players.filter(p=>p.side===side).length===CLASICO_SIDE_SIZE);
 if(full(after)&&!full(before))add(['@owner'],`${CLASICO_SIDE_SIZE*2} o‘rin to‘ldi`,`Har ikki tomonda ${CLASICO_SIDE_SIZE} tadan o‘yinchi tayyor. Eventni boshlashingiz mumkin.`,['players','status']);
 for(const [i,b] of after.bouts.entries()){
  const old=before.bouts.find(o=>o.id===b.id);
  if(b.pendingResult&&noticeHash(b.pendingResult)!==noticeHash(old?.pendingResult))add([b.pendingResult.submittedBy===b.homeUserId?b.awayUserId:b.homeUserId],'Hisobni tasdiqlang',`${name(b.homeUserId)} ${b.pendingResult.homeScore}:${b.pendingResult.awayScore} ${name(b.awayUserId)}. Eventni ochib tasdiqlang yoki rad eting.`,[`bouts.${i}`]);
  if(b.disputed&&!old?.disputed)add([b.homeUserId,b.awayUserId,'@owner'],'Natija rad etildi',`${b.id}‑juftlik hisobida kelishmovchilik bor.`,[`bouts.${i}`]);
  if(!old&&after.status==='ACTIVE')for(const userId of [b.homeUserId,b.awayUserId])add([userId],'O‘yin boshlandi',`${b.id}‑juftlik.\nRaqibingiz: ${name(userId===b.homeUserId?b.awayUserId:b.homeUserId)}.\nTelegram: ${after.players.find(p=>p.userId===(userId===b.homeUserId?b.awayUserId:b.homeUserId))?.contactUrl||'Event sahifasini oching'}.\nO‘yin tugagach eventda hisobni kiriting; raqibingiz tasdiqlaydi.\nTomoningiz: ${clasicoSides[after.players.find(p=>p.userId===userId)!.side]}.`,[`bouts.${i}`,'status']);
  if(b.homeScore!==null&&b.awayScore!==null&&(old?.homeScore!==b.homeScore||old?.awayScore!==b.awayScore))add([b.homeUserId,b.awayUserId],old?.homeScore==null?'Natija kiritildi':'Natija tuzatildi',`${name(b.homeUserId)} ${b.homeScore}:${b.awayScore} ${name(b.awayUserId)}`, [`bouts.${i}`]);
 }
 if(after.status==='COMPLETED'&&before.status!=='COMPLETED'){
  const real=after.bouts.filter(b=>b.homeScore!>b.awayScore!).length,barca=after.bouts.filter(b=>b.awayScore!>b.homeScore!).length;
  add([...after.players.map(p=>p.userId),'@owner'],'Event yakunlandi',`Real Madrid ${real}:${barca} Barcelona.\nBarcha ${after.bouts.length} ta o‘yin yakunlandi.`,['status','bouts']);
 }
 if(after.status==='CANCELLED'&&before.status!=='CANCELLED')add([...after.players.map(p=>p.userId),'@owner'],'Event bekor qilindi','El‑Clasico eventi tashkilotchi tomonidan bekor qilindi.',['status']);
 writeCompetitionNotices(tx,'clasico:'+after.version,notices);return notices;
}
export function writeTeamLeagueNotices(tx:Transaction,before:TeamLeague,after:TeamLeague,action:string,changedFixtureId?:string){
 const notices:CompetitionNotice[]=[],users=(teamId:string)=>after.teams[teamId]?.members.filter(m=>m.verified&&m.userId).map(m=>m.userId!)||[],all=()=>[...after.teamIds.flatMap(users),after.ownerId,after.adminUserId||''].filter(Boolean);
 const guards=new Map<string,ReturnType<typeof noticeGuard>>(),guard=(paths:string[])=>{const key=paths.join('|');if(!guards.has(key))guards.set(key,noticeGuard('team_league_preview_leagues',after.id,paths,after));return guards.get(key)!;};
 const add=(ids:string[],title:string,body:string,paths:string[],fixtureId?:string)=>{for(const userId of new Set(ids))notices.push({userId,title:after.name+' · '+title,body,url:teamTournamentTelegramLink(after.id,fixtureId),entityType:'team-tournament',entityId:after.id,...(fixtureId?{fixtureId}:{}),guard:guard(paths)});};
 const previousFixtures=new Map(before.fixtures.map(f=>[f.id,f]));
 for(const [i,f] of after.fixtures.entries()){
  if(changedFixtureId&&f.id!==changedFixtureId&&!['START','NEXT'].includes(action))continue;
  const old=previousFixtures.get(f.id),label=`${after.teams[f.homeTeamId]?.name} — ${after.teams[f.awayTeamId]?.name}`;
  if(['START','NEXT'].includes(action)&&f.round===after.currentRound)add([...users(f.homeTeamId),...users(f.awayTeamId)],action==='START'?'Turnir boshlandi':'Yangi tur ochildi',`${f.round}‑tur: ${label}. Tarkib va juftliklarni turnir sahifasida kuzating.`,['currentRound','status'],f.id);
  if(action==='LINEUP')for(const side of ['home','away'] as const){const line=side==='home'?f.homeLineup:f.awayLineup,prior=side==='home'?old?.homeLineup:old?.awayLineup,tid=side==='home'?f.homeTeamId:f.awayTeamId;if(line&&noticeHash(line)!==noticeHash(prior)){const members=after.teams[tid].members;for(const m of members.filter(m=>m.verified&&m.userId&&(line.starters.includes(m.id)||line.reserves.includes(m.id))))add([m.userId!],'Tarkib tasdiqlandi',`${label}\nSiz ${line.starters.includes(m.id)?'asosiy tarkibda':'zaxirada'}siz.`,[`fixtures.${i}.${side==='home'?'homeLineup':'awayLineup'}`],f.id);}}
  for(const [j,b] of f.bouts.entries()){
   const prior=old?.bouts.find(o=>o.id===b.id),h=after.teams[f.homeTeamId].members.find(m=>m.id===b.homeMemberId),a=after.teams[f.awayTeamId].members.find(m=>m.id===b.awayMemberId),ids=[h,a].filter(m=>m?.verified&&m.userId).map(m=>m!.userId!);
   if(!prior||prior.homeMemberId!==b.homeMemberId||prior.awayMemberId!==b.awayMemberId)for(const id of ids)add([id],prior?'Juftlik o‘zgardi':'Raqibingiz aniqlandi',`${label}\n${h?.name} — ${a?.name}.`,[`fixtures.${i}.bouts.${j}`],f.id);
   if(b.homeScore!==null&&b.awayScore!==null&&(prior?.homeScore!==b.homeScore||prior?.awayScore!==b.awayScore))add(ids,prior?.homeScore==null?'Natija kiritildi':'Natija tuzatildi',`${h?.name} ${b.homeScore}:${b.awayScore} ${a?.name}`, [`fixtures.${i}.bouts.${j}`],f.id);
  }
  const score=teamFixtureScore(f),previous=old?teamFixtureScore(old):null;
  if(score.complete&&(!previous?.complete||noticeHash([score,f.tieBreakWinnerId])!==noticeHash([previous,old?.tieBreakWinnerId])))add([...users(f.homeTeamId),...users(f.awayTeamId),after.adminUserId||after.ownerId],'Jamoaviy natija',`${label}: ${score.home}:${score.away}${f.tieBreakWinnerId?' · G‘olib: '+after.teams[f.tieBreakWinnerId]?.name:''}.`,[`fixtures.${i}`],f.id);
  if(action==='RESET'&&old?.bouts.length&&!f.bouts.length)add([...users(f.homeTeamId),...users(f.awayTeamId)],'Tarkib qayta ochildi',`${label}. Oldingi juftliklar bekor qilindi; yangi juftlikni kuting.`,[`fixtures.${i}.bouts`],f.id);
 }
 if(after.status==='COMPLETED'&&before.status!=='COMPLETED'){const final=after.fixtures.find(f=>f.stage==='PLAYOFF'&&f.round===after.totalRounds),winner=final?teamFixtureWinner(final):undefined;add(all(),'Turnir yakunlandi',winner?`Chempion: ${after.teams[winner]?.name}. Barcha natijalar turnir sahifasida.`:'Barcha uchrashuvlar yakunlandi. Yakuniy jadval turnir sahifasida.',['status','fixtures']);}
 if(after.status==='CANCELLED'&&before.status!=='CANCELLED')add(all(),'Turnir bekor qilindi','Tashkilotchi turnirni bekor qildi.',['status']);
 writeCompetitionNotices(tx,'team:'+after.id+':'+after.version,notices);return notices;
}
