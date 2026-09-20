/** Resolve complete credential pairs, including Vercel Marketplace custom prefixes. */
export function resolveRedisConfig(env: Record<string, string | undefined>) {
  const pairs = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ];
  const valid = ([urlName, tokenName]: string[]) => {
    const url = env[urlName]?.trim();
    const token = env[tokenName]?.trim();
    if (!url || !token || /your-upstash|example/.test(url)) return null;
    try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
    return { url, token, urlName, tokenName };
  };
  for (const pair of pairs) {
    const config = valid(pair);
    if (config) return config;
  }
  const custom = Object.keys(env).filter(name => /_(?:UPSTASH_REDIS_REST_URL|KV_REST_API_URL)$/.test(name))
    .map(name => valid([name, name.replace(/URL$/, 'TOKEN')])).filter(value => value !== null);
  // Never guess which database to use when multiple integrations are configured.
  return custom.length === 1 ? custom[0] : null;
}
