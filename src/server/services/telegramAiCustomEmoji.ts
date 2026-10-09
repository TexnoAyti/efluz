import { KEY_PREFIX } from '../readModel/readModelStore';
import { getAiRedisClient } from './telegramAiDeadline';

export interface AiCustomEmoji { emoji: string; id: string; }
interface EmojiEntity { type?: string; offset?: number; length?: number; custom_emoji_id?: string; }
const key = `${KEY_PREFIX}:ai:custom-emoji`;
export function extractAiCustomEmoji(text: string, entities: EmojiEntity[] = []): AiCustomEmoji[] {
  return entities.filter(e => e.type === 'custom_emoji' && /^\d{1,24}$/.test(e.custom_emoji_id || '') &&
    Number.isInteger(e.offset) && e.offset! >= 0 && Number.isInteger(e.length) && e.length! > 0 &&
    e.offset! + e.length! <= text.length).map(e => ({ emoji: text.slice(e.offset!, e.offset! + e.length!), id: e.custom_emoji_id! }))
    .filter(e => e.emoji.length <= 20 && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(e.emoji) && !/[<>&\s]/.test(e.emoji))
    .slice(0, 32);
}
export async function saveAiCustomEmoji(palette: AiCustomEmoji[]): Promise<number> {
  const redis = getAiRedisClient();
  if (!redis) throw new Error('EMOJI_REDIS_UNAVAILABLE');
  if (!palette.length) return 0;
  const count = await redis.eval(`
    -- EFL_AI_EMOJI_SAVE_V1
    local count = 0
    for i = 1, #ARGV, 2 do
      if redis.call('HEXISTS', KEYS[1], ARGV[i]) == 1 or redis.call('HLEN', KEYS[1]) < 32 then
        redis.call('HSET', KEYS[1], ARGV[i], ARGV[i+1]); count = count + 1
      end
    end
    return count
  `, [key], palette.flatMap(e => [e.emoji, `id:${e.id}`]));
  return Number(count);
}
export function renderAiCustomEmoji(escapedHtml: string, palette: AiCustomEmoji[], maxEmojis = 3): string {
  // Replace escaped, plain text only. Model-generated tags are never accepted.
  const valid = palette.filter(e => /^\d{1,24}$/.test(e.id) && e.emoji.length <= 20 &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(e.emoji) && !/[<>&\s]/.test(e.emoji));
  const map = new Map(valid.map(e => [e.emoji, e.id]));
  const alternatives = [...map.keys()].sort((a, b) => b.length - a.length)
    .map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!alternatives.length) return escapedHtml;
  const limit = Number.isFinite(maxEmojis) ? Math.max(0, Math.min(32, Math.floor(maxEmojis))) : 3;
  let count = 0;
  return escapedHtml.replace(new RegExp(alternatives.join('|'), 'gu'), emoji =>
    ++count <= limit ? `<tg-emoji emoji-id="${map.get(emoji)}">${emoji}</tg-emoji>` : emoji);
}
export async function decorateAiCustomEmoji(escapedHtml: string, signal: AbortSignal, maxEmojis = 3): Promise<string> {
  const redis = getAiRedisClient(signal);
  if (!redis || signal.aborted) return escapedHtml;
  try {
    const raw = await redis.eval("-- EFL_AI_EMOJI_READ_V1\nreturn redis.call('HGETALL', KEYS[1])", [key], []);
    const values = Array.isArray(raw) ? raw : [];
    const palette: AiCustomEmoji[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) palette.push({ emoji: String(values[i]), id: String(values[i+1]).replace(/^id:/, '') });
    return renderAiCustomEmoji(escapedHtml, palette, maxEmojis);
  } catch { return escapedHtml; }
}
