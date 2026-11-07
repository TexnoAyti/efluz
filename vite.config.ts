import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Keep the Telegram-hosted static bundle separate from the Vercel/Node
    // output directory. Never upload dist/server.cjs or backend source maps.
    build: { manifest: true, ...(process.env.EFL_TGCLOUD_STATIC === '1' ? { outDir: 'dist-tgcloud' } : {}) },
    // A static design walkthrough is available only in local dev and Vercel Preview builds.
    define: { __EFL_DESIGN_PREVIEW_BUILD__: JSON.stringify(process.env.VERCEL_ENV === 'preview') },
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
