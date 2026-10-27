import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppLoading } from '../../components/AppLoading';
import { resolveTelegramContext } from '../../lib/telegramContext';
import { setTelegramInitData } from '../../lib/api';

const html = readFileSync('index.html','utf8');
const placeholder = html.split('<div id="root">')[1].split('\n    <script type="module"')[0].trim().replace(/<\/div>$/,'');
const rendered = renderToStaticMarkup(React.createElement(AppLoading,{mode:'screen'}));
assert.equal(placeholder.replace(/\s+\/>/g,'/>'),rendered.slice(rendered.indexOf('<div')).replace(/\s+\/>/g,'/>'),'Pre-JavaScript and authenticated-startup loading must have identical markup');
assert.match(html, /rel="stylesheet" href="\/app-loading.css"/);
const css=readFileSync('public/app-loading.css','utf8');
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(css, /efl-loading-logo-light/);
assert.doesNotMatch(placeholder, /eF<|animate-pulse|animate-spin|\d+%/);
for (const mode of ['section','overlay'] as const) {
 const output=renderToStaticMarkup(React.createElement(AppLoading,{mode}));
 assert.match(output,/efl-loading-track/);
 assert.match(output,/role="status"/);
 assert.doesNotMatch(output, /efl-loading-brand/);
}
const oldWindow=(globalThis as any).window;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
 const base:any={location:{pathname:'/',search:'',hash:''},history:{replaceState:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}};
 (globalThis as any).window=base;
 setTelegramInitData(null);
 const immediate=await Promise.race([
  resolveTelegramContext(0),
  new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Existing-session startup waited for the SDK')),500);}),
 ]).finally(()=>clearTimeout(timer));
 assert.equal(immediate.initData,'');
 assert.equal(immediate.tg,null);
 // An existing session never takes precedence over fresh, signed launch data.
 base.location.hash='#tgWebAppData='+encodeURIComponent('fresh-signed-launch');
 assert.equal((await resolveTelegramContext(0)).initData,'fresh-signed-launch');
 setTelegramInitData(null);base.location.hash='';
 let ready=0;
 const pending=resolveTelegramContext(1200);
 base.Telegram={WebApp:{initData:'late-signed-launch',ready:()=>ready++,expand:()=>{},platform:'android',version:'9.0'}};
 const late=await pending;
 assert.equal(late.initData,'late-signed-launch');
 assert.ok(ready>0);
 assert.equal(late.platform,'android');
} finally {clearTimeout(timer);setTelegramInitData(null);(globalThis as any).window=oldWindow;}
console.log('PASS identical HTML/React startup UI, shared section/overlay indicator, reduced-motion/light support, immediate session handshake, fresh launch precedence and late SDK recovery');
