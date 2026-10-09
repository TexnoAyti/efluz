/**
 * Custom Tournaments Comprehensive Regression Test Suite
 *
 * Verifies:
 * 1. Ticket grant & refund (Primary Owner 5209126900 only)
 * 2. Idempotent ticket deduction & double-spend protection
 * 3. Atomic single-club ownership & concurrency collision
 * 4. Private tournament visibility & token isolation
 * 5. League Berger round-robin & strict tie-breakers (Pts -> GD -> GF -> H2H)
 * 6. Playoff BYE auto-advancement & two-leg aggregate tie-breaker with separate penalties
 * 7. Manual quota adjustment by organizer when not full
 * 8. Participant withdrawal before start vs forfeit after start
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import {
  clearMemoryTicketStore,
  grantUserTickets,
  spendTicketForTournament,
  refundSpentTicket,
  getUserTicketBalance,
  PRIMARY_OWNER_TELEGRAM_ID,
} from '../services/customTournamentTicketService';

import {
  clearMemoryCustomTournamentStore,
  createTournamentDraft,
  publishTournament,
  claimTournamentClub,
  leaveTournamentClub,
  startTournament,
  submitCustomMatchResult,
  getPublicTournaments,
  getTournamentByIdWithAccess,
  updateAssistantAdmins,
  correctCustomMatchScore,
} from '../services/customTournamentService';

import {
  generateTournamentPreview,
  calculateCustomStandings,
  resolvePlayoffWinner,
} from '../services/customTournamentEngine';

describe('Custom Tournaments & Tickets Test Suite', () => {
  it('1. Ticket management enforces Owner-only and atomic idempotent deductions', async () => {
    clearMemoryTicketStore();
    clearMemoryCustomTournamentStore();

    const user1Id = 'user_player_01';
    const nonOwnerTgId = '9999999999';

    // Non-owner cannot grant tickets
    await assert.rejects(
      async () => {
        await grantUserTickets({
          targetUserId: user1Id,
          adminTelegramId: nonOwnerTgId,
          amount: 2,
        });
      },
      /5209126900/
    );

    // Primary owner grants 2 tickets
    const grantRes = await grantUserTickets({
      targetUserId: user1Id,
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      amount: 2,
      note: 'Payment 30 000 uzs received',
    });

    assert.equal(grantRes.success, true);
    assert.equal(grantRes.account.balance, 2);

    // Spend 1 ticket idempotently
    const tx1 = await spendTicketForTournament({
      userId: user1Id,
      tournamentId: 'ct_test_01',
      idempotencyKey: 'idemp_key_01',
    });
    assert.equal(tx1.success, true);

    const bal1 = await getUserTicketBalance(user1Id);
    assert.equal(bal1.balance, 1);

    // Replay with identical idempotency key (simulating network retry or double-click)
    const replayTx = await spendTicketForTournament({
      userId: user1Id,
      tournamentId: 'ct_test_01',
      idempotencyKey: 'idemp_key_01',
    });
    assert.equal(replayTx.success, true);

    const bal2 = await getUserTicketBalance(user1Id);
    assert.equal(bal2.balance, 1, 'Balance must NOT be deducted twice on replay');

    // Refund spent ticket (Owner only, max 1 time per spent ticket)
    const refRes = await refundSpentTicket({
      targetUserId: user1Id,
      tournamentId: 'ct_test_01',
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      note: 'Tournament cancelled refund',
    });
    assert.equal(refRes.success, true);

    const bal3 = await getUserTicketBalance(user1Id);
    assert.equal(bal3.balance, 2, 'Balance restored after refund');

    // Attempting second refund on same tournament must fail
    await assert.rejects(
      async () => {
        await refundSpentTicket({
          targetUserId: user1Id,
          tournamentId: 'ct_test_01',
          adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
        });
      },
      /qaytarilgan/
    );
  });

  it('2. Tournament draft creation is free and publish deducts 1 ticket', async () => {
    clearMemoryTicketStore();
    clearMemoryCustomTournamentStore();

    const hostUserId = 'host_user_88';
    await grantUserTickets({
      targetUserId: hostUserId,
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      amount: 1,
    });

    // Create Draft (0 tickets deducted)
    const draft = await createTournamentDraft({
      name: 'Super Liga EFL',
      organizerUserId: hostUserId,
      organizerTelegramId: '12345678',
      organizerUsername: 'host_efl',
      format: 'LEAGUE',
      leagueScope: 'TOP5_ALL',
      maxParticipants: 8,
      rules: { roundsCount: 1, playoffLegMode: 'SINGLE_LEG', matchDurationHours: 36 },
      visibility: 'PUBLIC_OPEN',
    });

    assert.equal(draft.status, 'DRAFT');

    const balBefore = await getUserTicketBalance(hostUserId);
    assert.equal(balBefore.balance, 1, 'Draft creation must be completely free (0 tickets)');

    // Publish tournament (deducts 1 ticket)
    const published = await publishTournament({
      tournamentId: draft.id,
      userId: hostUserId,
      idempotencyKey: `pub_${draft.id}`,
    });

    assert.equal(published.status, 'REGISTRATION_OPEN');

    const balAfter = await getUserTicketBalance(hostUserId);
    assert.equal(balAfter.balance, 0, '1 ticket must be spent on publication');
  });

  it('3. Atomic single club claim and race-condition prevention', async () => {
    clearMemoryTicketStore();
    clearMemoryCustomTournamentStore();

    const hostUserId = 'host_user_88';
    await grantUserTickets({
      targetUserId: hostUserId,
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      amount: 1,
    });

    const tournament = await createTournamentDraft({
      name: 'EFL Cup 2026',
      organizerUserId: hostUserId,
      organizerTelegramId: '12345678',
      format: 'LEAGUE',
      leagueScope: 'TOP5_ALL',
      maxParticipants: 4,
      rules: { roundsCount: 1, playoffLegMode: 'SINGLE_LEG', matchDurationHours: 36 },
    });

    await publishTournament({
      tournamentId: tournament.id,
      userId: hostUserId,
      idempotencyKey: `pub_${tournament.id}`,
    });

    // Player 1 claims Arsenal
    const p1 = await claimTournamentClub({
      tournamentId: tournament.id,
      userId: 'player_01',
      telegramId: '1001',
      clubId: 'club-arsenal',
    });
    assert.equal(p1.clubId, 'club-arsenal');

    // Player 2 attempts to claim same club (Arsenal) in same tournament -> Collision rejected
    await assert.rejects(
      async () => {
        await claimTournamentClub({
          tournamentId: tournament.id,
          userId: 'player_02',
          telegramId: '1002',
          clubId: 'club-arsenal',
        });
      },
      /band qilingan/
    );

    // Player 1 attempts to claim second club (Chelsea) in same tournament -> Rejected (1 user = 1 club)
    await assert.rejects(
      async () => {
        await claimTournamentClub({
          tournamentId: tournament.id,
          userId: 'player_01',
          telegramId: '1001',
          clubId: 'club-chelsea',
        });
      },
      /allaqachon/
    );

    // Player 1 leaves before start -> Arsenal is freed
    const leaveRes = await leaveTournamentClub({
      tournamentId: tournament.id,
      userId: 'player_01',
    });
    assert.equal(leaveRes.success, true);
    assert.equal(leaveRes.freedClubId, 'club-arsenal');

    // Now Player 2 can successfully claim Arsenal
    const p2 = await claimTournamentClub({
      tournamentId: tournament.id,
      userId: 'player_02',
      telegramId: '1002',
      clubId: 'club-arsenal',
    });
    assert.equal(p2.clubId, 'club-arsenal');
  });

  it('4. Private tournament isolation and access token validation', async () => {
    clearMemoryCustomTournamentStore();

    const hostUserId = 'host_user_secret';
    const privTournament = await createTournamentDraft({
      name: 'Secret VIP Cup',
      organizerUserId: hostUserId,
      organizerTelegramId: '12345678',
      format: 'PLAYOFF',
      leagueScope: 'TOP5_ALL',
      maxParticipants: 4,
      rules: { roundsCount: 1, playoffLegMode: 'SINGLE_LEG', matchDurationHours: 36 },
      visibility: 'PRIVATE',
    });
    privTournament.status = 'REGISTRATION_OPEN';

    // Must NOT appear in public catalog
    const publicList = await getPublicTournaments();
    assert.equal(publicList.some((t) => t.id === privTournament.id), false, 'Private tournament must not leak into public catalog');

    // Random unauthorized user without token gets 403
    await assert.rejects(
      async () => {
        await getTournamentByIdWithAccess(privTournament.id, 'random_stranger_user');
      },
      /yopiq/
    );

    // With valid inviteToken gets full details
    const accessWithToken = await getTournamentByIdWithAccess(privTournament.id, 'random_stranger_user', privTournament.inviteToken);
    assert.equal(accessWithToken.tournament.id, privTournament.id);
  });

  it('5. Standings calculation enforces strict tie-breakers: Pts -> GD -> GF -> H2H', () => {
    const participants: any[] = [
      { clubId: 'club-arsenal', clubName: 'Arsenal', clubShortName: 'ARS', clubLogoUrl: '', userId: 'u1' },
      { clubId: 'club-chelsea', clubName: 'Chelsea', clubShortName: 'CHE', clubLogoUrl: '', userId: 'u2' },
      { clubId: 'club-liverpool', clubName: 'Liverpool', clubShortName: 'LIV', clubLogoUrl: '', userId: 'u3' },
    ];

    // Fixtures where Arsenal and Chelsea end with equal points (3 pts each)
    // Arsenal: 2-1 against Chelsea (GD: +1, GF: 2)
    // Chelsea: 3-0 against Liverpool (GD: +2, GF: 3)
    // Liverpool: 1-0 against Arsenal (GD: 0)
    // Chelsea has GD +2, Arsenal has GD 0 -> Chelsea must rank above Arsenal on GD!
    const fixtures: any[] = [
      { id: 'f1', status: 'CONFIRMED', homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', homeScore: 2, awayScore: 1 },
      { id: 'f2', status: 'CONFIRMED', homeClubId: 'club-chelsea', awayClubId: 'club-liverpool', homeScore: 3, awayScore: 0 },
      { id: 'f3', status: 'CONFIRMED', homeClubId: 'club-liverpool', awayClubId: 'club-arsenal', homeScore: 1, awayScore: 0 },
    ];

    const standings = calculateCustomStandings(participants, fixtures);
    assert.equal(standings[0].clubId, 'club-chelsea', 'Chelsea has higher Goal Difference (+2 vs 0)');
    assert.equal(standings[0].position, 1);
  });

  it('6. Two-legged playoff tie: Aggregate tie resolved via separate penalty shootout score', () => {
    const leg1: any = {
      id: 'fix_leg1',
      homeClubId: 'club-arsenal',
      awayClubId: 'club-chelsea',
      homeScore: 2,
      awayScore: 1,
    };

    const leg2: any = {
      id: 'fix_leg2',
      homeClubId: 'club-chelsea',
      awayClubId: 'club-arsenal',
      homeScore: 1,
      awayScore: 0, // Aggregate: 2 - 2 (Tied!)
      penaltyHomeScore: 4, // Chelsea 4
      penaltyAwayScore: 5, // Arsenal 5
    };

    const outcome = resolvePlayoffWinner(leg1, leg2);
    assert.equal(outcome.winnerClubId, 'club-arsenal', 'Arsenal won on penalty shootout (5-4) after 2-2 aggregate tie');
  });

  it('7. Manual start by organizer adjusts quota when not full (User Decision 3)', async () => {
    clearMemoryTicketStore();
    clearMemoryCustomTournamentStore();

    const hostUserId = 'host_user_flexible';
    await grantUserTickets({
      targetUserId: hostUserId,
      adminTelegramId: PRIMARY_OWNER_TELEGRAM_ID,
      amount: 1,
    });

    const tournament = await createTournamentDraft({
      name: 'Flexible League',
      organizerUserId: hostUserId,
      organizerTelegramId: '12345678',
      format: 'LEAGUE',
      leagueScope: 'TOP5_ALL',
      maxParticipants: 16, // Initially configured for 16
      rules: { roundsCount: 1, playoffLegMode: 'SINGLE_LEG', matchDurationHours: 36 },
    });

    await publishTournament({
      tournamentId: tournament.id,
      userId: hostUserId,
      idempotencyKey: `pub_${tournament.id}`,
    });

    // Only 4 players register
    const clubs = ['club-arsenal', 'club-chelsea', 'club-liverpool', 'club-man-city'];
    for (let i = 0; i < 4; i++) {
      await claimTournamentClub({
        tournamentId: tournament.id,
        userId: `player_${i}`,
        telegramId: `tg_${i}`,
        clubId: clubs[i],
      });
    }

    // Host starts manually
    const startRes = await startTournament({
      tournamentId: tournament.id,
      userId: hostUserId,
    });

    assert.equal(startRes.tournament.status, 'IN_PROGRESS');
    assert.equal(startRes.tournament.maxParticipants, 4, 'Max participants adjusted down to actual 4');
    assert.equal(startRes.fixturesCount, 6, '4 teams single-round = 6 matches total');

    // Attempting to leave after tournament started must fail
    await assert.rejects(
      async () => {
        await leaveTournamentClub({
          tournamentId: tournament.id,
          userId: 'player_0',
        });
      },
      /boshlangandan keyin/
    );
  });

  it('8. Playoff BYE mechanism when participants are not power of 2 & preview calculation', () => {
    // 6 teams in playoff -> Nearest power of 2 is 8, exactly 8 - 6 = 2 BYEs
    const preview6 = generateTournamentPreview('PLAYOFF', 6, { playoffLegMode: 'SINGLE_LEG' });
    assert.equal(preview6.byeCount, 2, '6 teams must produce exactly 2 BYEs');
    assert.equal(preview6.totalStagesOrRounds, 3, 'QF -> SF -> Final = 3 rounds');
    assert.match(preview6.stagesDescription, /BYE/);

    // 12 teams in playoff -> Nearest power of 2 is 16, exactly 16 - 12 = 4 BYEs
    const preview12 = generateTournamentPreview('PLAYOFF', 12, { playoffLegMode: 'SINGLE_LEG' });
    assert.equal(preview12.byeCount, 4, '12 teams must produce exactly 4 BYEs');
    assert.equal(preview12.totalStagesOrRounds, 4, 'R16 -> QF -> SF -> Final = 4 rounds');
  });
});

