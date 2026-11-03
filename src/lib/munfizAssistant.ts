export type AssistantPoint = {x:number;y:number};
export type AssistantRect = {left:number;top:number;right:number;bottom:number};
export const MUNFIZ_SIZE = {width:72,height:104};
export function parkMunfiz(width:number,height:number,avoid:AssistantRect[]=[],preferred?:AssistantPoint,insets={top:80,bottom:106,left:8,right:8}):AssistantPoint {
 const maxX=Math.max(0,width-insets.right-MUNFIZ_SIZE.width),minX=Math.min(insets.left,maxX);
 const maxY=Math.max(0,height-insets.bottom-MUNFIZ_SIZE.height),minY=Math.min(insets.top,maxY);
 const clamp=(p:AssistantPoint)=>({x:Math.max(minX,Math.min(maxX,p.x)),y:Math.max(minY,Math.min(maxY,p.y))});
 const candidates=[...(preferred?[clamp(preferred)]:[]),...[minY,(minY+maxY)/2,maxY,...avoid.flatMap(r=>[r.top-MUNFIZ_SIZE.height-16,r.bottom+16])].flatMap(y=>[clamp({x:minX,y}),clamp({x:maxX,y})])];
 const cost=(p:AssistantPoint)=>avoid.reduce((total,r)=>total+Math.max(0,Math.min(p.x+72,r.right+12)-Math.max(p.x,r.left-12))*Math.max(0,Math.min(p.y+104,r.bottom+12)-Math.max(p.y,r.top-12)),0);
 return candidates.reduce((best,p)=>cost(p)<cost(best)?p:best,candidates[0]);
}
export function assistantPage(base:string,category?:string|null) {
 if(base==='leagues'||base==='cups'||base==='champions-league'||base==='standings'||base==='season-hub')return category||'leagues';
 return base;
}
