// Isolated staging UI. NO Vercel, legacy /api, fetch or production writes.
// Only platform-signed Telegram.WebApp.Serverless.call is permitted.
const state=document.getElementById('state');
const health=document.getElementById('health');
const profile=document.getElementById('profileResult');
const connect=document.getElementById('connect');
const profileButton=document.getElementById('profile');
const uzeflifeButton=document.getElementById('uzeflife');
const teamsButton=document.getElementById('teams');
const uzeflifeResult=document.getElementById('uzeflifeResult');
const teamsResult=document.getElementById('teamsResult');
const inboxButton=document.getElementById('inbox');
const inboxResult=document.getElementById('inboxResult');
const requestsButton=document.getElementById('teamRequests');
const requestsResult=document.getElementById('teamRequestsResult');
const staffPanel=document.getElementById('staffPanel');
const overviewButton=document.getElementById('staffOverview');
const auditButton=document.getElementById('roundAudit');
const staffResult=document.getElementById('staffResult');
const competitionsButton=document.getElementById('competitions');
const fixturesButton=document.getElementById('myFixtures');
const fixturesResult=document.getElementById('fixturesResult');
let activeSeasonId=null;
const webApp=window.Telegram?.WebApp;
const sdk=webApp?.Serverless;
webApp?.ready?.();
function status(text){state.textContent=text;}
function readable(error){return String(error?.parameters?.code||error?.type||'SERVERLESS_ERROR');}
function call(name,input={}){
  if(typeof sdk?.call!=='function')return Promise.reject(new Error('SERVERLESS_UNAVAILABLE'));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timeout=setTimeout(()=>{if(!settled){settled=true;reject(new Error('SERVERLESS_TIMEOUT'));}},12000);
    sdk.call(name,input,(error,result)=>{
      if(settled)return;
      settled=true;clearTimeout(timeout);
      if(error)reject(error);
      else resolve(result);
    });
  });
}
if(typeof sdk?.call==='function')status('Telegram Serverless API mavjud');
else status('Telegram ichida staging Mini App sifatida oching');
connect.addEventListener('click',async()=>{
  connect.disabled=true;health.textContent='Ulanish tekshirilmoqda…';
  try{
    const result=await call('health');
    if(result?.ok!==true||result?.service!=='efluz-serverless'||result?.migrationMode!=='shadow')
      throw new Error('UNEXPECTED_BACKEND');
    status('Serverless aloqasi tasdiqlandi');
    health.textContent='API: efluz-serverless\nRejim: xavfsiz sinov\nTelegram ID: '+String(result.telegramUserId??'tasdiqlanmagan');
    profileButton.disabled=!result.telegramUserId;
    uzeflifeButton.disabled=!result.telegramUserId;
    teamsButton.disabled=!result.telegramUserId;
    inboxButton.disabled=!result.telegramUserId;
    requestsButton.disabled=!result.telegramUserId;
  }catch(error){status('Ulanish tekshiruvdan o‘tmadi');health.textContent='Xato: '+readable(error);}
  finally{connect.disabled=false;}
});
profileButton.addEventListener('click',async()=>{
  profileButton.disabled=true;profile.textContent='Sinov bazasidan olinmoqda…';
  try{
    const result=await call('bootstrap');
    if(result?.ok!==true)throw Error('UNEXPECTED_PROFILE');
    const clubCount=Array.isArray(result.ownerships)?result.ownerships.length:0;
    const leagueCount=Array.isArray(result.leagues)?result.leagues.length:0;
    activeSeasonId=typeof result.activeSeason?.id==='string'?result.activeSeason.id:null;
    competitionsButton.disabled=!activeSeasonId;
    fixturesButton.disabled=!activeSeasonId||!result.user;
    if(result.user?.isAdmin===true){
      staffPanel.hidden=false;
      overviewButton.disabled=false;
      auditButton.disabled=false;
    }else{
      staffPanel.hidden=true;
      overviewButton.disabled=true;
      auditButton.disabled=true;
    }
    profile.textContent='Foydalanuvchi: '+(result.user?'topildi':'sinov bazasida yo‘q')+
      '\nFaol klublar: '+clubCount+'\nLigalar: '+leagueCount+
      '\nManba: '+String(result.source||'noma’lum');
  }catch(error){profile.textContent='Xato: '+readable(error);}
  finally{profileButton.disabled=false;}
});

uzeflifeButton.addEventListener('click',async()=>{
 uzeflifeButton.disabled=true;uzeflifeResult.textContent='Turnir tekshirilmoqda…';
 try{
  const overview=await call('uzeflife',{section:'overview'});
  if(overview?.ok!==true)throw Error('UNEXPECTED_UZEFLIFE');
  if(!overview.available){
   uzeflifeResult.textContent='Staging bazasida UZEFLIFE hali import qilinmagan.';
   return;
  }
  const matches=await call('uzeflife',{section:'matches',limit:10});
  if(matches?.ok!==true||!Array.isArray(matches.items))
   throw Error('INVALID_UZEFLIFE_FEED');
  const state=overview.state;
  uzeflifeResult.textContent='Turnir: '+String(state.name??'UZEFLIFE')+
    '\nIshtirokchilar: '+Number(state.participantsCount??0)+
    '\nO‘yinlar: '+Number(state.matchesCount??0)+
    '\nJoriy tur: '+Number(state.currentRound??0)+
    '\nDastlabki 10 o‘yin: '+matches.items.length;
 }catch(error){uzeflifeResult.textContent='Xato: '+readable(error);}
 finally{uzeflifeButton.disabled=false;}
});
teamsButton.addEventListener('click',async()=>{
 teamsButton.disabled=true;teamsResult.textContent='Jamoalar tekshirilmoqda…';
 try{
  const catalog=await call('teamsCatalog',{limit:10});
  if(catalog?.ok!==true||!Array.isArray(catalog.teams))
   throw Error('INVALID_TEAMS_FEED');
  teamsResult.textContent=catalog.teams.length
    ?catalog.teams.map(t=>String(t.name??'Jamoa').slice(0,100)+
      ' — a’zolar: '+Number(t.memberCount??0)).join('\n')
    :'Staging bazasida TEAMS katalogi hali import qilinmagan.';
 }catch(error){teamsResult.textContent='Xato: '+readable(error);}
 finally{teamsButton.disabled=false;}
});

inboxButton.addEventListener('click',async()=>{
 inboxButton.disabled=true;inboxResult.textContent='Bildirishnomalar olinmoqda…';
 try{
  const result=await call('notifications',{limit:10});
  if(result?.ok!==true||!Array.isArray(result.notifications))throw Error('INVALID_INBOX');
  inboxResult.textContent=result.notifications.length
   ?result.notifications.map(n=>String(n.title??'Xabar').slice(0,90)+
      ' — '+(n.isRead?'o‘qilgan':'yangi')).join('\n')
   :'Staging bazasida bildirishnoma yo‘q.';
 }catch(error){inboxResult.textContent='Xato: '+readable(error);}
 finally{inboxButton.disabled=false;}
});
requestsButton.addEventListener('click',async()=>{
 requestsButton.disabled=true;requestsResult.textContent='TEAMS arizalari olinmoqda…';
 try{
  const result=await call('teamJoinQueue',{scope:'mine',limit:20});
  if(result?.ok!==true||!Array.isArray(result.requests))throw Error('INVALID_TEAM_REQUESTS');
  requestsResult.textContent=result.requests.length
   ?result.requests.map(r=>String(r.teamName??'Jamoa').slice(0,70)+
      ' — '+String(r.status??'').slice(0,20)).join('\n')
   :'Staging bazasida ariza topilmadi.';
 }catch(error){requestsResult.textContent='Xato: '+readable(error);}
 finally{requestsButton.disabled=false;}
});
overviewButton.addEventListener('click',async()=>{
 overviewButton.disabled=true;staffResult.textContent='Admin statistikasi olinmoqda…';
 try{
  const result=await call('adminOverview');
  if(result?.ok!==true||!result.stats||typeof result.stats!=='object')
    throw Error('INVALID_ADMIN_OVERVIEW');
  const permitted=['users','seasons','leagues','clubs','occupancies','competitions',
    'fixtures','resultSubmissions','disputes','notifications'];
  staffResult.textContent=permitted.map(k=>k+': '+Number(result.stats[k]??0)).join('\n');
 }catch(error){staffResult.textContent='Xato: '+readable(error);}
 finally{overviewButton.disabled=false;}
});
auditButton.addEventListener('click',async()=>{
 auditButton.disabled=true;staffResult.textContent='UZEFLIFE joriy tur tekshirilmoqda…';
 try{
  const result=await call('uzeflifeRoundAudit',{limit:10});
  if(result?.ok!==true)throw Error('INVALID_ROUND_AUDIT');
  if(!result.available){staffResult.textContent='Sinov bazasida UZEFLIFE yo‘q.';return;}
  staffResult.textContent='Joriy tur: '+String(result.round)+
    '\nJami uchrashuvlar: '+Number(result.stats?.total??0)+
    '\nYakunlangan: '+Number(result.stats?.completed??0)+
    '\nJavobsiz: '+Number(result.stats?.unresolved??0)+
    '\nRaqib ma’lumoti to‘liq emas: '+Number(result.stats?.incompleteOpponents??0)+
    '\nRejim: faqat o‘qish, tur o‘zgarmaydi.';
 }catch(error){staffResult.textContent='Xato: '+readable(error);}
 finally{auditButton.disabled=false;}
});

competitionsButton.addEventListener('click',async()=>{
 if(!activeSeasonId)return;
 competitionsButton.disabled=true;fixturesResult.textContent='Musobaqalar olinmoqda…';
 try{
  const result=await call('competitions',{seasonId:activeSeasonId,limit:50});
  if(result?.ok!==true||!Array.isArray(result.competitions))
    throw Error('INVALID_COMPETITION_FEED');
  fixturesResult.textContent=result.competitions.length
    ?result.competitions.map(x=>String(x.name??'Musobaqa').slice(0,80)+
      ' — '+String(x.status??'').slice(0,20)).join('\n')
    :'Staging bazasida ushbu mavsumning musobaqalari topilmadi.';
 }catch(error){fixturesResult.textContent='Xato: '+readable(error);}
 finally{competitionsButton.disabled=false;}
});
fixturesButton.addEventListener('click',async()=>{
 if(!activeSeasonId)return;
 fixturesButton.disabled=true;fixturesResult.textContent='Uchrashuvlaringiz olinmoqda…';
 try{
  const result=await call('myFixtures',{seasonId:activeSeasonId,limit:30});
  if(result?.ok!==true||!Array.isArray(result.fixtures))
    throw Error('INVALID_OWNER_FIXTURES');
  fixturesResult.textContent=result.fixtures.length
    ?result.fixtures.map(f=>'Tur '+Number(f.round??0)+': '+
      String(f.status??'').slice(0,20)+
      (f.homeScore!=null&&f.awayScore!=null?' — '+Number(f.homeScore)+':'+Number(f.awayScore):'')).join('\n')
    :'Ushbu mavsumda faol klubingiz uchun o‘yin topilmadi.';
 }catch(error){fixturesResult.textContent='Xato: '+readable(error);}
 finally{fixturesButton.disabled=false;}
});
