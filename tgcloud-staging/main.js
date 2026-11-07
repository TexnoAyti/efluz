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
