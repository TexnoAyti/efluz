// Browser network boundary for the isolated Telegram Serverless candidate.
// The Telegram WebApp SDK itself POSTs to /api/<endpoint> on the hosting
// app<N>.tgcloud.ai origin. Blocking ALL /api calls breaks signed bootstrap.
// Permit only that exact same-origin internal SDK endpoint transport; never
// permit cross-origin legacy/Vercel API access or same-origin /api on preview hosts.
const cloudHost=/^app[1-9][0-9]*\.tgcloud\.ai$/i;
export function isAllowedServerlessSdkRequest(
  target:string,base:string,method='GET'
):boolean{
  let parsed:URL,origin:URL;
  try {
    origin=new URL(base);
    parsed=new URL(target,origin);
  } catch { return false; }
  return origin.protocol==='https:'&&cloudHost.test(origin.hostname)&&
    parsed.origin===origin.origin&&method.toUpperCase()==='POST'&&
    /^\/api\/[A-Za-z_][A-Za-z0-9_]*$/.test(parsed.pathname)&&
    parsed.search===''&&parsed.hash==='';
}
export function shouldRejectLegacyApiRequest(
  target:string,base:string,method='GET'
):boolean{
  let parsed:URL;
  try {parsed=new URL(target,base);} catch {return true;}
  if(parsed.pathname!=='/api'&&!parsed.pathname.startsWith('/api/'))return false;
  return !isAllowedServerlessSdkRequest(target,base,method);
}
