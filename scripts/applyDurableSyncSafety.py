from pathlib import Path
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# 1) redisOutbox.ts: atomic claim + stale SYNCING recovery
p = Path('src/server/outbox/redisOutbox.ts')
s = p.read_text()
marker = "export function isRedisOutboxConfigured(): boolean {\n  return getUpstashClient() !== null;\n}\n"
insert = marker + r'''

const DEFAULT_CLAIM_LEASE_MS = 120_000;

/**
 * Atomically claims due Redis outbox mutations for one replay worker.
 * A claimed item is moved to SYNCING and leased for 120 seconds so a dead
 * worker can be recovered without duplicate concurrent replay.
 */
export async function claimDuePendingMutations(
  limit = 15,
  leaseMs = DEFAULT_CLAIM_LEASE_MS
): Promise<DurableOutboxMutation[]> {
  const client = getUpstashClient();
  if (!client) return [];

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const staleBeforeIso = new Date(now - leaseMs).toISOString();
  const leaseUntil = now + leaseMs;
  const mutationPrefix = `${KEY_PREFIX}:outbox:mutation:`;

  try {
    const raw = await client.eval<any>(`
      local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
      local claimed = {}
      for _, id in ipairs(ids) do
        local mutationKey = ARGV[6] .. id
        local encoded = redis.call('GET', mutationKey)
        if encoded then
          local ok, mut = pcall(cjson.decode, encoded)
          if ok and mut then
            local status = tostring(mut.status or 'PENDING')
            local updatedAt = tostring(mut.updatedAt or '')
            local canClaim = status == 'PENDING'
              or (status == 'SYNCING' and updatedAt ~= '' and updatedAt <= ARGV[4])
            if canClaim then
              mut.status = 'SYNCING'
              mut.updatedAt = ARGV[3]
              mut.nextRetryAt = tonumber(ARGV[5])
              local nextEncoded = cjson.encode(mut)
              redis.call('SET', mutationKey, nextEncoded)
              redis.call('ZADD', KEYS[1], ARGV[5], id)
              table.insert(claimed, nextEncoded)
            end
          end
        else
          redis.call('ZREM', KEYS[1], id)
        end
      end
      return cjson.encode(claimed)
    `, [OUTBOX_KEYS.pending()], [
      String(now),
      String(Math.max(1, Math.min(limit, 50))),
      nowIso,
      staleBeforeIso,
      String(leaseUntil),
      mutationPrefix,
    ]);

    const rows: any[] = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    return rows
      .map((row) => {
        if (typeof row === 'string') {
          try { return JSON.parse(row); } catch { return null; }
        }
        return row;
      })
      .filter(Boolean) as DurableOutboxMutation[];
  } catch (err: any) {
    console.warn('[DURABLE_OUTBOX] Atomic claim failed:', err?.message || err);
    return [];
  }
}
'''
s = replace_once(s, marker, insert, 'redis claim insertion')
p.write_text(s)

# 2) mutationQueue.ts
p = Path('src/server/sync/mutationQueue.ts')
s = p.read_text()
s = replace_once(s, "import { assertNoSyntheticIdsInProduction } from '../utils/testGuard';\n", "import { assertNoSyntheticIdsInProduction } from '../utils/testGuard';\nimport { waitUntil } from '@vercel/functions';\n", 'waitUntil import')
s = replace_once(s, "  getDuePendingMutations,\n", "  getDuePendingMutations,\n  claimDuePendingMutations,\n", 'claim import')

marker = '''export function getQueueStats() {
  const all = getPendingMutations();
  return {
    total: all.length,
    pending: all.filter((m) => m.status === 'PENDING').length,
    syncing: all.filter((m) => m.status === 'SYNCING').length,
    synced: all.filter((m) => m.status === 'SYNCED').length,
    failed: all.filter((m) => m.status === 'FAILED').length,
  };
}
'''
insert = marker + r'''

/** Event-driven replay trigger after Redis has durably accepted a mutation. */
export function scheduleDurableMutationReplay(): void {
  if (!isRedisOutboxConfigured()) return;
  const work = processPendingMutations().catch((err) => {
    console.warn('[MUTATION_WORKER] Event-driven replay deferred:', err?.message || err);
  });
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}
'''
s = replace_once(s, marker, insert, 'scheduler insertion')
s = replace_once(s, "  await persistDurableMutation(durableMutation);\n\n  // 2. Only after Redis persistence succeeds, update local memory & SQLite mirror\n", "  await persistDurableMutation(durableMutation);\n  scheduleDurableMutationReplay();\n\n  // 2. Only after Redis persistence succeeds, update local memory & SQLite mirror\n", 'durable enqueue schedule')
old = '''  persistDurableMutation(durableMutation).catch((err) => {
    console.warn('[MUTATION_QUEUE] Background Redis persistence failed:', err);
  });
'''
new = '''  persistDurableMutation(durableMutation)
    .then(() => scheduleDurableMutationReplay())
    .catch((err) => {
      console.warn('[MUTATION_QUEUE] Background Redis persistence failed:', err);
    });
'''
s = replace_once(s, old, new, 'sync enqueue schedule')
s = replace_once(s, "        const redisDue = await getDuePendingMutations(15);\n", "        const redisDue = await claimDuePendingMutations(15, 120_000);\n", 'atomic claim use')
s = replace_once(s, "      await markMutationSyncing(item.mutationId).catch(() => {});\n      updateMutationStatus(item.mutationId, 'SYNCING');\n", "      updateMutationStatus(item.mutationId, 'SYNCING');\n", 'remove non-atomic mark')
old = '''        const isQuota = firestoreCircuitBreaker.isQuotaExhaustedError(err);
        const isOwnershipMismatch = err.message?.includes('OWNERSHIP_MISMATCH');
        const isTerminalError = isOwnershipMismatch;
'''
new = '''        const isQuota = firestoreCircuitBreaker.isQuotaExhaustedError(err);
        const terminalReplayCodes = [
          'OWNERSHIP_MISMATCH',
          'FIXTURE_ALREADY_CONFIRMED',
          'SUBMISSION_CONFLICT',
          'INVALID_FIXTURE_PARTICIPANT',
        ];
        const isTerminalError = terminalReplayCodes.some((code) => err.message?.includes(code));
'''
s = replace_once(s, old, new, 'terminal replay codes')

start = s.index("    case 'RESULT_SUBMISSION': {")
end = s.index("    case 'ADMIN_APPROVE_RESULT': {", start)
result_block = r'''    case 'RESULT_SUBMISSION': {
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(payload.submissionId);

      const replay = await db.runTransaction(async (tx) => {
        const fixDoc = await tx.get(fixRef);
        if (!fixDoc.exists) throw new Error(`Fixture ${entityId} not found in Firestore.`);

        const fixData = fixDoc.data()!;
        if (![fixData.homeClubId, fixData.awayClubId].includes(payload.userClubId)) {
          throw new Error(`INVALID_FIXTURE_PARTICIPANT: club ${payload.userClubId} does not belong to fixture ${entityId}.`);
        }

        const seasonId = fixData.seasonId || payload.seasonId || 'season-2026-27';
        const occupancyRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${payload.userClubId}`);
        const submissionsQuery = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', entityId);

        const occupancyDoc = await tx.get(occupancyRef);
        const existingSubDoc = await tx.get(subRef);
        const submissionsSnap = await tx.get(submissionsQuery);

        const occupancy = occupancyDoc.exists ? occupancyDoc.data() : null;
        if (!occupancy || occupancy.userId !== payload.userId || ['released', 'inactive'].includes(String(occupancy.status || '').toLowerCase())) {
          throw new Error(`OWNERSHIP_MISMATCH: user ${payload.userId} no longer owns club ${payload.userClubId} in ${seasonId}.`);
        }

        const incomingSubmission = {
          id: payload.submissionId,
          fixtureId: entityId,
          submittedByUserId: payload.userId,
          clubId: payload.userClubId,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          proofUrl: payload.proofUrl || null,
          createdAt: payload.createdAt || new Date().toISOString(),
        };

        if (existingSubDoc.exists) {
          const existing = existingSubDoc.data()!;
          const same = existing.fixtureId === entityId && existing.submittedByUserId === payload.userId && existing.clubId === payload.userClubId && Number(existing.homeScore) === Number(payload.homeScore) && Number(existing.awayScore) === Number(payload.awayScore);
          if (!same) throw new Error(`SUBMISSION_CONFLICT: submission ${payload.submissionId} already exists with different data.`);
        }

        const confirmedMatchesIncoming = Number(fixData.homeScore) === Number(payload.homeScore) && Number(fixData.awayScore) === Number(payload.awayScore);
        if (fixData.status === 'CONFIRMED' && !confirmedMatchesIncoming) {
          throw new Error(`FIXTURE_ALREADY_CONFIRMED: fixture ${entityId} is already confirmed as ${fixData.homeScore}-${fixData.awayScore}.`);
        }

        const existingSubmissions = submissionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        const sameActorOther = existingSubmissions.find((sub: any) => sub.submittedByUserId === payload.userId && sub.id !== payload.submissionId);
        if (sameActorOther && (Number(sameActorOther.homeScore) !== Number(payload.homeScore) || Number(sameActorOther.awayScore) !== Number(payload.awayScore) || sameActorOther.clubId !== payload.userClubId)) {
          throw new Error(`SUBMISSION_CONFLICT: user ${payload.userId} already submitted a different result for ${entityId}.`);
        }

        if (!existingSubDoc.exists) tx.create(subRef, incomingSubmission);

        if (fixData.status === 'CONFIRMED') {
          return { fixData, newStatus: 'CONFIRMED', winnerClubId: fixData.winnerClubId ?? null };
        }

        const byActor = new Map<string, any>();
        for (const sub of existingSubmissions) {
          if (sub.id === payload.submissionId) continue;
          if (sub.submittedByUserId) byActor.set(sub.submittedByUserId, sub);
        }
        byActor.set(payload.userId, incomingSubmission);
        const submissions = Array.from(byActor.values());

        let newStatus = fixData.status;
        let confirmedHome: number | null = fixData.homeScore ?? null;
        let confirmedAway: number | null = fixData.awayScore ?? null;
        let winnerClubId: string | null = fixData.winnerClubId ?? null;
        let confirmedAt: string | null = fixData.resultConfirmedAt ?? null;

        const homeSubmission = submissions.find((sub: any) => sub.clubId === fixData.homeClubId);
        const awaySubmission = submissions.find((sub: any) => sub.clubId === fixData.awayClubId);
        if (homeSubmission && awaySubmission) {
          if (Number(homeSubmission.homeScore) === Number(awaySubmission.homeScore) && Number(homeSubmission.awayScore) === Number(awaySubmission.awayScore)) {
            newStatus = 'CONFIRMED';
            confirmedHome = Number(homeSubmission.homeScore);
            confirmedAway = Number(homeSubmission.awayScore);
            confirmedAt = payload.updatedAt || new Date().toISOString();
            winnerClubId = confirmedHome > confirmedAway ? fixData.homeClubId : confirmedAway > confirmedHome ? fixData.awayClubId : null;
          } else {
            newStatus = 'DISPUTED';
          }
        } else {
          newStatus = 'PENDING_CONFIRMATION';
        }

        tx.update(fixRef, { status: newStatus, homeScore: confirmedHome, awayScore: confirmedAway, winnerClubId, resultConfirmedAt: confirmedAt, updatedAt: new Date().toISOString() });
        return { fixData, newStatus, winnerClubId };
      });

      const { fixData, newStatus, winnerClubId } = replay;

      if (newStatus === 'CONFIRMED' && winnerClubId) {
        try {
          const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
          await advanceKnockoutWinnerFirestore(entityId);
        } catch (kErr) {
          console.warn('[KNOCKOUT_ADVANCE] Non-blocking advance error in sync replay:', kErr);
        }
      }

      if (newStatus === 'CONFIRMED' && fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixData.competitionId);
        } catch (sErr) {
          console.warn('[STANDINGS_UPDATE] Non-blocking standings update in sync replay:', sErr);
        }
      }

      const auditId = `audit_${item.mutationId}_submit`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({ id: auditId, actorUserId: payload.userId, action: 'SUBMIT_RESULT', entityType: 'fixture', entityId, notes: `Result submitted: ${payload.homeScore}-${payload.awayScore} (status: ${newStatus})`, createdAt: payload.createdAt || new Date().toISOString() }, { merge: true });

      const opponentClubId = payload.userClubId === fixData.homeClubId ? fixData.awayClubId : fixData.homeClubId;
      if (opponentClubId && fixData.seasonId) {
        try {
          const notifId = `notif_${item.mutationId}_opponent`;
          const opponentOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${fixData.seasonId}_${opponentClubId}`).get();
          if (opponentOcc.exists && opponentOcc.data()?.userId) {
            const oppUserId = opponentOcc.data()!.userId;
            await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifId).set({ id: notifId, userId: oppUserId, type: newStatus === 'CONFIRMED' ? 'RESULT_CONFIRMED' : 'RESULT_SUBMITTED', title: newStatus === 'CONFIRMED' ? 'Match Result Confirmed' : 'Opponent Submitted Score', message: `Match result: ${payload.homeScore}-${payload.awayScore}`, fixtureId: entityId, isRead: false, createdAt: new Date().toISOString() }, { merge: true });
          }
        } catch {}
      }

      if (newStatus === 'CONFIRMED') {
        try {
          const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
          await refreshChangedFixtureReadModel(entityId).catch(() => {});
          if (fixData.competitionId) {
            await invalidateFixtureReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
            await invalidateStandingsReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
          }
        } catch {}
      }
      break;
    }

'''
s = s[:start] + result_block + s[end:]
p.write_text(s)

# 3) app.ts protected worker route before DB init/auth
p = Path('src/server/app.ts')
s = p.read_text()
marker = '  // Ensure DB is initialized before executing route handlers\n'
route = r'''  // Durable mutation replay worker can run from Redis without startup Firestore reads.
  app.all('/api/internal/mutation-worker', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const actual = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret || ''}`);
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    if (!['GET', 'POST'].includes(req.method)) { res.sendStatus(405); return; }
    try {
      const result = await processPendingMutations();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.warn('[MUTATION_WORKER] Replay failed:', err?.message || err);
      res.status(503).json({ error: 'MUTATION_WORKER_UNAVAILABLE' });
    }
  });

'''
s = replace_once(s, marker, route + marker, 'mutation worker route')
p.write_text(s)

# 4) self-check unauthorized worker
p = Path('src/server/tests/deploymentSelfCheck.ts')
s = p.read_text()
marker = "    console.log('✅ PASS [CHECK 3.6]: POST /api/auth/telegram returned HTTP 400 JSON (Clean JSON error, NOT HTML)');\n"
insert = marker + r'''

    // 3.7 internal mutation worker must be CRON_SECRET protected before DB/auth middleware
    const mutationWorkerAnon = await testEndpoint('/api/internal/mutation-worker', { method: 'POST' });
    if (mutationWorkerAnon.status !== 401 || !mutationWorkerAnon.isJson || mutationWorkerAnon.json?.error !== 'UNAUTHORIZED') {
      throw new Error(`FAILED [CHECK 3.7]: POST /api/internal/mutation-worker expected JSON 401, got HTTP ${mutationWorkerAnon.status}`);
    }
    console.log('✅ PASS [CHECK 3.7]: mutation replay worker rejects unauthenticated requests with JSON 401');
'''
s = replace_once(s, marker, insert, 'deployment selfcheck worker')
p.write_text(s)

# 5) regression test
Path('src/server/tests/durableSyncWorkerRegressionTest.ts').write_text(r'''import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const outbox = readFileSync('src/server/outbox/redisOutbox.ts', 'utf8');
const queue = readFileSync('src/server/sync/mutationQueue.ts', 'utf8');
const app = readFileSync('src/server/app.ts', 'utf8');
const bundle = readFileSync('api/index.js', 'utf8');

assert.match(outbox, /claimDuePendingMutations/);
assert.match(outbox, /DEFAULT_CLAIM_LEASE_MS = 120_000/);
assert.match(outbox, /ZRANGEBYSCORE/);
assert.match(outbox, /status == 'SYNCING'/);
assert.match(outbox, /redis\.call\('ZADD'/);
assert.match(queue, /scheduleDurableMutationReplay/);
assert.match(queue, /claimDuePendingMutations\(15, 120_000\)/);
assert.match(queue, /db\.runTransaction/);
assert.match(queue, /OWNERSHIP_MISMATCH/);
assert.match(queue, /FIXTURE_ALREADY_CONFIRMED/);
assert.match(queue, /SUBMISSION_CONFLICT/);
assert.match(queue, /INVALID_FIXTURE_PARTICIPANT/);
assert.match(app, /\/api\/internal\/mutation-worker/);
assert.match(app, /timingSafeEqual/);
assert.match(app, /processPendingMutations/);
assert.match(bundle, /mutation-worker/);
console.log('durable sync worker regression: PASS');
''')

# 6) package script
p = Path('package.json')
pkg = json.loads(p.read_text())
pkg['scripts']['test:durable-sync-worker'] = 'node scripts/run-isolated-test.mjs src/server/tests/durableSyncWorkerRegressionTest.ts'
p.write_text(json.dumps(pkg, indent=2) + '\n')

print('durable sync safety patch applied')
