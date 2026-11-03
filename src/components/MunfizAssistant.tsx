import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Minus} from 'lucide-react';
import {useI18n} from '../i18n';
import {assistantPage,parkMunfiz,buildMunfizDirectTour,type MunfizControl,type AssistantPoint,type AssistantRect} from '../lib/munfizAssistant';
import {findGuideTarget,guideViewport,type GuideStep} from '../lib/firstVisitGuide';
import {munfizCopy,munfizPagePurpose,munfizBriefControl,munfizControlTitle} from '../content/munfizHelp';
import './munfiz-assistant.css';
const Guide=lazy(()=>import('./FirstVisitGuide').then(m=>({default:m.FirstVisitGuide})));
const visible=(el:Element)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
const readViewport=()=>typeof window==='undefined'?{width:390,height:844,top:0,left:0}:guideViewport(window.innerWidth||390,window.innerHeight||844,window.visualViewport,(window as any).Telegram?.WebApp?.viewportHeight);

export function MunfizAssistant({userId,page}:{userId:string;page:string}){
 const {language}=useI18n();const c=munfizCopy[language]||munfizCopy.uz;
 const [section,setSection]=useState('');
 const [pose,setPose]=useState('still'),[facing,setFacing]=useState(1);
 const [category,setCategory]=useState<string|null>(null);
 const [minimized,setMinimized]=useState(()=>{try{return localStorage.getItem(`efl:munfiz:${userId}`)==='small';}catch{return false;}});
 const [position,setPosition]=useState<AssistantPoint>({x:8,y:160}),[walking,setWalking]=useState(false),[dragging,setDragging]=useState(false),[blocked,setBlocked]=useState(false),[reduced,setReduced]=useState(false);
 const [tour,setTour]=useState<GuideStep[]|null>(null);
 const root=useRef<HTMLDivElement>(null),avatar=useRef<HTMLButtonElement>(null),pos=useRef(position),drag=useRef<{x:number;y:number;origin:AssistantPoint;moved:boolean}|null>(null);
 const poseIndex=useRef(0),tourContext=useRef('');
 const motionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const poseTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const pageKey=assistantPage(page,category),contextKey=`${pageKey}:${section}`;
 useEffect(()=>()=>{if(poseTimer.current)clearTimeout(poseTimer.current);},[]);
 const view=readViewport;
 const move=(avoid:AssistantRect[]=[],preferred?:AssistantPoint,animate=true)=>{
  const v=view(),style=getComputedStyle(document.body),n=(s:string)=>parseFloat(s)||0;
  const controls=Array.from(document.querySelectorAll('main button,main a,nav button,.efl-app-header button')).filter(el=>!root.current?.contains(el)&&visible(el)).map(el=>el.getBoundingClientRect()).filter(r=>r.bottom>v.top&&r.top<v.top+v.height);
  const p=parkMunfiz(v.width,v.height,[...avoid,...controls].map(r=>({...r,top:r.top-v.top,bottom:r.bottom-v.top})),preferred?{x:preferred.x,y:preferred.y-v.top}:undefined,{top:Math.max(80,n(style.paddingTop)+64),bottom:Math.max(106,n(style.paddingBottom)+90),left:Math.max(8,n(style.paddingLeft)),right:Math.max(8,n(style.paddingRight))});p.y+=v.top;
  const moved=Math.hypot(p.x-pos.current.x,p.y-pos.current.y)>4;
  if(Math.abs(p.x-pos.current.x)>3)setFacing(p.x>pos.current.x?1:-1);
  pos.current=p;setPosition(p);if(motionTimer.current)clearTimeout(motionTimer.current);
  if(animate&&moved){setWalking(true);motionTimer.current=setTimeout(()=>setWalking(false),1100);}else setWalking(false);
 };
 useEffect(()=>{
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{if(tourContext.current!==contextKey)setTour(null);},[contextKey,userId]);
 useEffect(()=>{
  let frame=0;
  const refresh=()=>{
   setCategory(document.querySelector('[data-munfiz-page]')?.getAttribute('data-munfiz-page')||null);
   const sections=Array.from(document.querySelectorAll<HTMLElement>('main [data-munfiz-section]')).filter(visible);
   const selected=sections[sections.length-1];setSection(selected?.dataset.munfizSection||'');
   const modal=Array.from(document.querySelectorAll('.efl-guide-layer,[role="dialog"],dialog[open]')).some(el=>!root.current?.contains(el)&&visible(el));setBlocked(modal);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(refresh);};
  const observer=new MutationObserver(records=>{if(records.some(r=>!root.current?.contains(r.target)))schedule();});
  observer.observe(document.querySelector('main')||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-munfiz-page','data-munfiz-section','aria-pressed','disabled']});
  // Dialogs live beside main; observe their insertion without tracking character animation.
  const dialogs=new MutationObserver(schedule);const app=document.querySelector('main')?.parentElement;if(app)dialogs.observe(app,{childList:true});
  refresh();return()=>{observer.disconnect();dialogs.disconnect();cancelAnimationFrame(frame);};
 },[page,language]);
 useEffect(()=>{
  const resize=()=>{
   move([],pos.current,false);
  };resize();
  const avoidClick=(event:PointerEvent)=>{
   if(tour)return;
   const element=event.target instanceof Element?event.target:null;if(!element||root.current?.contains(element))return;
   const control=element.closest('button,a,input,select,textarea');if(control)move([control.getBoundingClientRect()],pos.current);
  };
  const timer=setInterval(()=>{if(document.hidden||!!tour||blocked||minimized||drag.current||reduced)return;move([], {x:pos.current.x<window.innerWidth/2?window.innerWidth:0,y:pos.current.y});},14000);
  document.addEventListener('pointerdown',avoidClick,true);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
  const app=(window as any).Telegram?.WebApp;app?.onEvent?.('viewportChanged',resize);app?.onEvent?.('safeAreaChanged',resize);app?.onEvent?.('contentSafeAreaChanged',resize);app?.onEvent?.('fullscreenChanged',resize);
  return()=>{clearInterval(timer);document.removeEventListener('pointerdown',avoidClick,true);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);app?.offEvent?.('viewportChanged',resize);app?.offEvent?.('safeAreaChanged',resize);app?.offEvent?.('contentSafeAreaChanged',resize);app?.offEvent?.('fullscreenChanged',resize);if(motionTimer.current)clearTimeout(motionTimer.current);};
 },[tour,blocked,minimized,reduced]);
 useEffect(()=>{
  const actions=['look','idle','think','sit','idle','bow'];
  const timer=setInterval(()=>{if(!document.hidden&&!tour&&!blocked&&!minimized&&!reduced&&!walking&&!drag.current)setPose(actions[poseIndex.current++%actions.length]);},6500);
  return()=>clearInterval(timer);
 },[tour,blocked,minimized,reduced,walking]);
 const collectControls=()=>{
  const candidates:MunfizControl[]=[];
  const add=(id:string,selector:string)=>{
   const el=findGuideTarget(document,selector),text=munfizBriefControl(id,language);
   if(!el||!text)return;
   candidates.push({id,target:selector,title:munfizControlTitle(id,(el.getAttribute('aria-label')||el.textContent?.trim()||c.tour).replace(/\s+/g,' ').slice(0,65),language),description:text,disabled:el.matches(':disabled'),selected:el.getAttribute('aria-pressed')==='true'});
  };
  // Page actions first. Global navigation belongs only to the first-visit tour.
  for(const id of ['opponent-chat','score-entry','match-actions','standings-entry'])add(id,`main [data-guide="${id}"]`);
  const ids=new Set(Array.from(document.querySelectorAll<HTMLElement>('main [data-munfiz-control]')).filter(visible).map(el=>el.dataset.munfizControl!));
  for(const id of ids)add(id,`main [data-munfiz-control="${id}"][data-munfiz-own="true"],main [data-munfiz-control="${id}"]`);
  const unique=new Set<string>();
  const hasInner=candidates.some(item=>item.id.startsWith('section-'));
  return candidates.filter(item=>{
   if(hasInner&&item.id.startsWith('category-'))return false;
   const key=item.id.toLowerCase();if(unique.has(key)||unique.has(item.target))return false;unique.add(key);unique.add(item.target);return true;
  });
 };
 const startTour=()=>{
  const scope=Array.from(document.querySelectorAll<HTMLElement>('main [data-munfiz-section]')).filter(visible).at(-1);
  const localSection=scope?.dataset.munfizSection||'';
  const category=document.querySelector('[data-munfiz-page]')?.getAttribute('data-munfiz-page');
  const localPage=assistantPage(page,category);
  const selectedLabel=scope?.querySelector('[aria-pressed="true"]')?.textContent?.trim();
  const title=selectedLabel||Array.from(document.querySelectorAll('main h1,main h2')).find(visible)?.textContent?.trim()||'Munfiz';
  const purpose=munfizPagePurpose(localPage,localSection,language);
  const locked={uz:'Hozir bu tugma yopiq; u bilan amal bajarilmaydi.',ru:'Сейчас кнопка недоступна, действие не выполняется.',en:'This control is currently unavailable; no action will be performed.'}[language];
  tourContext.current=`${localPage}:${localSection}`;setWalking(false);setTour(buildMunfizDirectTour(title,purpose,collectControls(),locked));
 };
 const small=(value:boolean)=>{setMinimized(value);try{localStorage.setItem(`efl:munfiz:${userId}`,value?'small':'full');}catch{}};
 return <>
  {tour&&<Suspense fallback={null}><Guide steps={tour} mascot direct onFinish={status=>{setTour(null);if(status!=='completed')return;setPose('victory');if(poseTimer.current)clearTimeout(poseTimer.current);poseTimer.current=setTimeout(()=>setPose('idle'),2000);try{localStorage.setItem(`efl:munfiz-tour:v2:${userId}:${contextKey}`,'done');}catch{}}}/></Suspense>}
  <div ref={root} className="munfiz-root" data-reduced={reduced} hidden={blocked||!!tour}>
   <div className="munfiz-avatar" data-dragging={dragging} style={{transform:`translate3d(${position.x}px,${position.y}px,0)`}}>
    {!minimized&&<button type="button" className="munfiz-minimize" onClick={()=>small(true)} aria-label={c.hide}><Minus size={14}/></button>}
    <button ref={avatar} type="button" className={`munfiz-character ${minimized?'is-small':''}`} aria-label={c.open} aria-haspopup="dialog"
     onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,origin:pos.current,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
     onPointerMove={e=>{const d=drag.current;if(!d)return;const v=view();const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>6)d.moved=true;if(d.moved){setDragging(true);const p={x:Math.max(0,Math.min(window.innerWidth-84,d.origin.x+dx)),y:Math.max(v.top,Math.min(v.top+v.height-120,d.origin.y+dy))};pos.current=p;setPosition(p);}}}
     onPointerUp={()=>{const moved=drag.current?.moved;drag.current=null;setDragging(false);if(moved){move([],pos.current,false);return;}if(minimized)small(false);startTour();}}
     onPointerCancel={()=>{drag.current=null;setDragging(false);move([],pos.current,false);}}
     onClick={e=>{if(e.detail===0){if(minimized)small(false);startTour();}}}>
     <img src={`/munfiz/v2/${reduced?'still':walking?'walk':pose}.webp`} alt="" draggable={false} width="84" height="115" style={{transform:`scaleX(${facing})`}}/>
    </button>
   </div>

  </div>
 </>;
}
