export const TEAM_PREVIEW_OWNER='5209126900';
export const canSeeTeamPreview=(telegramId?:string)=>telegramId===TEAM_PREVIEW_OWNER;
export interface TeamMember {id:string;name:string}
export interface PreviewTeam {id:string;ownerId:string;name:string;logo:string;members:TeamMember[];captainMemberId:string;version:number;updatedAt:string}
export interface TeamLineup {starters:string[];reserves:string[]}
export interface TeamBout {id:string;homeMemberId:string;awayMemberId:string;homeScore:number|null;awayScore:number|null}
export interface TeamFixture {id:string;round:number;homeTeamId:string;awayTeamId:string;homeLineup:TeamLineup|null;awayLineup:TeamLineup|null;bouts:TeamBout[]}
export interface TeamLeague {id:string;ownerId:string;name:string;teamIds:string[];starterCount:number;rounds:1|2;status:'DRAFT'|'ACTIVE'|'COMPLETED'|'CANCELLED';currentRound:number;totalRounds:number;fixtures:TeamFixture[];teams:Record<string,Pick<PreviewTeam,'id'|'name'|'members'|'captainMemberId'>>;version:number;updatedAt:string;audit:Array<{at:string;action:string;detail:string}>}
export interface TeamStanding {teamId:string;name:string;position:number;played:number;won:number;drawn:number;lost:number;winsFor:number;winsAgainst:number;points:number}
