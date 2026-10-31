import {createUzeflifeMatches} from './uzeflifeBracket';
import type {UMatch, UState} from '../types/uzeflife';

export const U_QUALIFIER_ROUNDS = ['1/16 final', '1/8 final', 'Chorak final', 'Yarim final', 'Setka finali'];
export const U_FINAL_ROUNDS = ['Chorak final', 'Yarim final', 'Final'];
export const uRoundLabel = (round:number,format?:UState['format']) => format==='LEAGUE'?`${round}-tur`:round <= 5 ? U_QUALIFIER_ROUNDS[round-1] : U_FINAL_ROUNDS[round-6];

// The fixed championship structure is visible before the draw, without enrolling
// fictitious players or writing placeholder fixtures to the database.
const emptyStructure = createUzeflifeMatches(Array.from({length:256},(_,i)=>`slot-${i}`))
  .map(match=>({...match,home:null,away:null}));
export function uDisplayMatches(s:Pick<UState,'matches'>):UMatch[] {
  return s.matches.length ? s.matches : emptyStructure;
}
export function uSourceLabel(m:UMatch,side:'home'|'away'):string {
  if(m.round===1) return 'Qur’adan so‘ng';
  const index=Number(m.id.split('m')[1]);
  const offset=side==='home'?0:1;
  if(m.round===6) return `${index*2+offset+1}-setka g‘olibi`;
  const local=m.bracket ? index%(32/2**m.round) : index;
  const source=local*2+offset+1;
  return m.round===7?`${source}-chorak final g‘olibi`:m.round===8?`${source}-yarim final g‘olibi`:`${source}-o‘yin g‘olibi`;
}
export function uMatchNumber(m:UMatch):number {
  const index=Number(m.id.split('m')[1]);
  return (m.bracket?index%(32/2**m.round):index)+1;
}
export function uCanSeeCustomNavigation(enabled:boolean):boolean {
  // Owner status does not override a deliberate temporary hide.
  return enabled===true;
}
