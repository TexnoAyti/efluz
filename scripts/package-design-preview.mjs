import { cp, mkdir, writeFile } from 'node:fs/promises';
// Upload this directory only: no server entrypoints, environment files or functions.
await mkdir('design-preview-static', { recursive: true });
await cp('dist', 'design-preview-static', { recursive: true });
await writeFile('design-preview-static/vercel.json', JSON.stringify({ version: 2, framework: null, rewrites: [{source: '/(.*)', destination: '/index.html'}], headers: [{source: '/(.*)', headers: [{key:'Content-Security-Policy',value:"connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'"},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}] }, null, 2));
