export const BALLOT_POINTS=[15,12,10,8,7,5,4,3,2,1] as const;
export interface AwardPlayer {id:string;name:string;clubs:string[];played:number;wins:number;draws:number;goals:number;conceded:number;points:number;titles:number;}
export interface AwardBallot {userId:string;ranking:string[];at:string;}
export interface AwardElection {id:string;version:number;status:'draft'|'open'|'closed'|'published';minMatches:number;nominees:AwardPlayer[];jury:string[];ballots:Record<string,AwardBallot>;closesAt:string|null;openedAt:string|null;publishedAt:string|null;tieDecision?:{winner:string;reason:string};}
export interface AwardStanding {player:AwardPlayer;points:number;places:number[];}
export interface SeasonAwardsView {seasonId:string;now:string;canManage:boolean;canVote:boolean;hasClub:boolean;myRanking:string[];election:Omit<AwardElection,'jury'|'ballots'>;voterCount:number;ballotCount:number;results:AwardStanding[];winners:string[];goldenBoot:AwardPlayer[];weekly:{from:string;to:string;leaders:AwardPlayer[];previousLeaders:AwardPlayer[]};unattributed:number;}
