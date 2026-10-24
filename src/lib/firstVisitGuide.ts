export const GUIDE_VERSION = 'v1';
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
// Prefer the real control even when it needs scrolling; a visible navigation fallback
// must not steal the score step from its actual button.
export function findGuideTarget(root: Pick<Document, 'querySelectorAll'>, selectors: string) {
  return selectors.split(',').flatMap(selector => Array.from(root.querySelectorAll<HTMLElement>(selector.trim())))
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
  if (mobile) {
    const safeBottom = height >= 560 ? 104 : 16;
    if (target) {
      const above = Math.max(1, target.top - 34);
      const belowTop = target.top + target.height + 18;
      const below = Math.max(1, height - safeBottom - belowTop);
      if (above >= cardHeight || above >= below) {
        const maxHeight = above;
        return { left: (width - cardWidth) / 2, top: Math.max(16, target.top - 18 - Math.min(cardHeight, maxHeight)), width: cardWidth, maxHeight };
      }
      return { left: (width - cardWidth) / 2, top: Math.max(16, Math.min(belowTop, height - 17)), width: cardWidth, maxHeight: below };
    }
    return { left: (width - cardWidth) / 2, top: Math.max(16, height - safeBottom - cardHeight), width: cardWidth, maxHeight: Math.max(1, height - safeBottom - 16) };
  }
  const maxTop = Math.max(16, height - cardHeight - 16);
  const left = target ? Math.min(Math.max(16, target.left + target.width / 2 - cardWidth / 2), Math.max(16, width - cardWidth - 16)) : (width - cardWidth) / 2;
  const below = target ? target.top + target.height + 18 : (height - cardHeight) / 2;
  const preferred = target && below + cardHeight > height - 16 ? target.top - cardHeight - 18 : below;
  return { left, top: Math.min(Math.max(16, preferred), maxTop), width: cardWidth, maxHeight: Math.max(1, height - 32) };
}
