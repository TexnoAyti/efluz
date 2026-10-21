import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = `import {previewFetch} from './src/preview/transport'; import {isDesignPreview} from './src/designPreview'; export {previewFetch,isDesignPreview};`;
for (const [enabled, query, active] of [[true,'?designPreview=1',true],[false,'?designPreview=1',false],[true,'',false]]) {
  const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',define:{__EFL_DESIGN_PREVIEW_BUILD__:String(enabled)}});
  const context={module:{exports:{}},exports:{},window:{location:{origin:'https://preview.example',search:query}},URL,URLSearchParams,Request,Response};
  vm.runInNewContext(result.outputFiles[0].text,context);
  assert.equal(context.module.exports.isDesignPreview,active);
  const fetch=context.module.exports.previewFetch;
  for (const [url,init] of [['/api/admin/access',{}],['/api/me',{method:'POST'}],['https://efluz.vercel.app/api/me',{}],['/api/payments',{}]]) assert.equal((await fetch(url,init)).status,403);
  if(active){for(const url of ['/api/leagues','/api/competitions','/api/competitions/demo-league-premier-league/standings','/api/clubs/club-arsenal/fixtures']) assert.equal((await fetch(url)).status,200);assert.equal((await fetch('/api/unknown')).status,404);const me=await (await fetch('/api/me')).json();assert.equal(me.user.isAdmin,false);assert.equal(me.user.telegramId,'');}
  else assert.equal((await fetch('/api/me')).status,403);
}
const html=readFileSync('dist/index.html','utf8');assert.ok(html.includes("connect-src 'none'"));assert.ok(!html.includes('telegram-web-app.js'));assert.ok(!html.includes('/telegram-ready.js'));
console.log('PASS: explicit build/query gates, synthetic non-admin identity, read routes, denied writes/admin/external/unknown APIs, CSP and Telegram script removal');
