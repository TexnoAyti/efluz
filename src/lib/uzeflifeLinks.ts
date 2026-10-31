/** Navigation only: all match actions still require server authentication. */
export function readUzeflifeLaunch():string|null {
 if(typeof window==='undefined')return null;
 const q=new URLSearchParams(window.location.search),app=(window as any).Telegram?.WebApp;
 let stored='';try{stored=sessionStorage.getItem('efootball_tg_init_data')||'';}catch{}
 const launch=app?.initDataUnsafe?.start_param||new URLSearchParams(app?.initData||stored).get('start_param')||q.get('tgWebAppStartParam')||q.get('startapp');
 const match=/^uze_((?:r[1-8]|l(?:[1-9]|1[0-5]))m\d{1,3})$/.exec(launch||'');
 return match?.[1]||(q.get('competition')==='uzeflife'?(/^(?:r[1-8]|l(?:[1-9]|1[0-5]))m\d{1,3}$/.test(q.get('match')||'')?q.get('match')!:''):null);
}
export function uzeflifeMatchLink(id:string){
 if(!/^(?:r[1-8]|l(?:[1-9]|1[0-5]))m\d{1,3}$/.test(id))throw Error('INVALID_UZEFLIFE_MATCH');
 return `https://t.me/efluzbot?startapp=uze_${id}`;
}

/** Notification data is untrusted navigation input, never a URL to open directly. */
export function openUzeflifeMatch(id:string){
 const url=uzeflifeMatchLink(id),app=(window as any).Telegram?.WebApp;
 if(app?.openTelegramLink)app.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer');
}
