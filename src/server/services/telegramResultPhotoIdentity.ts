import { normalizeResultText, winnerUsername } from './telegramResultText';

type PhotoScore = {home:string;away:string;homeScore:number;awayScore:number;homeExtraTimeScore?:number|null;awayExtraTimeScore?:number|null;homePenaltyScore:number|null;awayPenaltyScore:number|null};
/** A declared winner can orient an anonymous screenshot's numeric score.
 * The caller must still verify both usernames, fixture, sender and approval.
 * Never use this to override a readable username or a partially matched side.
 */
export function orientAnonymousPhotoScore(caption:string,image:PhotoScore):string|null {
  const text=normalizeResultText(caption);
  const names=[...new Set([...text.matchAll(/@([A-Za-z0-9_]{5,32})(?![A-Za-z0-9_])/g)].map(m=>m[1].toLowerCase()))];
  if(names.length!==2 || /@/.test(image.home+image.away))return null;
  const label=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_]/g,'');
  if([image.home,image.away].some(side=>names.some(name=>label(side)===label(name))))return null;
  let winner:string|null;try{winner=winnerUsername(text);}catch{return null;}
  if(!winner||!names.includes(winner))return null;
  const home=image.homeExtraTimeScore??image.homeScore,away=image.awayExtraTimeScore??image.awayScore;
  const decisiveHome=image.homePenaltyScore??home,decisiveAway=image.awayPenaltyScore??away;
  if(decisiveHome===decisiveAway)return null;
  const reverse=(names[0]===winner)!==(decisiveHome>decisiveAway);
  return text+` ${reverse?away:home}:${reverse?home:away}`+(image.homePenaltyScore!==null?` penalti ${reverse?image.awayPenaltyScore:image.homePenaltyScore}:${reverse?image.homePenaltyScore:image.awayPenaltyScore}`:'');
}
