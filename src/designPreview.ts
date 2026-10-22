/// <reference types="vite/client" />
declare const __EFL_DESIGN_PREVIEW_BUILD__: boolean;

// URL parameters alone never grant preview access, including in ordinary dev.
export const isDesignPreviewBuild = typeof __EFL_DESIGN_PREVIEW_BUILD__ !== 'undefined' && __EFL_DESIGN_PREVIEW_BUILD__;
export const isDesignPreview = typeof window !== 'undefined'
  && window.location.hostname !== 'efluz.vercel.app'
  && isDesignPreviewBuild
  && new URLSearchParams(window.location.search).get('designPreview') === '1';
