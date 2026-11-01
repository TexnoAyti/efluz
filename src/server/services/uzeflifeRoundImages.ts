import {createHash} from 'node:crypto';
import type {UState,UMatch} from '../../types/uzeflife';
import {uzeflifeImageModel} from '../../lib/uzeflifeImage';
import {renderTournamentImagePng} from './tournamentImageRenderer';

/** Use the EFL export painter and bundled fonts, including on fontless servers. */
export async function renderUzeflifeRoundPages(state:UState,round:number) {
 const matches=state.matches.filter(m=>m.round===round).sort((a,b)=>{
  const number=(m:UMatch)=>Number(m.id.split('m')[1])||0;
  return number(a)-number(b);
 });
 if(!matches.length)throw Error('NO_ROUND_MATCHES');
 const pages:Array<{buffer:Buffer;count:number;first:number}>=[],hashes=new Set<string>();
 for(let offset=0;offset<matches.length;offset+=8){
  const group=matches.slice(offset,offset+8),model=uzeflifeImageModel(state,group,'season-2026-27');
  model.round=`${round}-tur · O‘yinlar ${offset+1}–${offset+group.length} / ${matches.length}`;
  const buffer=Buffer.from(await renderTournamentImagePng(model));
  const hash=createHash('sha256').update(buffer).digest('hex');
  if(hashes.has(hash))throw Error('DUPLICATE_ROUND_IMAGES');
  hashes.add(hash);pages.push({buffer,count:group.length,first:offset+1});
 }
 return pages;
}
