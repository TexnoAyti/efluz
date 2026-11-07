// Shadow-only adapter: keeps legacy /api traffic on Vercel by default.
// Opt in per operation only after comparing response contracts and auth behavior.
export type EflTransport = 'vercel' | 'telegram-serverless';
export type EflOperation = 'health' | 'bootstrap' | 'leagues' | 'clubProfile' | 'matchChat';

type TelegramServerless = {
  call: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
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
  clubProfile:'clubProfile', matchChat:'matchChat'
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
  const result=await serverless.call(operations[operation],input);
  if (result && typeof result==='object' && (result as any).ok===false) {
    throw new Error(String((result as any).error||'SERVERLESS_REQUEST_FAILED'));
  }
  return result as T;
}
