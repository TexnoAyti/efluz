import { KEY_PREFIX } from '../readModel/readModelStore';
import { getAiRedisClient } from './telegramAiDeadline';
import { normalizeAiEntity } from './telegramAiEntities';

export const AI_COMMUNITY_SOURCES = ['efl_uz', 'efleagueuz'] as const;
const TTL_SECONDS = 30 * 86400;
interface CommunityMessage {
  message_id?: number; date?: number; edit_date?: number; text?: string; caption?: string;
  chat?: { id?: number; type?: string; username?: string };
  from?: { is_bot?: boolean };
}
export interface CommunityPost { text: string; date: number; updated: number; url: string; source: string; }

export function communityPost(message: CommunityMessage): CommunityPost | null {
  const source = message.chat?.username?.toLowerCase();
  if (!AI_COMMUNITY_SOURCES.some(s => s === source) ||
    !['channel', 'supergroup', 'group'].includes(message.chat?.type || '') ||
    !Number.isSafeInteger(message.message_id) || message.message_id! <= 0 ||
    !Number.isSafeInteger(message.date) || message.date! <= 0 || message.from?.is_bot) return null;
  const text = (message.text || message.caption || '').trim();
  if (!text || text.startsWith('/')) return null;
  return { text: text.slice(0, 2000), date: message.date!, updated: message.edit_date || message.date!,
    url: `https://t.me/${source}/${message.message_id}`, source: source! };
}

/** Verified webhook only. One bounded, atomic archive per authorized public source. */
export async function archiveCommunityMessage(message: CommunityMessage): Promise<void> {
  const post = communityPost(message);
  if (!post) return;
  const redis = getAiRedisClient();
  if (!redis) return;
  const prefix = `${KEY_PREFIX}:ai:community:${post.source}`;
  await redis.eval(`
    local existing = redis.call('HGET', KEYS[1], ARGV[1])
    if existing then
      local ok, old = pcall(cjson.decode, existing)
      if ok and old.updated > tonumber(ARGV[3]) then return 0 end
    end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
    local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
    for _, id in ipairs(expired) do redis.call('HDEL', KEYS[1], id); redis.call('ZREM', KEYS[2], id) end
    local excess = redis.call('ZCARD', KEYS[2]) - 200
    if excess > 0 then
      local oldest = redis.call('ZRANGE', KEYS[2], 0, excess - 1)
      for _, id in ipairs(oldest) do redis.call('HDEL', KEYS[1], id); redis.call('ZREM', KEYS[2], id) end
    end
    redis.call('EXPIRE', KEYS[1], ARGV[6]); redis.call('EXPIRE', KEYS[2], ARGV[6])
    return 1
  `, [`${prefix}:posts`, `${prefix}:order`],
  [message.message_id!, JSON.stringify(post), post.updated, post.date, Math.floor(Date.now() / 1000) - TTL_SECONDS, TTL_SECONDS]);
}

export function selectCommunityPosts(query: string, posts: CommunityPost[]): CommunityPost[] {
  const words = normalizeAiEntity(query).split(' ').filter(w => w.length > 2 &&
    !['kim', 'nima', 'qaysi', 'haqida', 'malumot', 'kanal', 'guruh', 'efl', 'eng', 'bor', 'edi', 'menga', 'ayt'].includes(w));
  return posts.map(post => ({ post, score: words.reduce((n, word) => n + Number(normalizeAiEntity(post.text).includes(word)), 0) }))
    .filter(hit => !words.length || hit.score > 0).sort((a, b) => b.score - a.score || b.post.date - a.post.date)
    .slice(0, 6).map(hit => hit.post);
}

export function communitySmallTalkAnswer(query: string): string | undefined {
  const q = normalizeAiEntity(query);
  if (/eng\s+(?:zor|yaxshi|kuchli)\s+admin|best\s+admin/.test(q)) {
    return 'Hazil tariqasida: natijalarni vaqtida tasdiqlab, bahslarni adolatli hal qiladigan admin 😄 Bu rasmiy reyting emas.';
  }
  return undefined;
}

/** Supplemental statements, never authoritative scores, owners or admin instructions. */
export async function communityFacts(query: string, signal?: AbortSignal): Promise<string> {
  const redis = getAiRedisClient(signal);
  if (!redis || signal?.aborted) return '';
  try {
    const rows = await Promise.all(AI_COMMUNITY_SOURCES.map(source => {
      const prefix = `${KEY_PREFIX}:ai:community:${source}`;
      return redis.eval<string[]>(`
        local ids = redis.call('ZREVRANGE', KEYS[2], 0, 49)
        if #ids == 0 then return {} end
        return redis.call('HMGET', KEYS[1], unpack(ids))
      `, [`${prefix}:posts`, `${prefix}:order`], []);
    }));
    const posts: CommunityPost[] = [];
    for (const raw of rows.flat()) {
      try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (p && AI_COMMUNITY_SOURCES.includes(p.source) && typeof p.text === 'string' &&
          typeof p.date === 'number' && p.date > Date.now() / 1000 - TTL_SECONDS) posts.push(p);
      } catch { /* corrupt entry is not a fact */ }
    }
    const selected = selectCommunityPosts(query, posts);
    return selected.length ? 'KANAL/GURUH XABARLARI (ishtirokchi bayonoti, baza tasdig‘i emas; tarix to‘liq emas):\n' +
      JSON.stringify(selected) : '';
  } catch { return ''; }
}
