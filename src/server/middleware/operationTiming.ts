import type {RequestHandler} from 'express';

/** Low-volume diagnostics for the two critical write flows; no bodies, IDs,
 * tokens, query strings or extra database writes. Vercel captures these logs. */
export const operationTiming: RequestHandler = (req,res,next) => {
  const operation=req.method==='POST' && req.path==='/api/auth/telegram'?'telegram-login'
    :req.method==='POST' && /^\/api\/fixtures\/[^/]+\/(?:submit-result|result|confirm|confirm-result)$/.test(req.path)?'fixture-result':null;
  if(operation){const started=performance.now();res.once('finish',()=>{
    const durationMs=Math.round(performance.now()-started);
    const sample={operation,status:res.statusCode,durationMs};
    if(res.statusCode>=500)console.error('[PLAYER_OPERATION_FAILED]',JSON.stringify(sample));
    else if(durationMs>=2000)console.warn('[PLAYER_OPERATION_SLOW]',JSON.stringify(sample));
  });}
  next();
};
