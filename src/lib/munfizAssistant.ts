export type AssistantPoint = {x:number;y:number};
export type AssistantRect = {left:number;top:number;right:number;bottom:number};
export const MUNFIZ_SIZE = {width:84,height:120};
export function parkMunfiz(width:number,height:number,avoid:AssistantRect[]=[],preferred?:AssistantPoint,insets={top:80,bottom:106,left:8,right:8}):AssistantPoint {
 const maxX=Math.max(0,width-insets.right-MUNFIZ_SIZE.width),minX=Math.min(insets.left,maxX);
 const maxY=Math.max(0,height-insets.bottom-MUNFIZ_SIZE.height),minY=Math.min(insets.top,maxY);
 const clamp=(p:AssistantPoint)=>({x:Math.max(minX,Math.min(maxX,p.x)),y:Math.max(minY,Math.min(maxY,p.y))});
 const candidates=[...(preferred?[clamp(preferred)]:[]),...[minY,(minY+maxY)/2,maxY,...avoid.flatMap(r=>[r.top-MUNFIZ_SIZE.height-16,r.bottom+16])].flatMap(y=>[clamp({x:minX,y}),clamp({x:maxX,y})])];
 const cost=(p:AssistantPoint)=>avoid.reduce((total,r)=>total+Math.max(0,Math.min(p.x+MUNFIZ_SIZE.width,r.right+12)-Math.max(p.x,r.left-12))*Math.max(0,Math.min(p.y+MUNFIZ_SIZE.height,r.bottom+12)-Math.max(p.y,r.top-12)),0);
 return candidates.reduce((best,p)=>cost(p)<cost(best)?p:best,candidates[0]);
}
export function assistantPage(base:string,category?:string|null) {
 if(base==='leagues'||base==='cups'||base==='champions-league'||base==='standings'||base==='season-hub')return category||({cups:'cups','champions-league':'european',standings:'standings','season-hub':'season'}[base]||'leagues');
 return base;
}

export type MunfizControl={id:string;target:string;title:string;description:string;disabled?:boolean;selected?:boolean};
/** Local task tours must never append the global menu or repeat a target under different selectors. */
export function selectMunfizControls(controls:MunfizControl[],mode:'page'|'sections'){
 const seen=new Set<string>();
 const hasLocalSections=controls.some(item=>item.id.startsWith('section-')&&!item.disabled);
 return controls.filter(item=>{
  if(mode==='sections'&&hasLocalSections&&item.id.startsWith('category-'))return false;
  const navigation=item.id.startsWith('category-')||item.id.startsWith('section-');
  if(item.disabled||!item.description||item.id.startsWith('nav-')||item.id.startsWith('btn-')||navigation!==(mode==='sections'))return false;
  if(mode==='sections'&&item.selected)return false;
  if(seen.has(item.target)||seen.has(item.id.toLowerCase()))return false;
  seen.add(item.target);seen.add(item.id.toLowerCase());return true;
 }).slice(0,mode==='sections'?6:5);
}
