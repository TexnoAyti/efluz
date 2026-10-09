import assert from 'node:assert/strict';
import { communityPost, selectCommunityPosts, communitySmallTalkAnswer, communityFallback } from '../services/telegramAiCommunitySources';
import { buildAiGroundingContext, setTestGroundingOverride } from '../services/telegramAiGroundingService';

async function run() {
  const message = { message_id: 42, date: 1700000000, text: 'Angliya kubogi yarim final jadvali',
    chat: { id: -100123, type: 'channel', username: 'efl_uz' } };
  const post = communityPost(message)!;
  assert.equal(post.url, 'https://t.me/efl_uz/42');
  assert.equal(communityPost({ ...message, chat: { ...message.chat, username: 'other' } }), null);
  assert.equal(communityPost({ ...message, chat: { ...message.chat, type: 'private' } }), null);
  assert.ok(communityPost({ ...message, from: { is_bot: true } }), 'Channel announcements posted by a bot remain readable');
  assert.equal(communityPost({ ...message, from: { is_bot: true }, chat: { ...message.chat, type: 'supergroup', username: 'efleagueuz' } }), null);
  assert.equal(communityPost({ ...message, text: '/ai_confirm abc' }), null);
  assert.equal(communityPost({ ...message, message_id: -1 }), null);
  assert.equal(communityPost({ ...message, text: '', caption: 'Rasm ostidagi e’lon' })?.text, 'Rasm ostidagi e’lon');
  assert.equal(communityPost({ ...message, text: 'x'.repeat(5000) })?.text.length, 2000);
  assert.equal(communityPost({ ...message, edit_date: 1700000001 })?.updated, 1700000001);
  assert.ok(communityPost({ ...message, chat: { ...message.chat, type: 'supergroup', username: 'EFLEAGUEUZ' } }));
  const forwarded = { message_id: 901, date: 1800000000, text: message.text,
    from: { id: 5209126900 }, chat: { id: 5209126900, type: 'private' },
    forward_origin: { type: 'channel', date: message.date, message_id: 42, chat: message.chat } };
  assert.equal(communityPost(forwarded)?.url, post.url, 'Original channel URL, never private message ID');
  assert.equal(communityPost(forwarded)?.date, message.date);
  assert.equal(communityPost({ ...forwarded, from: { id: 123 }, chat: { id: 123, type: 'private' } }), null);
  assert.equal(communityPost({ ...forwarded, forward_origin: { ...forwarded.forward_origin, chat: { ...message.chat, username: 'other' } } }), null);
  assert.equal(communityPost({ ...forwarded, from: { is_bot: true }, chat: { id: -1001, type: 'supergroup', username: 'efleagueuz' }, is_automatic_forward: true })?.source, 'efl_uz');
  assert.equal(selectCommunityPosts('yarim final', [post]).length, 1);
  assert.equal(selectCommunityPosts('Barcelona', [post]).length, 0);
  assert.equal(selectCommunityPosts('kanal', Array.from({ length: 10 }, (_, i) => ({ ...post, date: i }))).length, 6);
  const groupPosts = Array.from({ length: 9 }, (_, i) => ({ ...post, source: 'efleagueuz', date: post.date + i + 1, url: `https://t.me/efleagueuz/${100 + i}` }));
  assert.deepEqual(selectCommunityPosts('@efl_uz yarim final', [post, ...groupPosts]), [post]);
  assert.deepEqual(selectCommunityPosts('kanaldagi yarim final', [post, ...groupPosts]), [post]);
  assert.ok(selectCommunityPosts('yarim final', [post, ...groupPosts]).includes(post), 'Channel evidence survives busy group');
  assert.deepEqual(selectCommunityPosts(post.url, [post, ...groupPosts]), [post]);
  assert.match(communityFallback('kanaldagi yarim final', 'Evidence:\n' + JSON.stringify([post]))!, /https:\/\/t.me\/efl_uz\/42/);
  assert.match(communityFallback('kanalda nima bor', '')!, /to‘liq o‘qiganman/);
  assert.equal(communityFallback('Arsenal egasi kim', ''), undefined);
  assert.ok(communitySmallTalkAnswer('eng zo‘r admin kim?')?.includes('Rasmiy reyting emas'));
  assert.notEqual(communitySmallTalkAnswer('eng zo‘r admin kim?', 0), communitySmallTalkAnswer('eng zo‘r admin kim?', 1));
  assert.equal(communitySmallTalkAnswer('klub egasi kim?'), undefined);
  setTestGroundingOverride({ competitions: [], clubs: [], fixtures: {} });
  try {
    const context = await buildAiGroundingContext('Eng zo‘r admin kim?');
    assert.ok(context.factualAnswer?.includes('Eng zo‘ri?'));
    assert.ok(!context.factualAnswer?.includes('@'), 'No invented username');
  } finally { setTestGroundingOverride(null); }
  console.log('PASS community allowlist, captions, edits, bounds, search and subjective admin reply');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
