/// <reference types="vite/client" />
declare const __EFL_DESIGN_PREVIEW_BUILD__: boolean;

export const isDesignPreview = typeof window !== 'undefined'
  && (import.meta.env.DEV || __EFL_DESIGN_PREVIEW_BUILD__)
  && new URLSearchParams(window.location.search).get('designPreview') === '1';
