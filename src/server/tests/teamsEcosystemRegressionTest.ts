/**
 * TEAMS Ecosystem & Configurable League Engine Regression Test Suite
 *
 * Verifies:
 * 1. Arbitrary league sizes (even & odd BYE rotation, no team playing twice in a round, single & double leg).
 * 2. Team creation ticket consumption (atomic, balance deduction, idempotency against double requests).
 * 3. Munfiz AI ticket management commands (grant, check, revoke, owner check, user disambiguation).
 * 4. Team invitation lifecycle (create invite, stranger blocked, invitee accept, idempotent duplicate protection).
 * 5. Mandatory @efleagueuz group membership check on team creation and roster join.
 * 6. Legacy roster preservation and account linking.
 */

import assert from 'node:assert/strict';
import {
  generateRoundRobinSchedule,
} from '../tournament/fixtureEngine';
import {
  generateTournamentPreview,
} from '../services/customTournamentEngine';
import {
  getUserTeamTicketBalance,
  grantUserTeamTickets,
  revokeUserTeamTickets,
  spendTeamTicket,
  clearMemoryTeamTicketStore,
  PRIMARY_OWNER_TELEGRAM_ID,
} from '../services/teamTicketService';
import {
  createTeam,
  getTeamById,
  createTeamInvitation,
  respondToTeamInvitation,
  cancelTeamInvitation,
  getUserPendingInvitations,
  clearMemoryTeamsStore,
} from '../services/teamService';
import {
  clearTelegramMembershipCache,
} from '../services/telegramBotService';
import { planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { assertAdminPlanReady } from '../services/telegramAiAdminPlanReadiness';
import { detectNaturalAdminAction } from '../services/telegramAiAdminLanguage';

// Force local fallback/test mode
process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';
process.env.TEST_SUPPRESS_BOT_NOTIFICATIONS = 'true';

async function runTests() {
  console.log('--- Starting TEAMS Ecosystem & League Engine Regression Tests ---');

  // ==========================================================================
  // TEST 1: Configurable League Size & Calendar (Even & Odd Teams)
  // ==========================================================================
  console.log('Test 1: Configurable League Calendar (Berger Round-Robin)');

  // 1a. Even teams: 6 teams, 1 leg
  const sixTeams = ['team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6'];
  const sched6 = generateRoundRobinSchedule(sixTeams, { homeAndAway: false });
  // Total matches for 6 teams in 1 leg = 6 * 5 / 2 = 15 matches across 5 matchdays
  assert.equal(sched6.length, 15, '6 teams single leg should have 15 matches');
  const matchdays6 = new Set(sched6.map(m => m.matchday));
  assert.equal(matchdays6.size, 5, '6 teams single leg should have 5 matchdays');

  // Verify no team plays twice in any single matchday
  for (let md = 1; md <= 5; md++) {
    const mdMatches = sched6.filter(m => m.matchday === md);
    assert.equal(mdMatches.length, 3, `Matchday ${md} should have 3 matches`);
    const teamsInMd = new Set<string>();
    for (const match of mdMatches) {
      assert.ok(!teamsInMd.has(match.homeClubId), `Team ${match.homeClubId} played twice in matchday ${md}`);
      assert.ok(!teamsInMd.has(match.awayClubId), `Team ${match.awayClubId} played twice in matchday ${md}`);
      teamsInMd.add(match.homeClubId);
      teamsInMd.add(match.awayClubId);
    }
    assert.equal(teamsInMd.size, 6, `All 6 teams must participate in matchday ${md}`);
  }

  // 1b. Odd teams: 5 teams, 1 leg (BYE round rotation)
  const fiveTeams = ['team-A', 'team-B', 'team-C', 'team-D', 'team-E'];
  const sched5 = generateRoundRobinSchedule(fiveTeams, { homeAndAway: false });
  // 5 teams single leg: 5 matchdays, 2 matches per matchday (1 bye per matchday), 10 total matches
  assert.equal(sched5.length, 10, '5 teams single leg should have 10 matches (1 team rests per round)');
  for (let md = 1; md <= 5; md++) {
    const mdMatches = sched5.filter(m => m.matchday === md);
    assert.equal(mdMatches.length, 2, `Matchday ${md} should have 2 matches`);
    const teamsInMd = new Set<string>();
    for (const match of mdMatches) {
      assert.ok(!teamsInMd.has(match.homeClubId), `Team ${match.homeClubId} played twice in matchday ${md}`);
      assert.ok(!teamsInMd.has(match.awayClubId), `Team ${match.awayClubId} played twice in matchday ${md}`);
      teamsInMd.add(match.homeClubId);
      teamsInMd.add(match.awayClubId);
    }
    assert.equal(teamsInMd.size, 4, `Exactly 4 teams play and 1 rests in matchday ${md}`);
  }

  // 1c. Large league: 20 teams, 2 legs
  const twentyTeams = Array.from({ length: 20 }, (_, i) => `team-${i + 1}`);
  const sched20 = generateRoundRobinSchedule(twentyTeams, { homeAndAway: true });
  // 20 * 19 = 380 matches across 38 matchdays
  assert.equal(sched20.length, 380, '20 teams double leg should have 380 matches');
  const matchdays20 = new Set(sched20.map(m => m.matchday));
  assert.equal(matchdays20.size, 38, '20 teams double leg should have 38 matchdays');

  // 1d. Preview generator validation up to 64
  const preview32 = generateTournamentPreview('LEAGUE', 32, { roundsCount: 2 });
  assert.equal(preview32.participantsCount, 32);
  assert.equal(preview32.totalMatches, (32 * 31 / 2) * 2);

  const previewPlayoff = generateTournamentPreview('PLAYOFF', 20, { playoffLegMode: 'SINGLE_LEG' });
  // Nearest power of 2 is 32, BYEs = 32 - 20 = 12
  assert.equal(previewPlayoff.byeCount, 12);
  console.log('✓ Configurable league calendars and Berger round-robin bye verified.');

  // ==========================================================================
  // TEST 2: Team Creation Ticket Management
  // ==========================================================================
  console.log('\nTest 2: Team Creation Ticket Management');
  clearMemoryTeamTicketStore();

  const testUserId = 'user-test-777';
  const testUserTgId = '7770001';

  // Initial balance is 0
  const initialBal = await getUserTeamTicketBalance(testUserId);
  assert.equal(initialBal.balance, 0, 'Initial ticket balance must be 0');

  // Attempt to spend ticket when balance is 0 should fail
  await assert.rejects(
    spendTeamTicket({ userId: testUserId, teamId: 'team-mock', idempotencyKey: 'idemp-1' }),
    (err: any) => err.code === 'INSUFFICIENT_TEAM_TICKETS',
    'Spending ticket without balance must throw INSUFFICIENT_TEAM_TICKETS'
  );

  // Non-owner cannot grant tickets
  await assert.rejects(
    grantUserTeamTickets({
      targetUserId: testUserId,
      adminTelegramId: '9999999', // not 5209126900
      amount: 1,
    }),
    (err: any) => err.code === 'OWNER_ONLY_UNAUTHORIZED',
    'Non-owner must be rejected from granting tickets'
  );

  // Primary owner (5209126900) grants 2 tickets
  const grantRes = await grantUserTeamTickets({
    targetUserId: testUserId,
    targetTelegramId: testUserTgId,
    adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
    amount: 2,
    note: 'Test grant for user',
  });
  assert.equal(grantRes.success, true);
  assert.equal(grantRes.account.balance, 2);

  // Spend 1 ticket
  const spendRes = await spendTeamTicket({
    userId: testUserId,
    teamId: 'team-101',
    idempotencyKey: 'idemp-team-101',
  });
  assert.equal(spendRes.success, true);
  assert.equal(spendRes.newBalance, 1, 'Balance should be decremented to 1');

  // Idempotent duplicate spend with same key should NOT decrement again
  const dupSpend = await spendTeamTicket({
    userId: testUserId,
    teamId: 'team-101',
    idempotencyKey: 'idemp-team-101',
  });
  assert.equal(dupSpend.newBalance, 1, 'Idempotent duplicate request must not decrement balance');

  // Owner revokes 1 unused ticket
  const revokeRes = await revokeUserTeamTickets({
    targetUserId: testUserId,
    adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
    amount: 1,
    note: 'Test revoke',
  });
  assert.equal(revokeRes.success, true);
  assert.equal(revokeRes.account.balance, 0, 'Balance after revoking should be 0');

  // Revoking more than balance must fail
  await assert.rejects(
    revokeUserTeamTickets({
      targetUserId: testUserId,
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      amount: 1,
    }),
    (err: any) => err.code === 'INSUFFICIENT_UNUSED_TICKETS',
    'Cannot revoke more than available unused balance'
  );

  console.log('✓ Team creation tickets, balance, idempotency, and owner RBAC verified.');

  // ==========================================================================
  // TEST 3: Munfiz AI Ticket Commands
  // ==========================================================================
  console.log('\nTest 3: Munfiz AI Natural Ticket Management');

  // 3a. Natural intent detection
  assert.equal(
    detectNaturalAdminAction('@texnoayti ga team ochish uchun 1 ticket ber'),
    'team_ticket_grant',
    'Should recognize team_ticket_grant'
  );
  assert.equal(
    detectNaturalAdminAction('@texnoayti ning team ticketini tekshir'),
    'team_ticket_check',
    'Should recognize team_ticket_check'
  );
  assert.equal(
    detectNaturalAdminAction('@texnoayti dan 1 ta foydalanilmagan team ticketini qaytarib ol'),
    'team_ticket_revoke',
    'Should recognize team_ticket_revoke'
  );

  // 3b. Natural planner parsing with exact user resolution
  const mockUsers = async () => [
    { id: 'user-100', telegramId: '10001', username: 'texnoayti', firstName: 'Texno', lastName: 'Ayti' },
  ];
  const mockRead = async () => ({ data: [], total: 0 });

  const grantPlan: any = await planNaturalAdminRequest(
    '@texnoayti ga team ochish uchun 2 ticket ber',
    { users: mockUsers as any, read: mockRead as any }
  );
  assert.equal(grantPlan.action, 'team_ticket_grant');
  assert.equal(grantPlan.body.targetUserId, 'user-100');
  assert.equal(grantPlan.body.amount, 2);
  assertAdminPlanReady(grantPlan);

  const checkPlan: any = await planNaturalAdminRequest(
    '@texnoayti ning team ticketini tekshir',
    { users: mockUsers as any, read: mockRead as any }
  );
  assert.equal(checkPlan.action, 'team_ticket_check');
  assert.equal(checkPlan.targetId, 'user-100');

  const revokePlan: any = await planNaturalAdminRequest(
    '@texnoayti dan 1 ta foydalanilmagan team ticketini qaytarib ol',
    { users: mockUsers as any, read: mockRead as any }
  );
  assert.equal(revokePlan.action, 'team_ticket_revoke');
  assert.equal(revokePlan.body.targetUserId, 'user-100');
  assert.equal(revokePlan.body.amount, 1);
  assertAdminPlanReady(revokePlan);

  console.log('✓ Munfiz AI natural command planning and exact account matching verified.');

  // ==========================================================================
  // TEST 4 & 5: Team Creation, Invitations, Stranger Blocking & Group Membership
  // ==========================================================================
  console.log('\nTest 4 & 5: Team Creation, Invitations, Stranger Blocking & Group Check');
  clearMemoryTeamsStore();
  clearMemoryTeamTicketStore();

  const originalFetch = global.fetch;
  let mockTgMembershipStatus: 'member' | 'left' = 'left';

  // Intercept Telegram API requests in test
  (global as any).fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('api.telegram.org')) {
      if (mockTgMembershipStatus === 'member') {
        return new Response(JSON.stringify({
          ok: true,
          result: { status: 'member' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({
          ok: false,
          description: 'Bad Request: user not found in chat',
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return originalFetch(url, init);
  };

  const creatorUserId = 'user-creator-1';
  const creatorTgId = '5209126900'; // primary owner

  // Grant 1 ticket to creator
  await grantUserTeamTickets({
    targetUserId: creatorUserId,
    targetTelegramId: creatorTgId,
    adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
    amount: 1,
  });

  // Step 4a: Creator tries to create team while NOT a member of @efleagueuz
  mockTgMembershipStatus = 'left';
  clearTelegramMembershipCache(creatorTgId);

  await assert.rejects(
    createTeam({
      name: 'Tashkent Eagles',
      tag: 'EGL',
      description: 'EFLUZ Elite Team',
      creatorUserId,
      creatorTelegramId: creatorTgId,
      creatorUsername: 'eagles_boss',
      creatorDisplayName: 'Eagles Boss',
    }),
    (err: any) => err.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
    'Must reject team creation if creator is not in @efleagueuz'
  );

  // Ticket was NOT spent because creation failed!
  const creatorBalAfterFail = await getUserTeamTicketBalance(creatorUserId);
  assert.equal(creatorBalAfterFail.balance, 1, 'Ticket must NOT be lost on failed team creation');

  // Step 4b: Creator joins @efleagueuz and creates team
  mockTgMembershipStatus = 'member';
  clearTelegramMembershipCache(creatorTgId);

  const team = await createTeam({
    name: 'Tashkent Eagles',
    tag: 'EGL',
    description: 'EFLUZ Elite Team',
    creatorUserId,
    creatorTelegramId: creatorTgId,
    creatorUsername: 'eagles_boss',
    creatorDisplayName: 'Eagles Boss',
  });

  assert.equal(team.name, 'Tashkent Eagles');
  assert.equal(team.tag, 'EGL');
  assert.equal(team.roster.length, 1);
  assert.equal(team.roster[0].role, 'ADMIN');
  assert.equal(team.roster[0].isVerifiedAccount, true, 'Creator must be verified in roster');

  const creatorBalAfterSuccess = await getUserTeamTicketBalance(creatorUserId);
  assert.equal(creatorBalAfterSuccess.balance, 0, '1 ticket must be spent after successful team creation');

  // Step 4c: Add a legacy unverified slot to the team roster
  const legacyMemberId = 'member_legacy_99';
  team.roster.push({
    id: legacyMemberId,
    displayName: 'Eski O‘yinchi (Manual)',
    role: 'MEMBER',
    isVerifiedAccount: false,
    joinedAt: new Date().toISOString(),
  });

  // Step 4d: Team admin sends invitation to real EFLUZ user for this legacy slot
  const playerUserId = 'user-player-2';
  const playerTgId = '9998881';

  const inv = await createTeamInvitation({
    teamId: team.id,
    inviterUserId: creatorUserId,
    inviterDisplayName: 'Eagles Boss',
    inviterTelegramId: creatorTgId,
    inviteeUser: {
      id: playerUserId,
      telegramId: playerTgId,
      username: 'fast_striker',
      displayName: 'Fast Striker',
    },
    legacyRosterMemberId: legacyMemberId,
  });

  assert.equal(inv.status, 'PENDING');
  assert.equal(inv.inviteeUserId, playerUserId);
  assert.equal(inv.legacyRosterMemberId, legacyMemberId);

  // Step 4e: Stranger (different user) cannot respond to invitation
  await assert.rejects(
    respondToTeamInvitation({
      invitationId: inv.id,
      userId: 'user-stranger-99',
      telegramId: '1111111',
      accept: true,
    }),
    (err: any) => err.code === 'FORBIDDEN_NOT_INVITEE',
    'Stranger must be blocked from responding to someone else invitation'
  );

  // Step 4f: Invitee tries to accept while NOT in group
  mockTgMembershipStatus = 'left';
  clearTelegramMembershipCache(playerTgId);

  await assert.rejects(
    respondToTeamInvitation({
      invitationId: inv.id,
      userId: playerUserId,
      telegramId: playerTgId,
      accept: true,
    }),
    (err: any) => err.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
    'Invitee must be blocked from accepting if not member of @efleagueuz'
  );

  // Step 4g: Invitee joins group and accepts invitation
  mockTgMembershipStatus = 'member';
  clearTelegramMembershipCache(playerTgId);

  const acceptRes = await respondToTeamInvitation({
    invitationId: inv.id,
    userId: playerUserId,
    telegramId: playerTgId,
    accept: true,
  });
  assert.equal(acceptRes.success, true);
  assert.equal(acceptRes.status, 'ACCEPTED');

  // Verify the legacy unverified slot was linked to real verified account
  const freshTeamAfter = await getTeamById(team.id);
  const linkedMember = freshTeamAfter?.roster.find(m => m.id === legacyMemberId || m.userId === playerUserId);
  assert.ok(linkedMember);
  assert.equal(linkedMember?.isVerifiedAccount, true, 'Member is now verified');
  assert.equal(linkedMember?.userId, playerUserId);
  assert.equal(linkedMember?.displayName, 'Fast Striker');

  // Repeated accept is idempotent
  const repeatAccept = await respondToTeamInvitation({
    invitationId: inv.id,
    userId: playerUserId,
    telegramId: playerTgId,
    accept: true,
  });
  assert.equal(repeatAccept.success, true);
  const recheckedTeam = await getTeamById(team.id);
  assert.equal(recheckedTeam?.roster.length, 2, 'Roster member must not be duplicated');

  // Restore fetch
  global.fetch = originalFetch;

  console.log('✓ Team creation, invite lifecycle, stranger blocking, group check, and legacy linking verified.');

  console.log('\n--- All TEAMS Ecosystem & League Engine Regression Tests PASSED! ---');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
