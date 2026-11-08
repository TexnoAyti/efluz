// Private, read-only staging bot responses across existing EFLUZ domains.
// The validated sender is passed in by handleReadOnlyBotCommand; never take
// user/season/club IDs from Telegram command text.
import {readUzeflife} from './uzeflifeRead.js';
import {readUzeflifeRoundAudit} from './uzeflifeRoundAudit.js';
import {readTeamsCatalog} from './teamsCatalogRead.js';
import {readMyFixtures} from './myFixturesRead.js';
import {readDomainOperationsAudit} from './domainOperationsAudit.js';
import {readAdminRoundOverview} from './adminRoundOverview.js';
export async function readOnlyBotExtra(db,command,{id,telegramId}){
 if(command==='/audit'){
  try{
   const r=await readDomainOperationsAudit(db,telegramId);
   return 'EFLUZ Serverless admin auditi (sinov)\n'+
    'Mavsum: '+(r.season?.name??'faol emas')+'\n'+
    'Ligalar: '+r.leagues.total+'\n'+
    'Uchrashuvlar: '+r.fixtures.confirmed+'/'+r.fixtures.total+' tasdiqlangan\n'+
    'Kuboklar: '+r.cups.unfinished+' tugallanmagan\n'+
    'Nizolar: '+r.disputes.unresolved+'\n'+
    'TEAMS: '+r.teams.total+', hal etilmagan a’zolar: '+r.teams.unresolvedMembers+
    ', so‘rovlar: '+r.teams.pendingRequests+'\n'+
    'UZEFLIFE joriy turi: '+r.uzeflife.currentRoundFinished+'/'+
    r.uzeflife.currentRoundTotal+' yakunlangan\n'+
    'O‘qilmagan bildirishnomalar: '+r.notifications.unread;
  }catch(error){
   if(error?.message==='DOMAIN_AUDIT_FORBIDDEN')return 'Bu buyruq faqat administrator uchun.';
   throw error;
  }
 }
 if(command==='/rounds'){
  try{
   const overview=await readAdminRoundOverview(db,telegramId);
   if(!overview.season)return 'Turlar (sinov): faol mavsum topilmadi.';
   if(!overview.items.length)return 'Turlar (sinov): musobaqalar topilmadi.';
   const lines=overview.items.map(item=>{
    const next=item.nextRound===null?'mavjud emas':String(item.nextRound);
    const status=item.canAdvanceManually?'qo‘lda o‘tish mumkin':'tekshirish kerak';
    return item.name+': '+item.currentRound+' → '+next+' — '+status+
     ' (o‘ynalmagan '+item.unresolved+', nizolar '+item.disputes+')';
   });
   return 'Admin: turlar (sinov) — '+overview.season.name+'\n'+lines.join('\n')+
    (overview.hasMore?'\nYana musobaqalar mavjud.':'');
  }catch(error){
   if(error?.message==='ROUND_PLAN_FORBIDDEN')return 'Bu buyruq faqat administrator uchun.';
   throw error;
  }
 }
 if(command==='/leagues'||command==='/cups'){
  // Signed-user visibility only. Do not let Telegram text choose seasons,
  // competitions or private identities.
  const season=await db.get(`SELECT id,name FROM efl_seasons
    WHERE is_active=1 ORDER BY created_at DESC,id DESC LIMIT 1`);
  if(!season)return 'Sinov bazasida faol mavsum topilmadi.';
  if(command==='/leagues'){
   const rows=await db.all(`SELECT name,status,current_round AS currentRound
     FROM efl_leagues WHERE season_id=:season
     ORDER BY sort_order ASC,id ASC LIMIT 20`,{':season':season.id});
   return rows.length
    ?'Ligalar (sinov) — '+String(season.name).slice(0,60)+'\n'+
      rows.map(l=>String(l.name).slice(0,55)+' — '+
       String(l.status).slice(0,24)+' (tur '+Number(l.currentRound??0)+')').join('\n')
    :'Sinov bazasida ligalar topilmadi.';
  }
  const rows=await db.all(`SELECT name,type,status FROM efl_competitions
    WHERE season_id=:season AND type IN ('CUP','SUPER_CUP','DOMESTIC_CUP',
    'DOMESTIC_SUPER_CUP','INTERNATIONAL_CUP','KNOCKOUT')
    ORDER BY name ASC,id ASC LIMIT 20`,{':season':season.id});
  return rows.length
   ?'Kuboklar (sinov) — '+String(season.name).slice(0,60)+'\n'+
    rows.map(c=>String(c.name).slice(0,55)+' — '+String(c.status).slice(0,24)).join('\n')
   :'Sinov bazasida kuboklar topilmadi.';
 }
 if(command==='/uzeflife'){
  const result=await readUzeflife(db,{section:'overview'});
  if(!result.available)return 'UZEFLIFE sinov bazasida hali mavjud emas.';
  const s=result.state;
  return 'UZEFLIFE (sinov)\nHolat: '+String(s.status).slice(0,32)+
   '\nJoriy tur: '+Number(s.currentRound??0)+
   '\nUchrashuvlar: '+Number(s.matchesCount??0);
 }
 if(command==='/bracket'){
  // Read only the actual current round. Never synthesize pairings or advance a round.
  const overview=await readUzeflife(db,{section:'overview'});
  if(!overview.available)return 'UZEFLIFE sinov bazasida hali mavjud emas.';
  const current=overview.state.currentRound;
  if(!Number.isSafeInteger(current)||current<0||current>256)
   return 'UZEFLIFE turi ma’lumotlari tekshirilishi kerak.';
  const result=await readUzeflife(db,{section:'playoff',round:current,limit:12});
  const matches=result.rounds.flatMap(r=>r.matches);
  if(!matches.length)return 'UZEFLIFE (sinov): joriy turda uchrashuv topilmadi.';
  const name=value=>String(value??'Aniqlanmagan').replace(/[\r\n\t]/g,' ').slice(0,50);
  const lines=matches.map((m,i)=>{
   const score=m.homeScore!=null&&m.awayScore!=null
    ?' '+Number(m.homeScore)+':'+Number(m.awayScore):'';
   return (i+1)+'. '+name(m.home)+' — '+name(m.away)+score+
    (m.winner?' • yakunlangan':' • kutilmoqda');
  });
  return 'UZEFLIFE (sinov) — '+current+'-tur\n'+lines.join('\n')+
   (result.nextCursor!==null?'\nYana uchrashuvlar mavjud; to‘liq jadval Mini App orqali ko‘riladi.':'');
 }
 if(command==='/roundaudit'){
  try{
   const result=await readUzeflifeRoundAudit(db,telegramId,{limit:1});
   if(!result.available)return 'UZEFLIFE sinov bazasida mavjud emas.';
   const s=result.stats;
   return 'UZEFLIFE admin auditi (sinov) — '+result.round+'-tur\n'+
    'Jami: '+s.total+'\nYakunlangan: '+s.completed+
    '\nHal qilinmagan: '+s.unresolved+
    '\nRaqibi belgilanmagan: '+s.incompleteOpponents;
  }catch(error){
   if(error?.message==='UZEFLIFE_ADMIN_FORBIDDEN')
    return 'Bu buyruq faqat administrator uchun.';
   throw error;
  }
 }
 if(command==='/teams'){
  const result=await readTeamsCatalog(db,{limit:8});
  return result.teams.length
   ?'TEAMS (sinov)\n'+result.teams.map(t=>String(t.name).slice(0,70)+
      ' — '+Number(t.memberCount??0)+' a’zo').join('\n')
   :'Sinov bazasida jamoa topilmadi.';
 }
 if(command==='/myfixtures'){
  const season=await db.get(`SELECT season_id AS seasonId FROM efl_club_occupancies
    WHERE telegram_id=:telegram AND user_id=:user AND status='ACTIVE'
    ORDER BY joined_at DESC LIMIT 1`,
    {':telegram':telegramId,':user':id});
  if(!season)return 'Sinov bazasida faol klub topilmadi.';
  const result=await readMyFixtures(db,telegramId,{seasonId:season.seasonId,limit:8});
  return result.fixtures.length
   ?'Mening uchrashuvlarim (sinov)\n'+result.fixtures.map(f=>
      'Tur '+Number(f.round??0)+': '+String(f.status??'').slice(0,20)+
      (f.homeScore!=null&&f.awayScore!=null
       ?' ('+Number(f.homeScore)+':'+Number(f.awayScore)+')':'')).join('\n')
   :'Faol klub uchun uchrashuv topilmadi.';
 }
 if(command==='/inbox'){
  const messages=await db.all(`SELECT title,is_read AS isRead
    FROM efl_notifications WHERE user_id=:user
    ORDER BY created_at DESC,id DESC LIMIT 8`,{':user':id});
  return messages.length
   ?'Bildirishnomalarim (sinov)\n'+messages.map(n=>
     String(n.title??'Xabar').slice(0,70)+(n.isRead?'':' • yangi')).join('\n')
   :'Bildirishnomalar topilmadi.';
 }
 return null;
}
