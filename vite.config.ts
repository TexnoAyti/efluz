import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  const preview = mode === "design-preview" && process.env.EFL_DESIGN_PREVIEW === "1";
  if (preview && process.env.VERCEL_ENV === "production") throw new Error("Design preview cannot be built for production");
  return {
    plugins: [react(), tailwindcss(), ...(preview ? [{ name: "preview-isolation", transformIndexHtml(html: string) { return html.replace(/<script[^>]+(?:telegram-ready|telegram-web-app)[^>]*><\/script>/g, "").replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'"><meta name="robots" content="noindex,nofollow">`); } }] : [])],
    // A static design walkthrough is available only in local dev and Vercel Preview builds.
    define: { __EFL_DESIGN_PREVIEW_BUILD__: JSON.stringify(preview) },
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
