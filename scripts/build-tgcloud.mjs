// Build ONLY the browser Mini App into dist-tgcloud.
// Unlike npm run build, this never bundles Node/Vercel server entry points.
process.env.NODE_ENV='production';
process.env.EFL_TGCLOUD_STATIC='1';
process.env.VITE_EFL_API_TRANSPORT||='telegram-serverless';
const {build}=await import('vite');
await build();
