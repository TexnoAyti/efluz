export const UZEFLIFE_PERMISSIONS = ['participants','registrations','matches','results','schedules','brackets','channels','announcements'] as const;
export type UPermission = typeof UZEFLIFE_PERMISSIONS[number];
export interface UParticipant {id:string; name:string; status:'pending'|'approved'|'removed';}
export interface UDispute {by:string;reason:string;at:string;evidenceId:string|null;status:'open'|'resolved';resolution?:string;resolvedBy?:string;resolvedAt?:string;}
export interface UHistory {id:string;completedAt:string;champion:string;runnerUp:string;championName:string;runnerUpName:string;matchCount:number;}
export interface UMatch {id:string; round:number; bracket:number; home:string|null; away:string|null; winner:string|null; homeScore:number|null; awayScore:number|null; penaltyHome:number|null; penaltyAway:number|null; proposal:{by:string;home:number;away:number;penaltyHome:number|null;penaltyAway:number|null}|null; scheduledAt:string|null;deadlineAt?:string|null;dispute?:UDispute|null;}
export interface UChannel {id:string; title:string; url:string;}
export interface UState {roundHours?:number;history?:UHistory[];name:string; description:string; status:'draft'|'registration'|'playing'|'paused'|'completed'; round:number; superAdmin:string|null; assistants:Record<string,UPermission[]>; channels:UChannel[]; subscriptionsEnabled:boolean; customNavigationEnabled:boolean; participants:UParticipant[]; matches:UMatch[]; announcements:{id:string;text:string;at:string}[]; revision:number;}
export const U_STATUS:Record<UState['status'],string>={draft:'Tayyorlanmoqda',registration:'Qabul ochiq',playing:'Davom etmoqda',paused:'To‘xtatilgan',completed:'Yakunlangan'};
export const U_PERMISSION_LABELS:Record<UPermission,string>={participants:'Ishtirokchilar',registrations:'Ro‘yxatdan o‘tish',matches:'O‘yinlar',results:'Natijalarni tasdiqlash',schedules:'Jadval',brackets:'Pley-off',channels:'Majburiy obuna',announcements:'E’lonlar'};
