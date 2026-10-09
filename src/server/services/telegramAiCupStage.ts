import type { Fixture } from '../../types';

export type AiCupStage = 'preliminary'|'round16'|'quarter'|'semi'|'final';
export function detectAiCupStage(text:string):AiCupStage|null {
  const q=text.toLowerCase().replace(/[‘’ʻʼ'`]/g,'').replace(/[-–—]/g,' ');
  if(/round\s*(?:of\s*)?16|last\s*16|1\s*\/\s*8|nimchorak\s*final/.test(q))return 'round16';
  if(/\bchorak\b|quarter\s*final|\bqf\b|четвертьфинал|1\s*\/\s*4/.test(q))return 'quarter';
  if(/\byarim\b|semi\s*final|semifinal|\bsf\b|полуфинал|1\s*\/\s*2/.test(q))return 'semi';
  if(/preliminary|saralash\s*bosqich|предварительн/.test(q))return 'preliminary';
  if(/\bfinal(?:s|da|dagi|ning|ni|ga)?\b|финал/.test(q))return 'final';
  return null;
}
export const AI_CUP_STAGE_LABELS:Record<AiCupStage,string>={preliminary:'Saralash bosqichi',round16:'Nimchorak final',quarter:'Chorak final',semi:'Yarim final',final:'Final'};
/** Identify stages from their stored names; round numbers differ between cup formats. */
export function fixtureMatchesAiCupStage(fixture:Fixture,stage:AiCupStage):boolean {
  return detectAiCupStage(fixture.roundName||'')===stage;
}
export function formatAiCupStageFixture(f:Fixture,name:(id:string|null,embedded?:Fixture['homeClub'])=>string):string {
  const pair=`${name(f.homeClubId,f.homeClub)} — ${name(f.awayClubId,f.awayClub)}`;
  if(f.status==='CONFIRMED' && Number.isInteger(f.homeScore)&&Number.isInteger(f.awayScore)&&f.homeScore!>=0&&f.awayScore!>=0)
    return `${pair}: ${f.homeScore}:${f.awayScore}, natija tasdiqlangan.`;
  if(f.status==='SCHEDULED')return `${pair}: rejalashtirilgan, hali yakunlanmagan.`;
  const status:Record<string,string>={POSTPONED:'keyinga qoldirilgan',DISPUTED:'natija bahsli',PENDING_CONFIRMATION:'natija tasdiqlanishi kutilmoqda',AWAITING_RESULT:'natija kutilmoqda',PLAYING:'o‘ynalmoqda',OVERDUE:'muddat o‘tgan',READY:'tayyor'};
  return `${pair}: ${status[f.status]||f.status}.`;
}
