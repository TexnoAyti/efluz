/// <reference types="vite/client" />
declare const __EFL_DESIGN_PREVIEW_BUILD__: boolean;
export const isDesignPreviewBuild = typeof __EFL_DESIGN_PREVIEW_BUILD__ !== 'undefined' && __EFL_DESIGN_PREVIEW_BUILD__;
export const isDesignPreview = typeof window !== 'undefined'
  && isDesignPreviewBuild
  && new URLSearchParams(window.location.search).get('designPreview') === '1';
