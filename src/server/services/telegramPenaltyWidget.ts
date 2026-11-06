/** Self-contained Telegram HTMLBubble. No external assets, no network, no game wagers. */
export const PENALTY_WIDGET_HTML = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#0b0e17;color:white;font:600 15px Arial;text-align:center}.w{padding:16px;background:linear-gradient(165deg,#0b0e17,#181c30);border:2px solid #d43140;border-radius:16px}h2{margin:2px 0 8px;letter-spacing:2px}h2 b{color:#ff4d60}.stat{display:flex;justify-content:space-around;margin:12px auto;color:#ccd1df}#pitch{position:relative;overflow:hidden;height:225px;border:2px solid #eee;border-radius:6px;background:repeating-linear-gradient(0deg,#1b633b 0 32px,#207144 32px 64px)}#goal{position:absolute;left:13%;top:12px;width:74%;height:115px;border:6px solid white;background:repeating-linear-gradient(0deg,transparent 0 18px,#ffffff33 19px 20px),repeating-linear-gradient(90deg,transparent 0 19px,#ffffff33 20px 21px)}#keeper{position:absolute;left:50%;top:80px;transform:translateX(-50%);font-size:49px;transition:left .28s}#ball{position:absolute;top:170px;left:50%;transform:translateX(-50%);font-size:39px;transition:top .35s,left .35s}.choices{display:flex;gap:8px;margin:12px 0}.choices button,#restart{flex:1;border:1px solid #f46a78;border-radius:9px;background:#252c3e;color:white;padding:12px 2px;font-size:14px;font-weight:700}button:disabled{opacity:.45}#message{min-height:32px;font-size:16px;color:#ffcc78}#restart{background:#b52136;width:100%;display:none}</style></head><body><section class="w"><h2>⚽ <b>EFL</b> PENALTY</h2><div class="stat"><span>Zarba: <b id="round">1/5</b></span><span>Gollar: <b id="score">0</b></span></div><div id="pitch"><div id="goal"></div><div id="keeper">🧤</div><div id="ball">⚽</div></div><div class="choices"><button data-dir="0">↖ Chap</button><button data-dir="1">↑ O‘rta</button><button data-dir="2">↗ O‘ng</button></div><div id="message">Yo‘nalishni tanlang!</div><button id="restart">🔄 Qayta o‘ynash</button></section><script>var round=0,score=0,busy=false,buttons=[...document.querySelectorAll('[data-dir]')],ball=document.getElementById('ball'),keeper=document.getElementById('keeper'),message=document.getElementById('message');function play(dir){if(busy||round>=5)return;busy=true;buttons.forEach(b=>b.disabled=true);var save=Math.floor(Math.random()*3),pos=['26%','50%','74%'];keeper.style.left=pos[save];ball.style.left=pos[dir];ball.style.top='75px';var goal=dir!==save;if(goal)score++;round++;setTimeout(function(){message.textContent=goal?'⚽ GOOOL!':'🧤 Darvozabon qaytardi!';document.getElementById('score').textContent=score;document.getElementById('round').textContent=Math.min(round+1,5)+'/5';if(round===5){message.textContent='Yakuniy natija: '+score+'/5 gol';document.getElementById('restart').style.display='block'}else{setTimeout(function(){ball.style.top='170px';ball.style.left='50%';keeper.style.left='50%';buttons.forEach(b=>b.disabled=false);busy=false;message.textContent='Keyingi zarbani teping!'},620)}},380)}buttons.forEach(b=>b.addEventListener('click',function(){play(Number(this.dataset.dir))}));document.getElementById('restart').addEventListener('click',function(){round=0;score=0;busy=false;ball.style.top='170px';ball.style.left='50%';keeper.style.left='50%';document.getElementById('round').textContent='1/5';document.getElementById('score').textContent='0';message.textContent='Yo‘nalishni tanlang!';buttons.forEach(b=>b.disabled=false);this.style.display='none'});</script></body></html>`;

export const PENALTY_MENU_LABEL = '⚽ Penalti o‘ynash';

/** Beta is opt-in. Stable API may reject sendWidget until rollout; never claim success then. */
export async function sendPenaltyWidget(chatId: number): Promise<{ok: boolean; error?: string}> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'BOT_TOKEN_MISSING' };
  const beta = process.env.TELEGRAM_WIDGET_API_MODE === 'beta';
  const base = beta ? 'https://api.telegram.org/beta/bot' : 'https://api.telegram.org/bot';
  const suffix = beta ? '/test/sendWidget' : '/sendWidget';
  try {
    const response = await fetch(base + token + suffix, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: chatId, html: PENALTY_WIDGET_HTML, width: 390, height: 390, allow_queries: false}),
      signal: AbortSignal.timeout(10000),
    });
    const result: any = await response.json();
    return result?.ok ? { ok: true } : { ok: false, error: String(result?.description || 'WIDGET_API_UNAVAILABLE').slice(0, 160) };
  } catch {
    return { ok: false, error: 'WIDGET_API_UNAVAILABLE' };
  }
}
