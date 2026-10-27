import type {ClasicoBout} from '../types/elClasico';
export function eventContactUrl(telegramId:string,username?:string){
 return username&&/^[A-Za-z0-9_]{5,32}$/.test(username)?`https://t.me/${username}`:`tg://user?id=${telegramId}`;
}
export function applyEventResult(bout:Omit<ClasicoBout,'id'>,actorId:string,action:string,body:any){
 const fail=(message:string,statusCode=409):never=>{throw Object.assign(new Error(message),{statusCode});};
 if(![bout.homeUserId,bout.awayUserId].includes(actorId))fail('Bu sizning o‘yiningiz emas.',403);
 if(bout.homeScore!==null||bout.awayScore!==null)fail('Natija allaqachon tasdiqlangan.');
 if(action==='SUBMIT_RESULT'){
  if(bout.pendingResult)fail('Avval yuborilgan hisob tasdig‘i kutilmoqda.');
  if(![body.homeScore,body.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=99))fail('Hisob 0–99 oralig‘ida bo‘lsin.',400);
  bout.pendingResult={homeScore:body.homeScore,awayScore:body.awayScore,submittedBy:actorId};delete bout.disputed;
 }else{
  const pending=bout.pendingResult;if(!pending)fail('Tasdiqlash uchun hisob yo‘q.');
  if(pending.submittedBy===actorId)fail('Hisobni raqibingiz tasdiqlashi kerak.',403);
  if(action==='CONFIRM_RESULT'){bout.homeScore=pending.homeScore;bout.awayScore=pending.awayScore;delete bout.disputed;}
  else if(action==='DISPUTE_RESULT')bout.disputed=true;
  else fail('Amal noto‘g‘ri.',400);
  delete bout.pendingResult;
 }
}
