// CI's server regressions use NODE_ENV=test. The shipped browser must always
// receive React's production runtime; keep this override inside this process.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
