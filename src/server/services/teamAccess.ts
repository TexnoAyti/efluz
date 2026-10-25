import {getFirestoreDb} from '../firebase/admin';
import {verifyTelegramGroupMembership} from './telegramBotService';
import {canSeeTeamPreview,type PreviewTeam,type TeamMember} from '../../types/teamLeaguePreview';
import type {User} from '../../types';
export const TEAM_COLLECTION='team_league_preview_teams',LEAGUE_COLLECTION='team_league_preview_leagues';
export const teamError=(message:string,statusCode=400,code='TEAM_REQUEST_INVALID')=>Object.assign(new Error(message),{statusCode,code});
export const teamId=(value:unknown)=>{if(typeof value!=='string'||!/^tp_[a-zA-Z0-9_-]{8,80}$/.test(value))throw teamError('Team identifikatori noto‘g‘ri.');return value;};
export const teamText=(value:unknown,max=60)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw teamError('Nom yoki matn noto‘g‘ri.');return value.trim();};
export async function readTeamActor(tx:any,id:string):Promise<User>{
 if(typeof id!=='string'||!id||id.includes('/'))throw teamError('Akkauntni tekshirib bo‘lmadi.',403);
 const value=(await tx.get(getFirestoreDb().collection('users').doc(id))).data() as User|undefined;
 if(!value||value.id&&value.id!==id||value.isSuspended||!/^\d{1,20}$/.test(String(value.telegramId)))throw teamError('Akkaunt faol emas yoki kirish huquqi bekor qilingan.',403,'TEAM_ACCOUNT_UNAVAILABLE');
 return {...value,id};
}
export async function teamActor(id:string){return readTeamActor({get:(ref:any)=>ref.get()},id);}
export function assertTeamManager(team:PreviewTeam|undefined,user:User):asserts team is PreviewTeam{
 if(!team)throw teamError('Team topilmadi.',404);
 if(!canSeeTeamPreview(user.telegramId)&&(team.adminUserId||team.ownerId)!==user.id)throw teamError('Bu teamni faqat uning administratori yoki loyiha egasi boshqaradi.',403);
}
export function teamGroupInfo(){const configured=(process.env.TELEGRAM_GROUP_USERNAME||'@efleagueuz').trim();const name=/^@?[A-Za-z0-9_]{5,32}$/.test(configured)?'@'+configured.replace(/^@/,''):'Belgilangan Telegram guruhi';return {groupName:name,groupUrl:name.startsWith('@')?'https://t.me/'+name.slice(1):'https://t.me/efleagueuz'};}
export async function requireTeamGroup(telegramId:string){
 const result=await verifyTelegramGroupMembership(telegramId,true);
 const confirmed=['creator','administrator','member','restricted'].includes(result.status||'')&&result.isMember;
 const realHost=process.env.NODE_ENV==='production'||process.env.VERCEL==='1'||!!process.env.K_SERVICE||!!process.env.AWS_LAMBDA_FUNCTION_NAME;
 const isolated=result.status==='dev_mock_allowed'&&!realHost&&(process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true'||process.env.ENABLE_DEV_AUTH==='true');
 if(confirmed||isolated)return;
 const info=teamGroupInfo(),unavailable=result.status?.startsWith('fail_open')||result.error||result.status==='dev_mock_allowed';
 throw Object.assign(teamError(unavailable?'Guruh a’zoligini hozir tekshirib bo‘lmadi. Qayta urinib ko‘ring.':`${info.groupName} guruhiga qo‘shiling va qayta tekshiring.`,unavailable?503:403,unavailable?'TEAM_GROUP_UNAVAILABLE':'TEAM_GROUP_REQUIRED'),info);
}
export async function verifyTeamPlayers(members:TeamMember[],required:boolean){
 if(required&&members.some(m=>!m.verified||!m.userId))throw teamError('O‘yinchi avval taklifni qabul qilishi kerak.',409,'TEAM_MEMBER_UNCONFIRMED');
 const unique=[...new Set(members.filter(m=>m.verified&&m.userId).map(m=>m.userId!))];
 for(let i=0;i<unique.length;i+=8)await Promise.all(unique.slice(i,i+8).map(async id=>{const user=await teamActor(id);await requireTeamGroup(user.telegramId);}));
}
export async function validateTeamLogo(value:unknown){
 if(value==='')return '';if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))throw teamError('Logo PNG rasm bo‘lishi kerak.');
 const bytes=Buffer.from(value.split(',')[1],'base64');
 if(bytes.length<24||bytes.length>60000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw teamError('Logo 512×512 va 60 KB dan oshmasin.');
 try{const {loadImage}=await import('@napi-rs/canvas');await loadImage(bytes);}catch{throw teamError('Logo rasmini o‘qib bo‘lmadi.');}return value;
}

// Read the roster itself so pre-index teams are covered too. Call inside the
// membership transaction; the per-account document serializes cross-team joins.
export async function assertSingleTeamMembership(tx:any,userId:string,teamId:string){
 const rows=await tx.get(getFirestoreDb().collection(TEAM_COLLECTION));
 const other=rows.docs.find((row:any)=>row.id!==teamId&&(row.data() as PreviewTeam).members.some(m=>m.verified&&m.userId===userId));
 if(other)throw teamError('Bu o‘yinchi boshqa team tarkibida. Avval hozirgi team tarkibidan chiqarilishi kerak.',409,'TEAM_MEMBER_ALREADY_ASSIGNED');
}
export async function prepareSingleTeamMembership(tx:any,userId:string,teamId:string){
 const ref=getFirestoreDb().collection('team_membership_claims').doc(userId);
 await tx.get(ref);
 await assertSingleTeamMembership(tx,userId,teamId);
 // This is a concurrency guard, not a cached source of membership truth.
 return ()=>tx.set(ref,{userId,teamId,updatedAt:new Date().toISOString()});
}

export async function assertExclusiveTeamRosters(tx:any,teams:PreviewTeam[]){
 const rows=await tx.get(getFirestoreDb().collection(TEAM_COLLECTION));
 const memberships=new Map<string,Set<string>>();
 for(const row of rows.docs)for(const member of (row.data() as PreviewTeam).members){
  if(!member.verified||!member.userId)continue;
  const ids=memberships.get(member.userId)||new Set<string>();ids.add(row.id);memberships.set(member.userId,ids);
 }
 for(const team of teams)for(const member of team.members){
  if(member.verified&&member.userId&&[...(memberships.get(member.userId)||[])].some(id=>id!==team.id))
   throw teamError('Bir o‘yinchi bir nechta team tarkibida. Turnirni boshlashdan oldin tarkiblarni to‘g‘rilang.',409,'TEAM_MEMBER_ALREADY_ASSIGNED');
 }
}
