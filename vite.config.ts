import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Until feature parity, Telegram must host ONLY the isolated read-only
  // smoke app. The legacy React UI still calls Vercel for key operations.
  const staging = process.env.EFL_TGCLOUD_STATIC === '1';
  const originalPreview = process.env.EFL_ORIGINAL_UI_PREVIEW === '1';
  const serverlessUiPreview = process.env.EFL_SERVERLESS_UI_PREVIEW === '1';
  if ([staging, originalPreview, serverlessUiPreview].filter(Boolean).length > 1)
    throw new Error('EFL_BUILD_MODES_ARE_MUTUALLY_EXCLUSIVE');
  return {
    ...(staging ? { root: path.resolve(__dirname, 'tgcloud-staging'), publicDir: false as const } : {}),
    plugins: staging ? [] : [react(), tailwindcss()],
    build: staging
      ? { outDir: path.resolve(__dirname, 'dist-tgcloud'), emptyOutDir: true, sourcemap: false }
      : originalPreview
        ? { outDir: path.resolve(__dirname, 'dist-efl-original-preview'), emptyOutDir: true, sourcemap: false, rollupOptions: { input: path.resolve(__dirname, 'efl-original-preview.html') } }
        : serverlessUiPreview
          ? { outDir: path.resolve(__dirname, 'dist-efl-serverless-ui'), emptyOutDir: true, sourcemap: false, rollupOptions: { input: path.resolve(__dirname, 'efl-serverless-preview.html') } }
          : { manifest: true },
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
