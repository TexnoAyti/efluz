// Isolated staging UI. NO Vercel, legacy /api, fetch or production writes.
// Only platform-signed Telegram.WebApp.Serverless.call is permitted.
const state=document.getElementById('state');
const health=document.getElementById('health');
const profile=document.getElementById('profileResult');
const connect=document.getElementById('connect');
const profileButton=document.getElementById('profile');
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
