import React, { useRef, useState, useEffect, useCallback } from 'react';
import { TabType } from './Navigation';

export interface NavTabItem {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  badge?: number;
}

interface ElasticNavIndicatorProps {
  items: NavTabItem[];
  activeTabId: TabType;
  onTabChange: (tab: TabType) => void;
}

export const ElasticNavIndicator: React.FC<ElasticNavIndicatorProps> = ({
  items,
  activeTabId,
  onTabChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const iconRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Find active index
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.isActive)
  );

  // Position state (managed via refs for 60fps RAF spring loop)
  const animState = useRef({
    currentX: 0,
    targetX: 0,
    currentScaleX: 1,
    currentScaleY: 1,
    targetScaleX: 1,
    targetScaleY: 1,
    velocityX: 0,
    velocityScaleX: 0,
    velocityScaleY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartIndicatorX: 0,
    lastPointerX: 0,
    lastPointerTime: 0,
    dragVelocity: 0,
    hasMovedFar: false,
    rafId: 0,
    indicatorWidth: 70,
  });

  const [nearestIndex, setNearestIndex] = useState(activeIndex);
  const lastHapticIndex = useRef(activeIndex);

  // Helper to trigger optional Telegram haptic pulse safely
  const triggerHaptic = useCallback(() => {
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      if (tg?.HapticFeedback?.impactOccurred) {
        tg.HapticFeedback.impactOccurred('light');
      }
    } catch {}
  }, []);

  // Compute centers of all 3 tabs relative to track
  const getTabCenters = useCallback(() => {
    if (!trackRef.current) return [45, 135, 225];
    const trackRect = trackRef.current.getBoundingClientRect();
    return btnRefs.current.map((btn) => {
      if (!btn) return 0;
      const r = btn.getBoundingClientRect();
      return r.left + r.width / 2 - trackRect.left;
    });
  }, []);

  // Update DOM transform directly without React re-render
  const applyTransform = useCallback((x: number, scaleX: number, scaleY: number, origin = 'center center') => {
    if (!indicatorRef.current) return;
    const halfWidth = animState.current.indicatorWidth / 2;
    indicatorRef.current.style.transformOrigin = origin;
    indicatorRef.current.style.transform = `translate3d(${x - halfWidth}px, 0, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
  }, []);

  // Physical Spring Animation Step
  const runSpring = useCallback((targetX: number, targetScaleX = 1, targetScaleY = 1, initialVelocity = 0) => {
    const s = animState.current;
    cancelAnimationFrame(s.rafId);

    s.targetX = targetX;
    s.targetScaleX = targetScaleX;
    s.targetScaleY = targetScaleY;
    if (initialVelocity !== 0) {
      s.velocityX = initialVelocity;
    }

    const stiffness = 380; // High responsiveness
    const damping = 28; // Light overshoot and rapid settle
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.032);
      lastTime = currentTime;

      // Spring on X position
      const forceX = -stiffness * (s.currentX - s.targetX) - damping * s.velocityX;
      s.velocityX += forceX * dt;
      s.currentX += s.velocityX * dt;

      // Spring on ScaleX
      const forceScaleX = -320 * (s.currentScaleX - s.targetScaleX) - 26 * s.velocityScaleX;
      s.velocityScaleX += forceScaleX * dt;
      s.currentScaleX += s.velocityScaleX * dt;

      // Spring on ScaleY
      const forceScaleY = -320 * (s.currentScaleY - s.targetScaleY) - 26 * s.velocityScaleY;
      s.velocityScaleY += forceScaleY * dt;
      s.currentScaleY += s.velocityScaleY * dt;

      applyTransform(s.currentX, s.currentScaleX, s.currentScaleY, 'center center');

      // Check if settled
      const settledX = Math.abs(s.currentX - s.targetX) < 0.25 && Math.abs(s.velocityX) < 1.5;
      const settledScale = Math.abs(s.currentScaleX - 1) < 0.005 && Math.abs(s.currentScaleY - 1) < 0.005;

      if (!settledX || !settledScale) {
        s.rafId = requestAnimationFrame(loop);
      } else {
        // Snap precisely to target at end
        s.currentX = s.targetX;
        s.currentScaleX = 1;
        s.currentScaleY = 1;
        s.velocityX = 0;
        s.velocityScaleX = 0;
        s.velocityScaleY = 0;
        applyTransform(s.currentX, 1, 1, 'center center');
      }
    };

    s.rafId = requestAnimationFrame(loop);
  }, [applyTransform]);

  // Recalculate layout & jump to active tab on mount / resize / activeIndex change
  const syncToActiveTab = useCallback((animate = true) => {
    if (!trackRef.current) return;
    const centers = getTabCenters();
    const targetCenter = centers[activeIndex] ?? centers[0];

    // Measure button width to size indicator nicely
    const activeBtn = btnRefs.current[activeIndex];
    if (activeBtn) {
      const btnWidth = activeBtn.getBoundingClientRect().width;
      animState.current.indicatorWidth = Math.max(54, Math.min(76, btnWidth - 4));
      if (indicatorRef.current) {
        indicatorRef.current.style.width = `${animState.current.indicatorWidth}px`;
      }
    }

    if (animate && animState.current.currentX !== 0) {
      runSpring(targetCenter, 1, 1);
    } else {
      animState.current.currentX = targetCenter;
      animState.current.targetX = targetCenter;
      animState.current.currentScaleX = 1;
      animState.current.currentScaleY = 1;
      animState.current.velocityX = 0;
      applyTransform(targetCenter, 1, 1);
    }
    setNearestIndex(activeIndex);
    lastHapticIndex.current = activeIndex;
  }, [activeIndex, getTabCenters, runSpring, applyTransform]);

  useEffect(() => {
    syncToActiveTab(true);
  }, [activeIndex, syncToActiveTab]);

  useEffect(() => {
    const handleResize = () => syncToActiveTab(false);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animState.current.rafId);
    };
  }, [syncToActiveTab]);

  // -------------------------------------------------------------
  // Pointer Event Handlers (Drag, Press, Stretch, Snap)
  // -------------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary pointer
    if (!e.isPrimary) return;

    const s = animState.current;
    cancelAnimationFrame(s.rafId);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    s.isDragging = true;
    s.hasMovedFar = false;
    s.dragStartX = e.clientX;
    s.dragStartIndicatorX = s.currentX;
    s.lastPointerX = e.clientX;
    s.lastPointerTime = performance.now();
    s.dragVelocity = 0;

    // Press feedback: compress slightly vertically, expand horizontally
    s.currentScaleY = 0.95;
    s.currentScaleX = 1.02;
    applyTransform(s.currentX, s.currentScaleX, s.currentScaleY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = animState.current;
    if (!s.isDragging) return;

    const deltaX = e.clientX - s.dragStartX;
    if (Math.abs(deltaX) > 4) {
      s.hasMovedFar = true;
    }

    // Velocity computation
    const now = performance.now();
    const dt = (now - s.lastPointerTime) / 1000;
    if (dt > 0.005) {
      s.dragVelocity = (e.clientX - s.lastPointerX) / dt;
      s.lastPointerX = e.clientX;
      s.lastPointerTime = now;
    }

    const centers = getTabCenters();
    const minCenter = centers[0];
    const maxCenter = centers[centers.length - 1];

    const rawX = s.dragStartIndicatorX + deltaX;
    let nextX = rawX;

    // Elastic edge resistance
    if (rawX < minCenter) {
      const overscroll = minCenter - rawX;
      nextX = minCenter - overscroll * 0.2;
    } else if (rawX > maxCenter) {
      const overscroll = rawX - maxCenter;
      nextX = maxCenter + overscroll * 0.2;
    } else {
      // Find nearest tab
      let closestDist = Infinity;
      let closestIdx = 0;
      centers.forEach((c, idx) => {
        const dist = Math.abs(rawX - c);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      // Magnetic pull when within 36px of a tab center
      if (closestDist < 36) {
        const pull = (1 - closestDist / 36) * 0.35;
        const targetC = centers[closestIdx];
        nextX = rawX * (1 - pull) + targetC * pull;
      }

      if (closestIdx !== lastHapticIndex.current) {
        lastHapticIndex.current = closestIdx;
        setNearestIndex(closestIdx);
        triggerHaptic();
      }
    }

    s.currentX = nextX;

    // Rubber Stretch calculation
    const speed = Math.min(Math.abs(s.dragVelocity) / 1000, 1);
    const stretch = 1 + speed * 0.15; // Max 1.15x
    const compressY = Math.max(0.92, 0.95 - speed * 0.03);

    // Directional mass shift
    const origin =
      s.dragVelocity > 15
        ? 'left center'
        : s.dragVelocity < -15
        ? 'right center'
        : 'center center';

    s.currentScaleX = stretch;
    s.currentScaleY = compressY;
    applyTransform(nextX, stretch, compressY, origin);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = animState.current;
    if (!s.isDragging) return;
    s.isDragging = false;

    try {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    } catch {}

    const centers = getTabCenters();

    if (!s.hasMovedFar) {
      // Quick tap without significant drag:
      // Determine which button was tapped by clientX
      const trackRect = trackRef.current?.getBoundingClientRect();
      const clickX = e.clientX - (trackRect?.left || 0);

      let clickedIdx = activeIndex;
      let bestDist = Infinity;
      centers.forEach((c, idx) => {
        const d = Math.abs(clickX - c);
        if (d < bestDist) {
          bestDist = d;
          clickedIdx = idx;
        }
      });

      const targetX = centers[clickedIdx];
      runSpring(targetX, 1, 1);
      setNearestIndex(clickedIdx);
      if (clickedIdx !== activeIndex) {
        triggerHaptic();
        onTabChange(items[clickedIdx].id);
      }
      return;
    }

    // Drag release with velocity projection
    const projectedX = s.currentX + Math.max(-80, Math.min(80, s.dragVelocity * 0.08));

    let chosenIdx = 0;
    let closestDist = Infinity;
    centers.forEach((c, idx) => {
      const dist = Math.abs(projectedX - c);
      if (dist < closestDist) {
        closestDist = dist;
        chosenIdx = idx;
      }
    });

    const targetX = centers[chosenIdx];
    // Spring release into target with residual momentum
    runSpring(targetX, 1, 1, s.dragVelocity * 0.4);
    setNearestIndex(chosenIdx);

    // ONLY change tab on release!
    if (chosenIdx !== activeIndex) {
      triggerHaptic();
      onTabChange(items[chosenIdx].id);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = animState.current;
    s.isDragging = false;
    const centers = getTabCenters();
    const targetX = centers[activeIndex];
    runSpring(targetX, 1, 1);
    setNearestIndex(activeIndex);
  };

  // Keyboard navigation support
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = Math.min(items.length - 1, index + 1);
      onTabChange(items[nextIdx].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = Math.max(0, index - 1);
      onTabChange(items[prevIdx].id);
    }
  };

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label="Navigation Tabs"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="efl-rubber-track relative w-full h-full flex items-center justify-around select-none touch-none px-1"
      style={{ touchAction: 'none' }}
    >
      {/* 1. Single Shared Movable Rubber Lens Indicator */}
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="efl-rubber-indicator pointer-events-none absolute top-1.5 bottom-1.5 rounded-2xl"
      />

      {/* 2. Interactive Navigation Buttons (sitting above the lens) */}
      {items.map((item, idx) => {
        const Icon = item.icon;
        const hasBadge = (item.badge || 0) > 0;
        const isSelected = item.isActive;
        const isNearestDuringDrag = animState.current.isDragging && nearestIndex === idx;

        return (
          <button
            key={item.id}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            id={`admin-tab-${item.id}`}
            role="tab"
            aria-selected={isSelected}
            aria-label={item.label}
            aria-current={isSelected ? 'page' : undefined}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onClick={(e) => {
              // If dragged significantly, pointerUp already handled it
              if (animState.current.hasMovedFar) {
                e.preventDefault();
                return;
              }
              if (idx !== activeIndex) {
                triggerHaptic();
                onTabChange(item.id);
              }
            }}
            className="relative z-10 flex-1 max-w-[84px] h-12 flex items-center justify-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--efl-primary)] transition-transform duration-150 active:scale-95 touch-manipulation"
          >
            <span
              ref={(el) => {
                iconRefs.current[idx] = el;
              }}
              className={`flex items-center justify-center transition-all duration-150 ${
                isSelected || isNearestDuringDrag
                  ? 'text-[var(--efl-primary)] scale-110'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)] scale-100'
              }`}
            >
              <Icon
                className={`w-6 h-6 transition-all duration-150 ${
                  isSelected || isNearestDuringDrag ? 'stroke-[2.3]' : 'stroke-[1.8]'
                }`}
              />
            </span>

            {/* Badge */}
            {hasBadge && (
              <span className="absolute top-2 right-3 min-w-[7px] h-[7px] bg-rose-500 rounded-full shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
            )}
          </button>
        );
      })}
    </div>
  );
};
