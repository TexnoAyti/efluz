import type {CustomTournament,CustomTournamentParticipant,CustomTournamentFixture} from '../../types/customTournament';
import {generateRoundRobinFixtures,generatePlayoffBracketFixtures,calculateCustomStandings,resolvePlayoffWinner} from './customTournamentEngine';
export const tournamentError=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function assertScore(home:number,away:number,penHome?:number,penAway?:number){
 if(![home,away].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=99))throw tournamentError('Hisob 0–99 oralig‘idagi butun son bo‘lishi kerak.');
 if((penHome==null)!==(penAway==null)||[penHome,penAway].some(n=>n!=null&&(!Number.isInteger(n)||n<0||n>99))||(penHome!=null&&penHome===penAway))throw tournamentError('Penalti hisobi noto‘g‘ri. Ikkala hisobni kiriting va g‘olibni aniqlang.');
}
export function validateActualParticipants(t:CustomTournament,p:CustomTournamentParticipant[]){
 if(p.some(row=>row.status==='PENDING_APPROVAL'))throw tournamentError('Avval kutilayotgan arizalarni tasdiqlang yoki rad eting.');
 if(p.length<4)throw tournamentError('Turnirni boshlash uchun kamida 4 ta qatnashchi zarur.');
 if(t.format==='LEAGUE_AND_PLAYOFF'){
  const q=t.rules.playoffQualifiersCount||4,g=t.rules.groupsCount||2;
  if(q>p.length||(t.rules.groupStageMode==='GROUPS'&&(g*2>p.length||q%g!==0)))throw tournamentError('Qatnashchilar soni guruh yoki pley-off reglamentiga yetmaydi.');
 }
}
export function initialSchedule(t:CustomTournament,p:CustomTournamentParticipant[],baseTime:number){
 if(t.format==='PLAYOFF')return generatePlayoffBracketFixtures(t.id,p,t.rules.playoffLegMode,t.rules.matchDurationHours,baseTime);
 if(t.format==='LEAGUE_AND_PLAYOFF'&&t.rules.groupStageMode==='GROUPS'){
  const groups=t.rules.groupsCount||2;p.forEach((row,i)=>row.groupIndex=i%groups);
  return Array.from({length:groups},(_,g)=>generateRoundRobinFixtures(t.id,p.filter(row=>row.groupIndex===g),t.rules.roundsCount,t.rules.matchDurationHours,g,baseTime)).flat();
 }
 return generateRoundRobinFixtures(t.id,p,t.rules.roundsCount,t.rules.matchDurationHours,undefined,baseTime);
}
/** Deterministic slot assignment; never overwrites a dependent match that has started. */
export function reconcilePlayoff(t:CustomTournament,fixtures:CustomTournamentFixture[],now:string){
 const knockout=fixtures.filter(f=>f.stage.startsWith('PLAYOFF'));
 for(const first of knockout.filter(f=>f.leg===1).sort((a,b)=>a.roundOrMatchday-b.roundOrMatchday||a.matchIndex-b.matchIndex)){
  const second=knockout.find(f=>f.id===first.id.replace(/_l1$/,'_l2'));
  const ready=first.status==='BYE_AUTO_ADVANCED'||(first.status==='CONFIRMED'&&(!second||second.status==='CONFIRMED'));
  let winner:string|null=null;
  if(ready)winner=first.status==='BYE_AUTO_ADVANCED'?first.winnerClubId||null:resolvePlayoffWinner(first,second).winnerClubId;
  if(ready&&!winner)throw tournamentError('Durrang juftlik uchun hal qiluvchi o‘yinda penalti hisobini kiriting.');
  first.winnerClubId=winner;if(second)second.winnerClubId=winner;
  if(!first.nextMatchFixtureId){
   if(winner&&first.stage==='PLAYOFF_FINAL'){
    t.status='COMPLETED';t.completedAt=now;t.winnerClubId=winner;
    t.winnerClubName=winner===first.homeClubId?first.homeClubName:first.awayClubName;
    t.winnerUserId=winner===first.homeClubId?first.homeUserId:first.awayUserId;
   }
   continue;
  }
  const next=knockout.find(f=>f.id===first.nextMatchFixtureId);if(!next)throw tournamentError('Pley-off keyingi juftligi topilmadi.',409);
  const slot=Number(first.id.match(/_m(\d+)_l1$/)?.[1]||0)%2===0?'home':'away';
  const clubKey=slot==='home'?'homeClubId':'awayClubId';
  const team=winner===first.homeClubId?{clubId:winner,name:first.homeClubName,userId:first.homeUserId,logo:first.homeClubLogoUrl}:{clubId:winner,name:first.awayClubName,userId:first.awayUserId,logo:first.awayClubLogoUrl};
  const targetId=winner||'TBD';
  const nextSecond=knockout.find(f=>f.id===next.id.replace(/_l1$/,'_l2'));
  if(next[clubKey]!==targetId){
   if([next,nextSecond].some(f=>f&&(f.status!=='SCHEDULED'||f.submittedByUserId)))throw tournamentError('Keyingi bosqich o‘yini boshlangan. Oldingi g‘olibni almashtirib bo‘lmaydi.',409);
   if(next.winnerClubId||nextSecond?.winnerClubId)throw tournamentError('Keyingi bosqich natijasi mavjud.',409);
  }
  const assign=(f:CustomTournamentFixture,side:'home'|'away')=>{
   if(side==='home'){f.homeClubId=targetId;f.homeClubName=winner?team.name:'Kutilmoqda';f.homeUserId=winner?team.userId:undefined;f.homeClubLogoUrl=winner?team.logo:undefined;}
   else{f.awayClubId=targetId;f.awayClubName=winner?team.name:'Kutilmoqda';f.awayUserId=winner?team.userId:undefined;f.awayClubLogoUrl=winner?team.logo:undefined;}
  };
  assign(next,slot);if(nextSecond)assign(nextSecond,slot==='home'?'away':'home');
 }
}
export function reconcileLeague(t:CustomTournament,p:CustomTournamentParticipant[],fixtures:CustomTournamentFixture[],now:string){
 const league=fixtures.filter(f=>!f.stage.startsWith('PLAYOFF'));
 if(!league.length||league.some(f=>f.status!=='CONFIRMED'))return;
 if(t.format==='LEAGUE'){
  const winner=calculateCustomStandings(p,league)[0];t.status='COMPLETED';t.completedAt=now;
  t.winnerClubId=winner.clubId;t.winnerClubName=winner.clubName;t.winnerUserId=winner.userId;return;
 }
 if(t.format!=='LEAGUE_AND_PLAYOFF'||fixtures.some(f=>f.stage.startsWith('PLAYOFF')))return;
 const count=t.rules.playoffQualifiersCount||4;
 const rows=t.rules.groupStageMode==='GROUPS'
  ?Array.from({length:t.rules.groupsCount||2},(_,g)=>calculateCustomStandings(p,league,g).slice(0,count/(t.rules.groupsCount||2)))
  :[calculateCustomStandings(p,league).slice(0,count)];
 const ordered=Array.from({length:Math.max(...rows.map(group=>group.length))},(_,rank)=>rows.flatMap(group=>group[rank]?[group[rank]]:[])).flat();
 const qualified=ordered.map(row=>p.find(part=>part.clubId===row.clubId)!);
 if(qualified.length!==count)throw tournamentError('Pley-off uchun qatnashchilar yetarli emas.',409);
 const playoff=generatePlayoffBracketFixtures(t.id,qualified,t.rules.playoffLegMode,t.rules.matchDurationHours,Date.parse(now));
 fixtures.push(...playoff);t.phase='PLAYOFF';t.expectedFixturesCount=(t.expectedFixturesCount||league.length)+playoff.filter(f=>f.status!=='BYE_AUTO_ADVANCED').length;
 reconcilePlayoff(t,fixtures,now);
}
