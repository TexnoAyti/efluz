import {readOnlyBotExtra} from './readOnlyBotExtraCommands.js';
// Read-only bot commands for the isolated staging bot.
// Do not register side-effecting commands before feature parity.
const commands=new Set(['/start','/help','/myclub','/myfixtures','/uzeflife','/teams','/inbox','/serverless-check']);
export function parseCommand(text){
  if(typeof text!=='string')return null;
  const token=text.trim().split(/\s+/)[0]?.toLowerCase();
  if(!token||!token.startsWith('/'))return null;
  // A mentioned command is meant for a specific bot, not an unspecified
  // recipient; group commands are ignored altogether.
  if(token.includes('@'))return null;
  return commands.has(token)?token:null;
}
export async function handleReadOnlyBotCommand(db,message){
  const text=message?.text;
  const command=parseCommand(text);
  if(!command)return null;
  const chat=message?.chat;
  const from=message?.from;
  if(!chat||!Number.isSafeInteger(chat.id))return null;
  // Never expose private club membership in group/channel or forwarded updates.
  if(chat.type!=='private')return null;
  if(!from||!Number.isSafeInteger(from.id)||from.id<=0||from.is_bot)return null;
  if(String(chat.id)!==String(from.id))return null;
  const chatId=chat.id;
  if(command==='/serverless-check')
    return {chat_id:chatId,text:'EFLUZ Serverless sinov kanali ishlayapti. Production bot hali eski tizimda.'};
  if(command==='/start'||command==='/help')
    return {chat_id:chatId,text:'EFLUZ Serverless sinov boti. Buyruqlar: /myclub — klubim, /myfixtures — uchrashuvlarim, /uzeflife — joriy tur, /teams — jamoalar, /inbox — xabarlarim, /serverless-check — aloqa. Klub tanlash va natija kiritish hozircha o‘chirilgan.'};
  const telegramId=String(from.id);
  const profile=await db.get('SELECT id,is_banned FROM efl_users WHERE telegram_id=:telegram',
    {':telegram':telegramId});
  if(!profile)return {chat_id:chatId,text:'Profil sinov bazasida topilmadi. Production hisobingiz o‘zgarmagan.'};
  if(profile.is_banned)return {chat_id:chatId,text:'Profil cheklangan. Administratorga murojaat qiling.'};
  if(command!=='/myclub'){
    const message=await readOnlyBotExtra(db,command,{id:profile.id,telegramId});
    return message===null?null:{chat_id:chatId,text:message};
  }
  const clubs=await db.all(`SELECT c.name AS clubName,l.name AS leagueName,s.name AS seasonName
    FROM efl_club_occupancies o
    JOIN efl_clubs c ON c.id=o.club_id
    JOIN efl_leagues l ON l.id=o.league_id AND l.season_id=o.season_id
    JOIN efl_seasons s ON s.id=o.season_id
    WHERE o.telegram_id=:telegram AND o.user_id=:user AND o.status='ACTIVE'
    ORDER BY s.created_at DESC,l.sort_order ASC LIMIT 20`,{
    ':telegram':telegramId,':user':profile.id
  });
  if(!clubs.length)return {chat_id:chatId,text:'Sinov bazasida faol klub topilmadi.'};
  const lines=clubs.map(c=>`${String(c.seasonName).slice(0,80)} — ${String(c.leagueName).slice(0,80)}: ${String(c.clubName).slice(0,80)}`);
  return {chat_id:chatId,text:'Sinov bazasidagi klublar:\n'+lines.join('\n')};
}
