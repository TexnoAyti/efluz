import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AlertTriangle,ArrowLeft,Check,Flag,LoaderCircle,Lock,MessageCircle,MoreVertical,Pin,PinOff,Gamepad2,RefreshCw,Reply,Send,ShieldAlert,Unlock,X} from 'lucide-react';
import {matchChatApi,onMatchChatOpen,readMatchChatLaunch,type MatchChatTarget} from '../lib/matchChat';
import type {MatchChatView} from '../types/matchChat';
import {useAuth} from '../context/AuthContext';
import {isValidTelegramUsername,openTelegramChat} from '../lib/telegramUtils';

export function MatchChatHost(){
 const {user,notifications,markNotificationAsRead}=useAuth(),[target,setTarget]=useState<MatchChatTarget|null>(null),[chat,setChat]=useState<MatchChatView|null>(null),[text,setText]=useState(''),[replyTo,setReplyTo]=useState<MatchChatView['messages'][number]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[menu,setMenu]=useState(false),[reporting,setReporting]=useState(false),[reportReason,setReportReason]=useState(''),[gameOpen,setGameOpen]=useState(false);
 const input=useRef<HTMLTextAreaElement>(null),loading=useRef(false),messages=useRef<HTMLDivElement>(null);
 const close=()=>{setGameOpen(false);setTarget(null);setChat(null);setText('');setReplyTo(null);setError('');setMenu(false);setReporting(false);};
 const load=useCallback(async(silent=false)=>{if(!target||loading.current)return;loading.current=true;if(!silent)setBusy(true);try{const next=await matchChatApi.read(target);setChat(next);setError('');const alert=notifications.find(n=>!n.isRead&&n.type==='MATCH_CHAT'&&n.data?.kind===target.kind&&n.data?.matchId===target.matchId);if(alert)void markNotificationAsRead(alert.id);}catch(e:any){if(!silent)setError(e.message||'Chat yuklanmadi.');}finally{loading.current=false;if(!silent)setBusy(false);}},[target,notifications,markNotificationAsRead]);
 useEffect(()=>{const open=(next:MatchChatTarget)=>{setGameOpen(false);setTarget(next);setChat(null);setError('');setText('');setMenu(false);};const stop=onMatchChatOpen(open),launch=readMatchChatLaunch();if(launch)open(launch);return stop;},[]);
 useEffect(()=>{if(!target)return;void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load(true);},10000);return()=>clearInterval(timer);},[target,load]);
 useEffect(()=>{if(chat?.messages.length)requestAnimationFrame(()=>messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:'smooth'}));},[chat?.messages.length]);
 useEffect(()=>{if(!target)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[target]);
 if(!target)return null;
 const send=async(value=text)=>{const body=value.trim();if(!body||busy||!chat?.canSend)return;setBusy(true);setError('');try{setChat(await matchChatApi.send(target,body,replyTo?.id));setText('');setReplyTo(null);input.current?.focus();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const pinMessage=async(messageId:string|null)=>{if(!chat||busy)return;setBusy(true);try{setChat(await matchChatApi.pin(target,messageId));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const toggleBlock=async()=>{if(!chat||busy)return;setBusy(true);try{setChat(await matchChatApi.block(target,!chat.blockedByMe));setMenu(false);setError('');}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const report=async()=>{if(busy||reportReason.trim().length<3)return;setBusy(true);try{setChat(await matchChatApi.report(target,reportReason));setReporting(false);setReportReason('');setMenu(false);setError('Shikoyat adminga yuborildi.');}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div className="match-chat-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="match-chat-sheet" role="dialog" aria-modal="true" aria-label="Raqib bilan chat">
   <header className="match-chat-header">
    <button className="match-chat-icon" onClick={close} aria-label="Chatni yopish"><ArrowLeft size={20}/></button>
    <div className="match-chat-avatar"><MessageCircle size={20}/><span/></div>
    <div className="min-w-0 flex-1"><h2>{chat?.opponentName||target.opponentName||'Raqib bilan chat'}</h2><p>{chat?.subtitle||target.title||'O‘yin chati'}</p></div>
    {chat&&isValidTelegramUsername(chat.opponentUsername)&&<button className="match-chat-icon" onClick={()=>openTelegramChat(chat.opponentUsername)} aria-label="Telegram profilini ochish" title="Telegram profilini ochish"><Send size={17}/></button>}
    <button className="match-chat-icon" onClick={()=>setMenu(!menu)} aria-label="Chat amallari"><MoreVertical size={20}/></button>
    <button className="match-chat-icon match-chat-close" onClick={close} aria-label="Yopish"><X size={20}/></button>
    {menu&&chat&&<div className="match-chat-menu">
      <button onClick={()=>void toggleBlock()}>{chat.blockedByMe?<Unlock size={16}/>:<Lock size={16}/>} {chat.blockedByMe?'Blokni olib tashlash':'Chatni bloklash'}</button>
      <button disabled={chat.reportedByMe} onClick={()=>{setReporting(true);setMenu(false);}}><Flag size={16}/> {chat.reportedByMe?'Shikoyat yuborilgan':'Shikoyat qilish'}</button>
    </div>}
   </header>
   <div className="match-chat-context"><ShieldAlert size={14}/><span>Bu chat faqat <b>{chat?.title||target.title||'shu o‘yin'}</b> raqiblari uchun.</span></div>
   {target.kind==='fixture'&&chat?.canSend&&<button type="button" className="match-chat-game-launch" onClick={()=>setGameOpen(true)}><Gamepad2 size={17}/><span>Penalti o‘ynash</span><small>Munfiz · mashg‘ulot</small></button>}
   {chat?.pinnedMessage&&<button className="match-chat-pinned" onClick={()=>{const el=document.getElementById(`match-message-${chat.pinnedMessage!.id}`);el?.scrollIntoView({behavior:'smooth',block:'center'});}}><Pin size={14}/><span><b>Qadalgan xabar</b><small>{chat.pinnedMessage.text}</small></span><PinOff size={14} onClick={e=>{e.stopPropagation();void pinMessage(null);}}/></button>}
   {reporting&&<div className="match-chat-report"><label>Shikoyat sababi<textarea maxLength={300} value={reportReason} onChange={e=>setReportReason(e.target.value)} placeholder="Muammoni qisqa va aniq yozing"/></label><div><button onClick={()=>setReporting(false)}>Bekor qilish</button><button className="primary" disabled={busy||reportReason.trim().length<3} onClick={()=>void report()}><Flag size={14}/>Yuborish</button></div></div>}
   <div ref={messages} className="match-chat-messages" aria-live="polite">
    {!chat&&busy&&<div className="match-chat-state"><LoaderCircle className="animate-spin"/><p>Chat ochilmoqda…</p></div>}
    {chat&&!chat.messages.length&&<div className="match-chat-empty"><div><MessageCircle size={28}/></div><h3>Suhbatni boshlang</h3><p>O‘yin vaqtini kelishib oling yoki xona ID yuboring.</p></div>}
    {chat?.messages.map((message,index)=>{const mine=message.senderId===user?.id,previous=chat.messages[index-1],showDay=!previous||new Date(previous.createdAt).toLocaleDateString('uz-UZ')!==new Date(message.createdAt).toLocaleDateString('uz-UZ'),avatar=message.avatarUrl||(!mine&&chat.opponentUsername?`https://t.me/i/userpic/320/${chat.opponentUsername}.jpg`:null);return <React.Fragment key={message.id}>{showDay&&<div className="match-chat-day">{new Date(message.createdAt).toLocaleDateString('uz-UZ',{timeZone:'Asia/Tashkent',day:'numeric',month:'long'})}</div>}<article id={`match-message-${message.id}`} className={`match-chat-row ${mine?'mine':'theirs'}`}><div className="match-chat-message-avatar">{avatar?<img src={avatar} alt=""/>:<span>{message.senderName.slice(0,1).toUpperCase()}</span>}</div><div className={`match-chat-bubble ${mine?'mine':'theirs'}`}>{message.replyTo&&<div className="match-chat-reply-preview"><b>{message.replyTo.senderName}</b><span>{message.replyTo.text}</span></div>}<p>{message.text}</p><div className="match-chat-message-tools"><button onClick={()=>setReplyTo(message)} aria-label="Xabarga javob berish"><Reply size={12}/></button><button onClick={()=>void pinMessage(chat.pinnedMessage?.id===message.id?null:message.id)} aria-label="Xabarni qadash">{chat.pinnedMessage?.id===message.id?<PinOff size={12}/>:<Pin size={12}/>}</button><time>{new Date(message.createdAt).toLocaleTimeString('uz-UZ',{timeZone:'Asia/Tashkent',hour:'2-digit',minute:'2-digit'})}{mine&&<Check size={12}/>}</time></div></div></article></React.Fragment>;})}
   </div>
   {error&&<div className={`match-chat-error ${error.includes('yuborildi')?'success':''}`} role="status">{error.includes('yuborildi')?<Check size={15}/>:<AlertTriangle size={15}/>}<span>{error}</span><button onClick={()=>{setError('');void load();}} aria-label="Yangilash"><RefreshCw size={14}/></button></div>}
   {chat&&<div className="match-chat-quick" aria-label="Tezkor xabarlar">{chat.quickMessages.map(item=><button key={item} disabled={busy||!chat.canSend} onClick={()=>void send(item)}>{item}</button>)}</div>}
   <footer className="match-chat-compose">
    {replyTo&&<div className="match-chat-replying"><Reply size={14}/><span><b>{replyTo.senderName}</b><small>{replyTo.text}</small></span><button onClick={()=>setReplyTo(null)} aria-label="Javobni bekor qilish"><X size={14}/></button></div>}
    {chat?.closed?<div className="match-chat-blocked"><Check size={16}/><span>Natija tasdiqlangan. Chat o‘qish holatida.</span></div>:chat?.blocked?<div className="match-chat-blocked"><Lock size={16}/><span>{chat.blockedByMe?'Siz chatni bloklagansiz.':'Chat vaqtincha bloklangan.'}</span>{chat.blockedByMe&&<button disabled={busy} onClick={()=>void toggleBlock()}>Blokni ochish</button>}</div>:<>
      <textarea ref={input} rows={1} maxLength={500} value={text} disabled={busy||!chat?.canSend} onChange={e=>{setText(e.target.value);e.currentTarget.style.height='auto';e.currentTarget.style.height=`${Math.min(e.currentTarget.scrollHeight,104)}px`;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Xabar yozing…" aria-label="Xabar"/>
      <button className="match-chat-send" disabled={busy||!text.trim()||!chat?.canSend} onClick={()=>void send()} aria-label="Xabarni yuborish">{busy?<LoaderCircle size={19} className="animate-spin"/>:<Send size={19}/>}</button>
    </>}
   </footer>
   {gameOpen&&target.kind==='fixture'&&chat&&<div className="match-chat-game-layer" role="dialog" aria-modal="true" aria-label="EFL Penalti">
    <div className="match-chat-game-top"><strong>EFL PENALTY</strong><span>Mashg‘ulot · rasmiy hisob o‘zgarmaydi</span><button type="button" onClick={()=>setGameOpen(false)} aria-label="O‘yindan chiqish"><X size={21}/></button></div>
    <iframe title="EFL Penalti — Munfiz" src="/games/efl-penalty.html" sandbox="allow-scripts allow-same-origin" onLoad={event=>{
      const clubs=chat.title.split(/\s+[—–]\s+/),home=clubs[0]?.trim(),away=clubs[1]?.trim();
      if(!home||!away)return;
      event.currentTarget.contentWindow?.postMessage({type:'EFL_PENALTY_CURRENT_FIXTURE',version:1,fixture:{id:chat.matchId,home,away,round:chat.subtitle},side:chat.viewerSide==='away'?'away':'home'},window.location.origin);
    }}/>
   </div>}
  </section>
 </div>;
}
