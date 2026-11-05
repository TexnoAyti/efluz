export const ADMIN_TASK_GROUPS={EFL:'EFL ligalar va kuboklar',UZEFLIFE:'UZEFLIFE',TEAMS:'TEAMS va El-Clasico',TELEGRAM:'Telegram va kanal',SYSTEM:'Ma’lumotlar sifati'} as const;
export const ADMIN_TASK_PRIORITIES={URGENT:'Shoshilinch',HIGH:'Muhim',NORMAL:'Rejali'} as const;
export type AdminTaskGroup=keyof typeof ADMIN_TASK_GROUPS;
export type AdminTaskPriority=keyof typeof ADMIN_TASK_PRIORITIES;
export interface AdminTask {id:string;kind:string;group:AdminTaskGroup;priority:AdminTaskPriority;title:string;reason:string;nextStep:string;where:string;verified:boolean;dueAt?:string;url?:string;}
export interface AdminTaskPage {success:boolean;items:AdminTask[];total:number;allTotal:number;offset:number;nextOffset:number|null;generatedAt:string;complete:boolean;stale:boolean;unavailable:string[];summary:Record<AdminTaskPriority,number>;catalog:Array<{kind:string;group:AdminTaskGroup;name:string}>;}
