import {createCanvas} from '@napi-rs/canvas';
import type {UState,UMatch} from '../../types/uzeflife';

/** Eight complete fixtures per readable PNG; no standings or fictitious games. */
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
  const group=matches.slice(offset,offset+8),canvas=createCanvas(1200,180+group.length*136),ctx=canvas.getContext('2d');
  ctx.fillStyle='#081322';ctx.fillRect(0,0,1200,canvas.height);
  ctx.fillStyle='#75aaff';ctx.fillRect(0,0,1200,9);
  ctx.fillStyle='#f4f8ff';ctx.font='bold 54px sans-serif';ctx.fillText('UZEFLIFE',54,80);
  ctx.fillStyle='#afc5e3';ctx.font='29px sans-serif';ctx.fillText(round+'-TUR  •  O‘YINLAR '+(offset+1)+'–'+(offset+group.length)+' / '+matches.length,54,132);
  group.forEach((m,i)=>{
   const y=164+i*136;ctx.fillStyle=i%2?'#182b44':'#13243c';ctx.fillRect(36,y,1128,119);
   ctx.fillStyle='#8eacd6';ctx.font='24px sans-serif';ctx.fillText('#'+(offset+i+1),52,y+42);
   const left=label(m.home),right=label(m.away);
   ctx.fillStyle='#fff';ctx.font='bold 30px sans-serif';
   const clipped=(s:string)=>s.length>24?s.slice(0,23)+'…':s;
   ctx.fillText(clipped(left),128,y+73);
   ctx.fillStyle='#75aaff';ctx.font='bold 27px sans-serif';ctx.fillText('VS',575,y+73);
   ctx.fillStyle='#fff';ctx.font='bold 30px sans-serif';ctx.fillText(clipped(right),690,y+73);
  });
  pages.push({buffer:canvas.toBuffer('image/png'),count:group.length,first:offset+1});
 }
 return pages;
}
