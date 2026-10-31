import {createCanvas} from '@napi-rs/canvas';
import type {UState,UMatch} from '../../types/uzeflife';
import type {TournamentImageModel} from '../../lib/tournamentImage';
import {paintTournamentImage} from '../../lib/tournamentImage';

/** Each image uses the exact shared EFL tournament-export painter. */
export async function renderUzeflifeRoundPages(state:UState,round:number) {
 const matches=state.matches.filter(m=>m.round===round).sort((a,b)=>{
  const number=(m:UMatch)=>Number(m.id.split('m')[1])||0;
  return number(a)-number(b);
 });
 if(!matches.length)throw Error('NO_ROUND_MATCHES');
 const names=new Map(state.participants.map(p=>[p.id,p.name]));
 const label=(id:string|null)=>id?(names.get(id)||'@'+(state.roster?.find(r=>r.userId===id)?.username||id)):'—';
 const pages:Array<{buffer:Buffer;count:number;first:number}>=[];
 for(let offset=0;offset<matches.length;offset+=8){
  const group=matches.slice(offset,offset+8);
  const model:TournamentImageModel={
   kind:'matchday',identityKind:'players',title:'UZEFLIFE',seasonId:'season-2026-27',language:'uz',
   createdAt:new Date().toISOString(),round:round+'-TUR · '+(offset+1)+'–'+(offset+group.length)+' / '+matches.length,
   branding:{accent:'#78aaff',zones:[]},
   rows:group.map(m=>({id:m.home||m.id+'-home',name:label(m.home),awayId:m.away||m.id+'-away',awayName:label(m.away),score:m.homeScore!==null&&m.awayScore!==null?m.homeScore+' : '+m.awayScore:'VS',detail:'UZEFLIFE · '+(Number(m.id.split('m')[1])+1)+'-o‘yin',status:m.homeScore===null?'Rejada':''}))
  };
  const canvas=createCanvas(1080,1100);
  // Node canvas context implements the standard 2D drawing API used by EFL.
  paintTournamentImage(canvas.getContext('2d') as unknown as CanvasRenderingContext2D,model);
  pages.push({buffer:canvas.toBuffer('image/png'),count:group.length,first:offset+1});
 }
 return pages;
}
