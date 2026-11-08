#!/usr/bin/env node
// Builds ACTUAL EFLUZ React UI separately from the Telegram staging smoke app.
// Never use tgcloud push with this output until auth, contracts and migration pass.
process.env.NODE_ENV='production';
process.env.EFL_SERVERLESS_UI_PREVIEW='1';
process.env.VITE_EFL_API_TRANSPORT='telegram-serverless';
delete process.env.EFL_TGCLOUD_STATIC;
delete process.env.EFL_ORIGINAL_UI_PREVIEW;
const {build}=await import('vite');
await build();
console.log('EFL_SERVERLESS_REAL_UI_BUILD_READY: dist-efl-serverless-ui; NOT DEPLOYED; auth and writes not migrated');
