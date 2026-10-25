export const TEAM_PREVIEW_OWNER='5209126900';
export const canSeeTeamPreview=(telegramId?:string)=>telegramId===TEAM_PREVIEW_OWNER;
export const TEAM_LEAGUE_MAX_TEAMS=64,TEAM_DIRECTORY_LIMIT=256;
export const TEAM_PLAYOFF_SIZES=[2,4,8,16,32,64];
export interface TeamMember {id:string;name:string;userId?:string;verified?:boolean}
export function confirmedTeamMembers(team:{members:TeamMember[]}){return team.members.filter(m=>m.verified===true&&!!m.userId);}
export interface PreviewTeam {id:string;ownerId:string;adminUserId?:string;memberUserIds?:string[];membershipRequired?:boolean;name:string;logo:string;members:TeamMember[];captainMemberId:string;version:number;updatedAt:string}
export interface TeamLineup {starters:string[];reserves:string[]}
export interface TeamBout {id:string;homeMemberId:string;awayMemberId:string;homeScore:number|null;awayScore:number|null}
export type TeamTournamentFormat='LEAGUE'|'PLAYOFF'|'LEAGUE_AND_PLAYOFF';
export interface TeamFixture {stage?:'LEAGUE'|'PLAYOFF';tieBreakWinnerId?:string|null;tieBreakReason?:string;id:string;round:number;homeTeamId:string;awayTeamId:string;homeLineup:TeamLineup|null;awayLineup:TeamLineup|null;bouts:TeamBout[]}
export interface TeamLeague {membershipRequired?:boolean;format?:TeamTournamentFormat;description?:string;qualifiers?:number;id:string;ownerId:string;name:string;teamIds:string[];starterCount:number;rounds:1|2;status:'DRAFT'|'ACTIVE'|'COMPLETED'|'CANCELLED';currentRound:number;totalRounds:number;fixtures:TeamFixture[];teams:Record<string,Pick<PreviewTeam,'id'|'name'|'members'|'captainMemberId'>>;version:number;updatedAt:string;audit:Array<{at:string;action:string;detail:string}>}
export interface TeamStanding {teamId:string;name:string;position:number;played:number;won:number;drawn:number;lost:number;winsFor:number;winsAgainst:number;points:number}

export interface TeamTicketAccount {userId:string;balance:number;totalGranted:number;totalSpent:number;totalRevoked:number;updatedAt:string}
export interface TeamInvitation {id:string;teamId:string;teamName:string;inviterId:string;inviterName:string;inviteeId:string;inviteeName:string;legacyMemberId?:string;status:'PENDING'|'ACCEPTED'|'REJECTED'|'CANCELLED'|'EXPIRED';createdAt:string;expiresAt:string;respondedAt?:string;noticePending?:boolean}
export interface TeamMembershipWorkspace {teams:PreviewTeam[];invitations:TeamInvitation[];tickets:TeamTicketAccount;isOwner:boolean;groupUrl:string;groupName:string;maxLeagueTeams:number}
