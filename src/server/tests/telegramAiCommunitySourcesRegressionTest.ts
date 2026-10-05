import assert from 'node:assert/strict';
import { communityPost, selectCommunityPosts, communitySmallTalkAnswer } from '../services/telegramAiCommunitySources';
import { buildAiGroundingContext, setTestGroundingOverride } from '../services/telegramAiGroundingService';

async function run() {
  const message = { message_id: 42, date: 1700000000, text: 'Angliya kubogi yarim final jadvali',
    chat: { id: -100123, type: 'channel', username: 'efl_uz' } };
  const post = communityPost(message)!;
  assert.equal(post.url, 'https://t.me/efl_uz/42');
  assert.equal(communityPost({ ...message, chat: { ...message.chat, username: 'other' } }), null);
  assert.equal(communityPost({ ...message, chat: { ...message.chat, type: 'private' } }), null);
  assert.equal(communityPost({ ...message, from: { is_bot: true } }), null);
  assert.equal(communityPost({ ...message, text: '/ai_confirm abc' }), null);
  assert.equal(communityPost({ ...message, message_id: -1 }), null);
  assert.equal(communityPost({ ...message, text: '', caption: 'Rasm ostidagi e’lon' })?.text, 'Rasm ostidagi e’lon');
  assert.equal(communityPost({ ...message, text: 'x'.repeat(5000) })?.text.length, 2000);
  assert.equal(communityPost({ ...message, edit_date: 1700000001 })?.updated, 1700000001);
  assert.ok(communityPost({ ...message, chat: { ...message.chat, type: 'supergroup', username: 'EFLEAGUEUZ' } }));
  assert.equal(selectCommunityPosts('yarim final', [post]).length, 1);
  assert.equal(selectCommunityPosts('Barcelona', [post]).length, 0);
  assert.equal(selectCommunityPosts('kanal', Array.from({ length: 10 }, (_, i) => ({ ...post, date: i }))).length, 6);
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
