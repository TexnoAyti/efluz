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
export function guidePlacement(target: GuideRect | null, width: number, height: number, cardHeight: number) {
  const cardWidth = Math.min(360, Math.max(0, width - 32));
  const maxTop = Math.max(16, height - cardHeight - 16);
  const left = target ? Math.min(Math.max(16, target.left + target.width / 2 - cardWidth / 2), Math.max(16, width - cardWidth - 16)) : (width - cardWidth) / 2;
  const below = target ? target.top + target.height + 18 : (height - cardHeight) / 2;
  const preferred = target && below + cardHeight > height - 16 ? target.top - cardHeight - 18 : below;
  return { left, top: Math.min(Math.max(16, preferred), maxTop), width: cardWidth, maxHeight: Math.max(1, height - 32) };
}
