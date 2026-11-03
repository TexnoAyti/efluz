import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {BookOpen,ChevronRight,HelpCircle,Minus,Route,X} from 'lucide-react';
import {useI18n} from '../i18n';
import {assistantPage,parkMunfiz,selectMunfizControls,munfizHelpLayout,type MunfizControl,type AssistantPoint,type AssistantRect} from '../lib/munfizAssistant';
import {findGuideTarget,guideViewport,type GuideStep} from '../lib/firstVisitGuide';
import {munfizCopy,munfizSectionDescription,munfizControlDescription,munfizQuestionIndexes,munfizControlTitle,munfizChecklist} from '../content/munfizHelp';
import {playerFaq} from '../content/playerFaq';
import './munfiz-assistant.css';
const Guide=lazy(()=>import('./FirstVisitGuide').then(m=>({default:m.FirstVisitGuide})));
const visible=(el:Element)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
const readViewport=()=>typeof window==='undefined'?{width:390,height:844,top:0,left:0}:guideViewport(window.innerWidth||390,window.innerHeight||844,window.visualViewport,(window as any).Telegram?.WebApp?.viewportHeight);

export function MunfizAssistant({userId,page}:{userId:string;page:string}){
 const {language}=useI18n();const c=munfizCopy[language]||munfizCopy.uz;
 const [section,setSection]=useState(''),[sectionLabel,setSectionLabel]=useState(''),[hasSections,setHasSections]=useState(false),[scoreLocked,setScoreLocked]=useState(false);
 const [pose,setPose]=useState('still'),[facing,setFacing]=useState(1);
 const [category,setCategory]=useState<string|null>(null),[open,setOpen]=useState(false),[expanded,setExpanded]=useState<number|null>(null);
 const [minimized,setMinimized]=useState(()=>{try{return localStorage.getItem(`efl:munfiz:${userId}`)==='small';}catch{return false;}});
 const [position,setPosition]=useState<AssistantPoint>({x:8,y:160}),[walking,setWalking]=useState(false),[dragging,setDragging]=useState(false),[blocked,setBlocked]=useState(false),[reduced,setReduced]=useState(false);
 const [tour,setTour]=useState<GuideStep[]|null>(null),[message,setMessage]=useState(''),[seen,setSeen]=useState(false);
 const [viewport,setViewport]=useState(readViewport);
 const [helpTab,setHelpTab]=useState<'explain'|'actions'|'questions'>('explain'),[catalog,setCatalog]=useState<MunfizControl[]>([]),[query,setQuery]=useState('');
 const root=useRef<HTMLDivElement>(null),avatar=useRef<HTMLButtonElement>(null),pos=useRef(position),drag=useRef<{x:number;y:number;origin:AssistantPoint;moved:boolean}|null>(null);
 const poseIndex=useRef(0);
 const motionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const poseTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const pageKey=assistantPage(page,category),contextKey=`${pageKey}:${section}`;
 const faq=playerFaq[language]||playerFaq.uz;
 const description=munfizSectionDescription(pageKey,section,language);
 const checklist=munfizChecklist(pageKey,section,language);
 const localQuestions=munfizQuestionIndexes(pageKey,section).map(index=>faq.items[index]);
 const sectionsLabel={uz:'Boshqa bo‘limlar nima uchun?',ru:'Для чего другие разделы?',en:'What are the other sections for?'}[language];
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
 useEffect(()=>{setOpen(false);setHelpTab('explain');setQuery('');setTour(null);setMessage('');try{setSeen(localStorage.getItem(`efl:munfiz-tour:v2:${userId}:${contextKey}`)==='done');}catch{setSeen(false);}},[contextKey,userId]);
 useEffect(()=>{
  let frame=0;
  const refresh=()=>{
   setCategory(document.querySelector('[data-munfiz-page]')?.getAttribute('data-munfiz-page')||null);
   const sections=Array.from(document.querySelectorAll<HTMLElement>('main [data-munfiz-section]')).filter(visible);
   const selected=sections[sections.length-1];setSection(selected?.dataset.munfizSection||'');
   setSectionLabel(selected?.querySelector('[aria-pressed="true"]')?.textContent?.trim()||'');
   setHasSections(Array.from(document.querySelectorAll('main [data-munfiz-control^="section-"],main [data-munfiz-control^="category-"]')).filter(visible).length>1);
   setScoreLocked(!!document.querySelector('main [data-guide="score-entry"]:disabled'));
   setCatalog(collectControls());
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
   setViewport(view());
   if(!open)move([],pos.current,false);
  };resize();
  const avoidClick=(event:PointerEvent)=>{
   const element=event.target instanceof Element?event.target:null;if(!element||root.current?.contains(element))return;
   if(open)setOpen(false);
   const control=element.closest('button,a,input,select,textarea');if(control)move([control.getBoundingClientRect()],pos.current);
  };
  const timer=setInterval(()=>{if(document.hidden||open||blocked||minimized||drag.current||reduced)return;move([], {x:pos.current.x<window.innerWidth/2?window.innerWidth:0,y:pos.current.y});},14000);
  document.addEventListener('pointerdown',avoidClick,true);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
  const app=(window as any).Telegram?.WebApp;app?.onEvent?.('viewportChanged',resize);app?.onEvent?.('safeAreaChanged',resize);app?.onEvent?.('contentSafeAreaChanged',resize);app?.onEvent?.('fullscreenChanged',resize);
  return()=>{clearInterval(timer);document.removeEventListener('pointerdown',avoidClick,true);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);app?.offEvent?.('viewportChanged',resize);app?.offEvent?.('safeAreaChanged',resize);app?.offEvent?.('contentSafeAreaChanged',resize);app?.offEvent?.('fullscreenChanged',resize);if(motionTimer.current)clearTimeout(motionTimer.current);};
 },[open,blocked,minimized,reduced]);
 useEffect(()=>{root.current?.querySelector('.munfiz-panel-copy')?.scrollTo({top:0});},[helpTab]);
 useEffect(()=>{
  if(!open)return;
  const focus=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const siblings=Array.from(root.current?.parentElement?.children||[]).filter(el=>el!==root.current) as HTMLElement[];
  const inert=siblings.map(el=>el.inert);siblings.forEach(el=>{el.inert=true;});
  root.current?.querySelector<HTMLButtonElement>('.munfiz-panel-close')?.focus({preventScroll:true});
  const onKey=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);return;}
   if(e.key!=='Tab')return;
   const buttons=Array.from(root.current?.querySelectorAll<HTMLElement>('.munfiz-panel button:not(:disabled),.munfiz-panel input')||[]).filter(visible);
   const first=buttons[0],last=buttons[buttons.length-1];
   if(e.shiftKey&&(document.activeElement===first||!root.current?.contains(document.activeElement))){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!root.current?.contains(document.activeElement))){e.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',onKey,true);
  return()=>{document.removeEventListener('keydown',onKey,true);document.body.style.overflow=overflow;siblings.forEach((el,i)=>{el.inert=inert[i];});if(focus?.isConnected)focus.focus({preventScroll:true});};
 },[open]);
 useEffect(()=>{
  if(poseTimer.current)clearTimeout(poseTimer.current);
  if(open){setPose('wave');poseTimer.current=setTimeout(()=>setPose('think'),1800);}else setPose('still');
  return()=>{if(poseTimer.current)clearTimeout(poseTimer.current);};
 },[open]);
 useEffect(()=>{
  const actions=['look','idle','think','sit','idle','bow'];
  const timer=setInterval(()=>{if(!document.hidden&&!open&&!blocked&&!minimized&&!reduced&&!walking&&!drag.current)setPose(actions[poseIndex.current++%actions.length]);},6500);
  return()=>clearInterval(timer);
 },[open,blocked,minimized,reduced,walking]);
 const collectControls=()=>{
  const candidates:MunfizControl[]=[];
  const add=(id:string,selector:string)=>{
   const el=findGuideTarget(document,selector),text=munfizControlDescription(id,language);
   if(!el||!text)return;
   candidates.push({id,target:selector,title:munfizControlTitle(id,(el.getAttribute('aria-label')||el.textContent?.trim()||c.tour).replace(/\s+/g,' ').slice(0,65),language),description:text,disabled:el.matches(':disabled'),selected:el.getAttribute('aria-pressed')==='true'});
  };
  // Page actions first. Global navigation belongs only to the first-visit tour.
  for(const id of ['opponent-chat','score-entry','standings-entry'])add(id,`main [data-guide="${id}"]`);
  const ids=new Set(Array.from(document.querySelectorAll<HTMLElement>('main [data-munfiz-control]')).filter(visible).map(el=>el.dataset.munfizControl!));
  for(const id of ids)add(id,`main [data-munfiz-control="${id}"]`);
  const unique=new Set<string>();
  const hasInner=candidates.some(item=>item.id.startsWith('section-'));
  return candidates.filter(item=>{
   if(hasInner&&item.id.startsWith('category-'))return false;
   const key=item.id.toLowerCase();if(unique.has(key)||unique.has(item.target))return false;unique.add(key);unique.add(item.target);return true;
  });
 };
 const startTour=(mode:'page'|'sections'='page',single?:MunfizControl)=>{
  const candidates=collectControls();
  const selected=single?[single]:selectMunfizControls(candidates,mode);
  const steps=selected.map(({target,title,description,disabled})=>({target,title,description:disabled?description+' '+({uz:'Bu amal hozir faol emas. O‘yin yoki bo‘limdagi cheklov holatini tekshiring.',ru:'Сейчас это действие недоступно. Проверьте ограничение в матче или разделе.',en:'This action is currently unavailable. Check the restriction shown in this match or section.'}[language]):description}));
  if(!steps.length){setMessage(c.empty);return;}
  setMessage('');setTour(steps);setOpen(false);
 };
 const small=(value:boolean)=>{setMinimized(value);setOpen(false);try{localStorage.setItem(`efl:munfiz:${userId}`,value?'small':'full');}catch{}};
 const v=viewport;
 const style=typeof document==='undefined'?null:getComputedStyle(document.body),inset=(value?:string)=>parseFloat(value||'')||0;
 const panel=munfizHelpLayout(v.width,v.height,v.top,{top:inset(style?.paddingTop),bottom:inset(style?.paddingBottom),left:inset(style?.paddingLeft),right:inset(style?.paddingRight)});
 const labels=language==='ru'?{about:'Пояснение',actions:'Все действия',questions:'Вопросы',find:'Найти действие',show:'Показать',locked:'Недоступно',current:'Вы здесь',empty:'Нет совпадений. Очистите поиск.'}:language==='en'?{about:'Explanation',actions:'All actions',questions:'Questions',find:'Find an action',show:'Show me',locked:'Unavailable',current:'You are here',empty:'No matches. Clear your search.'}:{about:'Tushuntirish',actions:'Barcha amallar',questions:'Savollar',find:'Amalni qidirish',show:'Ko‘rsat',locked:'Hozir yopiq',current:'Shu bo‘limdasiz',empty:'Mos amal topilmadi. Qidiruvni tozalang.'};
 const listed=catalog.filter(item=>(item.title+' '+item.description).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <>
  {tour&&<Suspense fallback={null}><Guide steps={tour} mascot onFinish={status=>{setTour(null);if(status!=='completed')return;setSeen(true);setPose('victory');if(poseTimer.current)clearTimeout(poseTimer.current);poseTimer.current=setTimeout(()=>setPose('idle'),2000);try{localStorage.setItem(`efl:munfiz-tour:v2:${userId}:${contextKey}`,'done');}catch{}}}/></Suspense>}
  <div ref={root} className="munfiz-root" data-reduced={reduced} hidden={blocked||!!tour}>
   <div className="munfiz-avatar" hidden={open} data-dragging={dragging} style={{transform:`translate3d(${position.x}px,${position.y}px,0)`}}>
    {!minimized&&<button type="button" className="munfiz-minimize" onClick={()=>small(true)} aria-label={c.hide}><Minus size={14}/></button>}
    <button ref={avatar} type="button" className={`munfiz-character ${minimized?'is-small':''}`} aria-label={c.open} aria-expanded={open} aria-controls="munfiz-help-panel"
     onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,origin:pos.current,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
     onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>6)d.moved=true;if(d.moved){setDragging(true);const p={x:Math.max(0,Math.min(window.innerWidth-84,d.origin.x+dx)),y:Math.max(v.top,Math.min(v.top+v.height-120,d.origin.y+dy))};pos.current=p;setPosition(p);}}}
     onPointerUp={()=>{const moved=drag.current?.moved;drag.current=null;setDragging(false);if(moved){move([],pos.current,false);return;}if(minimized)small(false);setOpen(value=>!value);}}
     onPointerCancel={()=>{drag.current=null;setDragging(false);move([],pos.current,false);}}
     onClick={e=>{if(e.detail===0){if(minimized)small(false);setOpen(value=>!value);}}}>
     <img src={`/munfiz/v2/${reduced?'still':walking?'walk':pose}.webp`} alt="" draggable={false} width="84" height="115" style={{transform:`scaleX(${facing})`}}/>
    </button>
   </div>
   {open&&<>
    <div className="munfiz-backdrop" onClick={()=>setOpen(false)} aria-hidden="true"/>
    <section id="munfiz-help-panel" className="munfiz-panel" role="dialog" aria-modal="true" aria-labelledby="munfiz-help-title" style={panel}>
     <header><img className="munfiz-help-portrait" src="/munfiz/v2/still.webp" alt="" width="40" height="55"/><div><strong id="munfiz-help-title">Munfiz</strong><p className="munfiz-context-label">{sectionLabel||c.intro}</p></div><button type="button" className="munfiz-panel-close" onClick={()=>setOpen(false)} aria-label={c.close}><X size={20}/></button></header>
     <nav className="munfiz-help-tabs" aria-label="Munfiz">{([['explain',labels.about],['actions',labels.actions+' ('+catalog.length+')'],['questions',labels.questions]] as const).map(([id,title])=><button key={id} type="button" aria-pressed={helpTab===id} onClick={()=>setHelpTab(id)}>{title}</button>)}</nav>
     <div className="munfiz-panel-copy">
      {helpTab==='explain'&&<><h2>{c.explain}</h2><p>{description}</p>{checklist.length>0&&<ol className="munfiz-checklist">{checklist.map(item=><li key={item}>{item}</li>)}</ol>}
       {scoreLocked&&<p className="munfiz-state">{{uz:'Hisob kiritish hozir yopiq. O‘yin kartasidagi holatni tekshiring; boshqa o‘yinga natija yozmang.',ru:'Ввод счёта сейчас закрыт. Проверьте статус матча; не отправляйте счёт в другой матч.',en:'Score entry is currently locked. Check the match status; do not submit the score to another match.'}[language]}</p>}
       {seen&&<p>{c.seen}</p>}
      </>}
      {helpTab==='actions'&&<><label className="munfiz-catalog-search">{labels.find}<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="munfiz-catalog">{listed.map(item=><article key={item.id}><h2>{item.title}</h2>{(item.disabled||item.selected)&&<span className="munfiz-state-label">{item.disabled?labels.locked:labels.current}</span>}<p>{item.description}</p><button type="button" className="munfiz-action" onClick={()=>startTour('page',item)}><Route size={16}/>{labels.show}</button></article>)}</div>{listed.length===0&&<p role="status">{query?labels.empty:c.empty}</p>}</>}
      {helpTab==='questions'&&<div className="munfiz-faq">{localQuestions.map(([q,a],index)=><div key={q}><button type="button" aria-expanded={expanded===index} aria-controls={`munfiz-answer-${index}`} onClick={()=>setExpanded(expanded===index?null:index)}><HelpCircle size={16}/>{q}</button><p id={`munfiz-answer-${index}`} hidden={expanded!==index}>{a}</p></div>)}</div>}
      {message&&<p role="status">{message}</p>}
     </div>
     <footer className="munfiz-panel-actions"><button type="button" className="munfiz-action primary" onClick={()=>startTour()}><Route size={17}/>{seen?({uz:'Yo‘riqnomani qayta ko‘rish',ru:'Повторить знакомство',en:'Replay this tour'}[language]):c.tour}<ChevronRight size={16}/></button>{hasSections&&<button type="button" className="munfiz-action" onClick={()=>startTour('sections')}><BookOpen size={17}/>{sectionsLabel}</button>}</footer>
    </section>
   </>}

  </div>
 </>;
}
