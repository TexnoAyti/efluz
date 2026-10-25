/** Public navigation link; authentication and subscription remain server-side. */
export const EL_CLASICO_LINK='https://t.me/efluzbot?startapp=el_clasico';
export function readElClasicoLaunch(){
 if(typeof window==='undefined')return false;
 const query=new URLSearchParams(window.location.search),app=(window as any).Telegram?.WebApp;
 if(query.get('teamEvent')==='el-clasico')return true;
 let stored='';try{stored=sessionStorage.getItem('efootball_tg_init_data')||'';}catch{}
 const launch=app?.initDataUnsafe?.start_param||new URLSearchParams(app?.initData||stored).get('start_param')||query.get('tgWebAppStartParam')||query.get('startapp');
 return launch==='el_clasico';
}
