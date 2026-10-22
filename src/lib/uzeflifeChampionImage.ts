import type {UState} from '../types/uzeflife';

/** Uses the same EFL midnight/blue/gold palette as the live competition. */
export function paintUzeflifeChampion(ctx:CanvasRenderingContext2D,s:UState,seasonId:string){
 const final=s.matches.find(m=>m.round===8);
 if(s.status!=='completed'||!final?.winner)throw Error('Chempionlik rasmi turnir yakunlangach tayyorlanadi.');
 const champion=s.participants.find(p=>p.id===final.winner)?.name||'Chempion';
 const runner=s.participants.find(p=>p.id===(final.winner===final.home?final.away:final.home))?.name||'Finalchi';
 const w=1080,h=1350;ctx.canvas.width=w;ctx.canvas.height=h;
 const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#142b47');bg.addColorStop(1,'#07111f');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
 const text=(v:string,x:number,y:number,size:number,color:string,max=960)=>{ctx.font=`700 ${size}px Arial, sans-serif`;while(ctx.measureText(v).width>max&&size>18){size--;ctx.font=`700 ${size}px Arial, sans-serif`;}ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;if(ctx.measureText(v).width>max){while(v.length>1&&ctx.measureText(v+'…').width>max)v=v.slice(0,-1);v+='…';}ctx.fillText(v,x,y);};
 ctx.strokeStyle='#78aaff';ctx.lineWidth=4;ctx.strokeRect(28,28,w-56,h-56);
 ctx.fillStyle='#78aaff';ctx.fillRect(28,28,w-56,6);
 text('EFL UZ',540,92,32,'#f0f5fc');text('UZEFLIFE',540,190,74,'#ffffff');
 text(seasonId.replace('season-','').replace('-','/'),540,262,25,'#a8bdd3');
 // Vector cup: gold body, handles, stem and base.
 ctx.fillStyle='#e4bd69';ctx.strokeStyle='#e4bd69';ctx.lineWidth=12;
 ctx.beginPath();ctx.moveTo(420,358);ctx.lineTo(660,358);ctx.bezierCurveTo(657,535,620,569,540,587);ctx.bezierCurveTo(460,569,423,535,420,358);ctx.fill();
 for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(540+side*118,390);ctx.bezierCurveTo(540+side*228,370,540+side*228,510,540+side*77,520);ctx.stroke();}
 ctx.fillRect(526,570,28,78);ctx.beginPath();ctx.roundRect(458,644,164,20,8);ctx.fill();
 text('CHEMPION',540,756,54,'#e4bd69');text(champion,540,855,70,'#ffffff',940);
 text('256 ISHTIROKCHI · 255 O‘YIN',540,934,23,'#91b4e6');
 ctx.strokeStyle='#314864';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(100,1002);ctx.lineTo(980,1002);ctx.stroke();
 text('FINALCHI',540,1045,21,'#92a8c1');text(runner,540,1094,36,'#e3edf8');
 text(`FINAL · ${final.homeScore} : ${final.awayScore}${final.penaltyHome!==null?`  (pen. ${final.penaltyHome}:${final.penaltyAway})`:''}`,540,1162,27,'#e4bd69');
 text('t.me/efluzbot',540,1268,22,'#78aaff');
}
export async function uzeflifeChampionBlob(s:UState,seasonId:string){
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('Rasmni tayyorlab bo‘lmadi.');paintUzeflifeChampion(ctx,s,seasonId);
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Rasmni tayyorlab bo‘lmadi.')),'image/png'));
}
