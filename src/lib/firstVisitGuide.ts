export const GUIDE_VERSION = 'v3-faq-tour';
export type GuideStatus = 'completed' | 'skipped';
type GuideStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function guideStorageKey(userId: string) { return `efluz-guide-${GUIDE_VERSION}:${userId}`; }
export function readGuideStatus(userId: string, storage?: GuideStorage): GuideStatus | null {
  try { const value = storage?.getItem(guideStorageKey(userId)); return value === 'completed' || value === 'skipped' ? value : null; }
  catch { return null; }
}
export function saveGuideStatus(userId: string, status: GuideStatus, storage?: GuideStorage) {
  try { storage?.setItem(guideStorageKey(userId), status); } catch { /* Session state still closes the guide when storage is unavailable. */ }
}

export type GuideRect = { top: number; left: number; width: number; height: number };
/** Visible coordinates, shared by spotlight bounds and card placement. */
export function guideViewport(width: number, height: number, visual?: {width:number; height:number; offsetLeft:number; offsetTop:number} | null, telegramHeight?: number) {
  const heights = [height, visual?.height, telegramHeight].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0, width: Math.min(width, visual?.width || width), height: Math.min(...heights) };
}

// Prefer the real control even when it needs scrolling; a visible navigation fallback
// must not steal the score step from its actual button.
export function findGuideTarget(root: Pick<Document, 'querySelectorAll'>, selectors: string) {
  return selectors.split(',').map(selector=>selector.trim()).filter(Boolean).flatMap(selector => Array.from(root.querySelectorAll<HTMLElement>(selector.trim())))
    .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
}
export function guidePlacement(target: GuideRect | null, width: number, height: number, cardHeight: number, insets?: { top:number; bottom:number; left:number; right:number }) {
  if (insets && Object.values(insets).some(value => value > 0)) {
    const left = Math.min(Math.max(0,insets.left),Math.max(0,width-1));
    const top = Math.min(Math.max(0,insets.top),Math.max(0,height-1));
    const availableWidth = Math.max(1,width-left-Math.max(0,insets.right));
    const availableHeight = Math.max(1,height-top-Math.max(0,insets.bottom));
    const shifted = target ? {...target,left:target.left-left,top:target.top-top} : null;
    const position = guidePlacement(shifted,availableWidth,availableHeight,cardHeight);
    return {...position,left:position.left+left,top:position.top+top};
  }
  const mobile = width < 680;
  const cardWidth = Math.min(mobile ? 400 : 380, Math.max(0, width - (mobile ? 24 : 32)));
  const centerLeft=mobile?(width-cardWidth)/2:target?Math.min(Math.max(16,target.left+target.width/2-cardWidth/2),Math.max(16,width-cardWidth-16)):(width-cardWidth)/2;
  if(!target){
    const safeBottom=mobile&&height>=560?104:16;
    const maxHeight=Math.max(1,height-safeBottom-16);
    return {left:centerLeft,top:mobile?Math.max(16,height-safeBottom-Math.min(cardHeight,maxHeight)):Math.max(16,(height-Math.min(cardHeight,maxHeight))/2),width:cardWidth,maxHeight};
  }
  const gap=18,above=Math.max(0,target.top-gap-16),belowTop=target.top+target.height+gap,below=Math.max(0,height-16-belowTop);
  // On a wide, short viewport a side card leaves both the target and the controls usable.
  const leftSpace=Math.max(0,target.left-gap-16),rightSpace=Math.max(0,width-16-target.left-target.width-gap);
  if(!mobile&&Math.max(above,below)<Math.min(cardHeight,220)&&Math.max(leftSpace,rightSpace)>=240){
    const onRight=rightSpace>=leftSpace,space=onRight?rightSpace:leftSpace,sideWidth=Math.min(cardWidth,space);
    const maxHeight=Math.max(1,height-32),shown=Math.min(cardHeight,maxHeight);
    return {left:onRight?target.left+target.width+gap:target.left-gap-sideWidth,top:Math.max(16,Math.min(height-shown-16,target.top+target.height/2-shown/2)),width:sideWidth,maxHeight};
  }
  if(below>=cardHeight||below>above){
    return {left:centerLeft,top:Math.max(16,belowTop),width:cardWidth,maxHeight:Math.max(1,below)};
  }
  const maxHeight=Math.max(1,above);
  return {left:centerLeft,top:Math.max(16,target.top-gap-Math.min(cardHeight,maxHeight)),width:cardWidth,maxHeight};
}

export type GuideStep = {title:string;description:string;target:string};
