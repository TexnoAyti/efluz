import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  const designPreview = mode === 'design-preview';
  if (designPreview && process.env.VERCEL_ENV === 'production') {
    throw new Error('Design preview cannot be built for Vercel production');
  }
  return {
    plugins: [react(), tailwindcss(), ...(designPreview ? [{
      name: 'isolated-design-preview',
      transformIndexHtml: { order: 'pre' as const, handler(html: string) {
        return html.replace(/<script[^>]+(?:telegram-ready|telegram-web-app)[^>]*><\/script>/g, '')
          .replace(/<link rel="preconnect" href="https:\/\/telegram.org" \/>/, '')
          .replace('/src/main.tsx', '/src/preview/entry.ts')
          .replace('<head>', `<head><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'">`);
      } },
    }] : [])],
    build: { outDir: designPreview ? 'dist-design-preview' : 'dist' },
    // Explicit mode only; ordinary Vercel previews retain production authentication.
    define: { __EFL_DESIGN_PREVIEW_BUILD__: JSON.stringify(designPreview) },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
