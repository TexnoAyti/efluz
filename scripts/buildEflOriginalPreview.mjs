#!/usr/bin/env node
// Builds the user's original React EFLUZ UI as an isolated, non-deployed preview.
// This output is NOT the Telegram Serverless app; do not change tgcloud.jsonc.
process.env.NODE_ENV='production';
process.env.EFL_ORIGINAL_UI_PREVIEW='1';
delete process.env.EFL_TGCLOUD_STATIC;
const {build}=await import('vite');
await build();
console.log('ORIGINAL_EFL_UI_PREVIEW_READY: dist-efl-original-preview (not deployed, backend disabled)');
