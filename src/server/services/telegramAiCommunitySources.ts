import { KEY_PREFIX } from '../readModel/readModelStore';
import { getAiRedisClient } from './telegramAiDeadline';
import { normalizeAiEntity } from './telegramAiEntities';
import { isPrimaryOwner } from './telegramAiConfigService';

export const AI_COMMUNITY_SOURCES = ['efl_uz', 'efleagueuz'] as const;
const TTL_SECONDS = 30 * 86400;
interface CommunityMessage {
  message_id?: number; date?: number; edit_date?: number; text?: string; caption?: string;
  chat?: { id?: number; type?: string; username?: string };
  from?: { id?: number; is_bot?: boolean };
  forward_origin?: { type?: string; date?: number; message_id?: number; chat?: { id?: number; type?: string; username?: string } };
  is_automatic_forward?: boolean;
}
export interface CommunityPost { text: string; date: number; updated: number; url: string; source: string; archivedAt?: number; }

export function communityPost(message: CommunityMessage): CommunityPost | null {
  const origin = message.forward_origin;
  if (origin?.type === 'channel' && (
    (message.chat?.type === 'private' && isPrimaryOwner(message.from?.id) && message.chat.id === message.from?.id) ||
    (message.is_automatic_forward && message.chat?.username?.toLowerCase() === 'efleagueuz')
  )) {
    return communityPost({ message_id: origin.message_id, date: origin.date, chat: origin.chat,
      text: message.text, caption: message.caption });
  }
  if (origin) return null;
  const source = message.chat?.username?.toLowerCase();
  if (!AI_COMMUNITY_SOURCES.some(s => s === source) ||
    !['channel', 'supergroup', 'group'].includes(message.chat?.type || '') ||
    !Number.isSafeInteger(message.message_id) || message.message_id! <= 0 ||
    !Number.isSafeInteger(message.date) || message.date! <= 0 || (message.from?.is_bot && message.chat?.type !== 'channel')) return null;
  const text = (message.text || message.caption || '').trim();
  if (!text || text.startsWith('/')) return null;
  return { text: text.slice(0, 2000), date: message.date!, updated: message.edit_date || message.date!,
    url: `https://t.me/${source}/${message.message_id}`, source: source! };
}

/** Verified webhook only. One bounded, atomic archive per authorized public source. */
export async function archiveCommunityMessage(message: CommunityMessage): Promise<CommunityPost | null> {
  const post = communityPost(message);
  if (!post) return null;
  const redis = getAiRedisClient();
  if (!redis) throw new Error('COMMUNITY_REDIS_UNAVAILABLE');
  post.archivedAt = Math.floor(Date.now() / 1000);
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
  [Number(post.url.split('/').at(-1)), JSON.stringify(post), post.updated, post.archivedAt, post.archivedAt - TTL_SECONDS, TTL_SECONDS]);
  console.info('[AI_COMMUNITY_ARCHIVED]', JSON.stringify({ source: post.source, messageId: Number(post.url.split('/').at(-1)) }));
  return post;
}

export function selectCommunityPosts(query: string, posts: CommunityPost[]): CommunityPost[] {
  const namedSources = AI_COMMUNITY_SOURCES.filter(source => query.toLowerCase().includes(source));
  const channelOnly = namedSources.length === 1 ? namedSources[0] : /kanal(?:da|dagi|dan|ning)?\b/i.test(query) ? 'efl_uz' : undefined;
  const postUrl = /https:\/\/t\.me\/(efl_uz|efleagueuz)\/(\d+)/i.exec(query);
  if (postUrl) return posts.filter(post => post.url.toLowerCase() === postUrl[0].toLowerCase()).slice(0, 1);
  const search = query.replace(/@?(?:efl_uz|efleagueuz)/gi, ' ');
  const words = normalizeAiEntity(search).split(' ').filter(w => w.length > 2 &&
    !/^(?:kanal|guruh|xabar|post|elon)(?:da|dagi|dan|ning|lar|larni|ni)?$/.test(w) &&
    !['kim', 'nima', 'nimalar', 'qaysi', 'haqida', 'malumot', 'efl', 'eng', 'bor', 'edi', 'menga', 'ayt', 'oxirgi', 'songgi', 'yozilgan', 'yozildi', 'yangilik', 'yangiliklar', 'oqi'].includes(w));
  const ranked = posts.filter(post => !channelOnly || post.source === channelOnly).map(post => ({ post, score: words.reduce((n, word) => n + Number(normalizeAiEntity(post.text).includes(word)), 0) }))
    .filter(hit => !words.length || hit.score > 0).sort((a, b) => b.score - a.score || b.post.date - a.post.date)
    .map(hit => hit.post);
  if (channelOnly) return ranked.slice(0, 6);
  const selected = AI_COMMUNITY_SOURCES.flatMap(source => ranked.filter(p => p.source === source).slice(0, 3));
  return [...selected, ...ranked.filter(p => !selected.includes(p))].slice(0, 6);
}

export async function communitySourceStats(): Promise<Array<{ source: string; count: number | null }>> {
  const redis = getAiRedisClient();
  return Promise.all(AI_COMMUNITY_SOURCES.map(async source => {
    if (!redis) return { source, count: null };
    try { return { source, count: Number(await redis.eval('return redis.call("HLEN", KEYS[1])', [`${KEY_PREFIX}:ai:community:${source}:posts`], [])) }; }
    catch { return { source, count: null }; }
  }));
}

export function communityFallback(query: string, facts: string): string | undefined {
  if (!/kanal(?:da|dagi|dan|ning)?\b|@?efl_uz\b/i.test(query)) return undefined;
  try {
    const posts = JSON.parse(facts.slice(facts.indexOf('\n') + 1)) as CommunityPost[];
    const post = posts.find(p => p.source === 'efl_uz' && /^https:\/\/t\.me\/efl_uz\/\d+$/.test(p.url));
    if (post) return `Kanalda yozilishicha (${new Date(post.date * 1000).toISOString().slice(0, 10)}):\n${post.text.slice(0, 650)}\nManba: ${post.url}\nBu kanal xabari; natijalar va klub egalari uchun baza tasdig‘i alohida tekshiriladi.`;
  } catch { /* Missing channel evidence is not proof that a post never existed. */ }
  return 'Shu mavzudagi kanal posti saqlangan xabarlar orasida topilmadi. Kanal tarixini to‘liq o‘qiganman deb ayta olmayman. Qaysi post yoki mavzuni nazarda tutyapsiz?';
}

export function communitySmallTalkAnswer(query: string, variation = 0): string | undefined {
  const q = normalizeAiEntity(query);
  if (/eng\s+(?:zor|yaxshi|kuchli)\s+admin|best\s+admin/.test(q)) {
    const answers = [
      'Eng zo‘ri? Natijani vaqtida tasdiqlab, bahsni adolatli hal qiladigani 😄 Rasmiy reyting emas, futbolcha fikrim.',
      'Natijalarni kutdirib qo‘ymaydigan admin — mening nomzodim shu 😄 Bu reyting emas.',
      'Bahsni VAR’dan ham tez va adolatli hal qilsa, o‘sha admin zo‘r 😄 Rasmiy reytingimiz yo‘q.',
    ];
    return answers[Math.abs(Math.trunc(Number.isFinite(variation) ? variation : 0)) % answers.length];
  }
  return undefined;
}

/** Supplemental statements, never authoritative scores, owners or admin instructions. */
export async function communityFacts(query: string, signal?: AbortSignal): Promise<string> {
  const redis = getAiRedisClient(signal);
  if (!redis || signal?.aborted) return '';
  try {
    const rows = await Promise.allSettled(AI_COMMUNITY_SOURCES.map(source => {
      const prefix = `${KEY_PREFIX}:ai:community:${source}`;
      return redis.eval<string[]>(`
        local ids = redis.call('ZREVRANGE', KEYS[2], 0, 199)
        if #ids == 0 then return {} end
        return redis.call('HMGET', KEYS[1], unpack(ids))
      `, [`${prefix}:posts`, `${prefix}:order`], []);
    }));
    const posts: CommunityPost[] = [];
    for (const raw of rows.flatMap(row => row.status === 'fulfilled' ? row.value : [])) {
      try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (p && AI_COMMUNITY_SOURCES.includes(p.source) && typeof p.text === 'string' &&
          typeof p.date === 'number' && (p.archivedAt || p.date) > Date.now() / 1000 - TTL_SECONDS) posts.push(p);
      } catch { /* corrupt entry is not a fact */ }
    }
    const selected = selectCommunityPosts(query, posts);
    return selected.length ? 'KANAL/GURUH XABARLARI (ishtirokchi bayonoti, baza tasdig‘i emas; tarix to‘liq emas):\n' +
      JSON.stringify(selected) : '';
  } catch { return ''; }
}
