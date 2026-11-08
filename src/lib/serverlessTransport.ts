// Shadow-only adapter: keeps legacy /api traffic on Vercel by default.
// Opt in per operation only after comparing response contracts and auth behavior.
export type EflTransport = 'vercel' | 'telegram-serverless';
export type EflOperation = 'health' | 'bootstrap' | 'leagues' | 'clubProfile' | 'matchChat' | 'fixtures' | 'competitions' | 'standings' | 'notifications' | 'markNotificationRead' | 'myFixtures' | 'adminOverview' | 'competitionDetail' | 'uzeflife' | 'teamsCatalog';

type TelegramServerless = {
  call: (name: string, input: Record<string, unknown>, callback: (error: {message?:string;type?:string;parameters?:{code?:string}} | null, result?:unknown) => void) => void;
};
type CallOptions = {
  operation: EflOperation;
  input?: Record<string, unknown>;
  vercel: () => Promise<unknown>;
  preferred?: EflTransport;
};
// Avoid broad unsafe routing: mutations must never silently fail over to a second
// provider, and no ordinary /api request is intercepted by this module.
const operations: Record<EflOperation,string> = {
  health:'health', bootstrap:'bootstrap', leagues:'leagues',
  clubProfile:'clubProfile', matchChat:'matchChat', fixtures:'fixtures',
  competitions:'competitions', standings:'standings', notifications:'notifications',
  myFixtures:'myFixtures', markNotificationRead:'markNotificationRead',
  adminOverview:'adminOverview', competitionDetail:'competitionDetail', uzeflife:'uzeflife', teamsCatalog:'teamsCatalog'
};
export function telegramServerlessAvailable(): boolean {
  if (typeof window==='undefined') return false;
  const webApp=(window as any).Telegram?.WebApp;
  return typeof webApp?.Serverless?.call === 'function';
}
export function configuredEflTransport(): EflTransport {
  // This is a build-time opt in, never controlled through query strings.
  return import.meta.env.VITE_EFL_API_TRANSPORT === 'telegram-serverless'
    ? 'telegram-serverless' : 'vercel';
}
export async function callEflTransport<T>({operation,input={},vercel,preferred}:CallOptions):Promise<T> {
  const selected=preferred ?? configuredEflTransport();
  if (selected==='vercel') return await vercel() as T;
  if (typeof window==='undefined') throw new Error('TELEGRAM_SERVERLESS_UNAVAILABLE');
  const serverless=(window as any).Telegram?.WebApp?.Serverless as TelegramServerless|undefined;
  if (typeof serverless?.call!=='function') throw new Error('TELEGRAM_SERVERLESS_UNAVAILABLE');
  // No credential forwarding: Telegram SDK authenticates the call itself.
  // Never fall back to Vercel after a failed Serverless write.
  const result=await new Promise<unknown>((resolve,reject)=>{
    let completed=false;
    const timer=window.setTimeout(()=>{
      if (!completed) {completed=true;reject(new Error('TELEGRAM_SERVERLESS_TIMEOUT'));}
    },12000);
    try {
      serverless.call(operations[operation],input,(error,value)=>{
        if (completed) return;
        completed=true;window.clearTimeout(timer);
        if (error) {
          const failure=new Error(error.message||'TELEGRAM_SERVERLESS_ERROR');
          (failure as Error & {code?:string}).code=error.parameters?.code||error.type;
          reject(failure);
        } else resolve(value);
      });
    } catch (error) {
      if (!completed) {completed=true;window.clearTimeout(timer);reject(error);}
    }
  });
  if (result && typeof result==='object' && (result as any).ok===false) {
    throw new Error(String((result as any).error||'SERVERLESS_REQUEST_FAILED'));
  }
  return result as T;
}
