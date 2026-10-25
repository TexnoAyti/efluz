export type ClasicoSide='REAL'|'BARCA';
export const clasicoSides:Record<ClasicoSide,string>={REAL:'Real Madrid',BARCA:'Barcelona'};
export interface ClasicoPlayer {userId:string;name:string;side:ClasicoSide}
export interface ClasicoBout {id:number;homeUserId:string;awayUserId:string;homeScore:number|null;awayScore:number|null}
export interface ClasicoEvent {id:'el-clasico';status:'REGISTRATION'|'ACTIVE'|'COMPLETED'|'CANCELLED';players:ClasicoPlayer[];bouts:ClasicoBout[];version:number;updatedAt:string}
export interface ClasicoView {event:ClasicoEvent;canManage:boolean;groupUrl:string;groupName:string}
