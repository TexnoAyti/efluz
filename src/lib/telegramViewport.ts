/** Measure the visible WebView, including keyboard and SDK fullscreen changes. */
export function installTelegramViewport(){
 const root=document.documentElement,visual=window.visualViewport;
 let frame=0,app:any,header:Element|null=null,stopped=false;
 const events=['viewportChanged','safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'];
 const positive=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;
 const update=()=>{
  frame=0;if(stopped)return;
  const sdk=(window as any).Telegram?.WebApp;
  if(sdk!==app){for(const event of events)app?.offEvent?.(event,schedule);app=sdk;for(const event of events)app?.onEvent?.(event,schedule);}
  const height=Math.min(...[positive(window.innerHeight),positive(visual?.height),positive(app?.viewportHeight)].filter(Boolean));
  if(Number.isFinite(height))root.style.setProperty('--efl-viewport-height',`${height}px`);
  root.style.setProperty('--efl-viewport-top',`${Math.max(0,visual?.offsetTop||0)}px`);
  const stable=positive(app?.viewportStableHeight)||positive(window.innerHeight);
  root.dataset.eflKeyboard=stable-height>120?'open':'closed';
  const next=document.querySelector('.efl-app-header');
  if(next!==header){if(header)resize?.unobserve(header);header=next;if(header)resize?.observe(header);}
  root.style.setProperty('--efl-header-height',`${header?.getBoundingClientRect().height||61}px`);
 };
 const schedule=()=>{if(!frame&&!stopped)frame=requestAnimationFrame(update);};
 const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
 const mutation=new MutationObserver(()=>{if(document.querySelector('.efl-app-header')!==header)schedule();});
 mutation.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});
 const script=document.getElementById('telegram-web-app-sdk');script?.addEventListener('load',schedule);
 window.addEventListener('resize',schedule);visual?.addEventListener('resize',schedule);visual?.addEventListener('scroll',schedule);
 update();
 return ()=>{stopped=true;cancelAnimationFrame(frame);mutation.disconnect();resize?.disconnect();script?.removeEventListener('load',schedule);window.removeEventListener('resize',schedule);visual?.removeEventListener('resize',schedule);visual?.removeEventListener('scroll',schedule);for(const event of events)app?.offEvent?.(event,schedule);};
}
