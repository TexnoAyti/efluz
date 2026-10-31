import {isULeague,uMatchFinished} from './uzeflifeLeague';
import type {UPermission,UState,UMatch} from '../types/uzeflife';
import type {TournamentImageModel} from './tournamentImage';
import {uRoundLabel,uSourceLabel,uMatchNumber} from './uzeflifePresentation';

export function canExportUzeflifeImage(permissions:readonly UPermission[]){return permissions.includes('matches')||permissions.includes('results');}
export function uzeflifeImageModel(state:UState,matches:UMatch[],seasonId:string):TournamentImageModel{
 if(!matches.length||matches.length>8||matches.some(m=>!state.matches.some(actual=>actual.id===m.id)))throw new Error('Rasm uchun ushbu sahifada haqiqiy o‘yinlar bo‘lishi kerak.');
 const first=matches[0];
 const brackets=[...new Set(matches.map(m=>m.bracket))];
 const group=isULeague(state)?'Umumiy liga':brackets.length===1?(first.bracket?`${first.bracket}-setka`:'Final bosqichi'):'Barcha setkalar';
 const player=(m:UMatch,side:'home'|'away')=>state.participants.find(p=>p.id===m[side])?.name||uSourceLabel(m,side);
 return {kind:'matchday',identityKind:'players',title:'UZEFLIFE',seasonId,language:'uz',createdAt:new Date().toISOString(),round:`${group} · ${uRoundLabel(first.round,state.format)} · ${matches.length} ta o‘yin`,branding:{accent:'#78aaff',zones:[]},rows:matches.map(m=>({id:m.home||m.id+'-home',name:player(m,'home'),awayId:m.away||m.id+'-away',awayName:player(m,'away'),detail:`${isULeague(state)?'Umumiy liga':m.bracket?`${m.bracket}-setka`:'Final bosqichi'} · ${uMatchNumber(m)}-o‘yin`,score:uMatchFinished(m)?`${m.homeScore} : ${m.awayScore}`:'VS',winner:m.winner?(m.winner===m.home?'home':'away'):undefined,status:uMatchFinished(m)?(m.penaltyHome!==null?`Pen: ${m.penaltyHome} : ${m.penaltyAway}`:''):m.proposal?'Tekshiruvda':m.scheduledAt?new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Rejada'}))};
}
