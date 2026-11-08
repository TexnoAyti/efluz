// ORIGINAL EFLUZ UI MIGRATION PREVIEW — never production or staging cutover.
// Network side effects are blocked before dynamically importing the real React app.
// The production Telegram bot, auth APIs and Vercel backend must not be contacted.
const blocked = () => Promise.reject(new Error('EFL_ORIGINAL_PREVIEW_NETWORK_DISABLED'));
window.fetch = blocked as typeof window.fetch;
const XHR = window.XMLHttpRequest;
if (XHR) {
  const open = XHR.prototype.open;
  XHR.prototype.open = function (..._args: any[]) {
    throw new Error('EFL_ORIGINAL_PREVIEW_XHR_DISABLED');
  } as typeof open;
}
if (typeof window.WebSocket !== 'undefined') {
  window.WebSocket = class {
    constructor() { throw new Error('EFL_ORIGINAL_PREVIEW_SOCKET_DISABLED'); }
  } as unknown as typeof WebSocket;
}
if (typeof window.EventSource !== 'undefined') {
  window.EventSource = class {
    constructor() { throw new Error('EFL_ORIGINAL_PREVIEW_EVENTS_DISABLED'); }
  } as unknown as typeof EventSource;
}
try { navigator.sendBeacon = (() => false) as typeof navigator.sendBeacon; } catch {}
const label = document.createElement('div');
label.textContent = 'EFLUZ — ORIGINAL UI PREVIEW · BACKEND O‘CHIRILGAN · STAGING DEPLOY EMAS';
Object.assign(label.style, {
  position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
  padding: '7px 10px', background: '#7c2d12', color: '#fff',
  textAlign: 'center', font: 'bold 11px system-ui'
});
document.body.append(label);
void import('./main.tsx');
