import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { dbTransaction, queryAll, queryGet, queryRun } from '../db';
import { enqueueMutation } from '../sync/mutationQueue';
import { refreshMaterializedStandingsForCompetition } from '../db/sqliteStandings';

export const fixturesResilientRouter = Router();

const resultSubmissionSchema = z.object({
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  proofUrl: z.string().optional(),
});

function normalizeFixture(row: any) {
  return {
    id: row.id,
    seasonId: row.season_id,
    competitionId: row.competition_id,
    matchday: Number(row.matchday),
    roundName: row.round_name || undefined,
    homeClubId: row.home_club_id,
    awayClubId: row.away_club_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    homeScore: row.home_score ?? null,
    awayScore: row.away_score ?? null,
    winnerClubId: row.winner_club_id ?? null,
    resultConfirmedAt: row.result_confirmed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

fixturesResilientRouter.get('/:id', async (req: Request, res: Response) => {
  const fixtureId = req.params.id;
  const row = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
  if (!row) {
    res.status(404).json({ error: 'Fixture not found', code: 'NOT_FOUND', message: `Fixture '${fixtureId}' not found` });
    return;
  }
  res.json({ fixture: normalizeFixture(row), source: 'SQLITE' });
});

fixturesResilientRouter.post('/:id/result', requireAuth, async (req: Request, res: Response) => {
  const parsed = resultSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid result payload', code: 'BAD_REQUEST', details: parsed.error.flatten() });
    return;
  }

  const userId = req.user!.id;
  const fixtureId = req.params.id;
  const { homeScore, awayScore, proofUrl } = parsed.data;
  const now = new Date().toISOString();

  try {
    const result = dbTransaction(() => {
      const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
      if (!fixture) throw new Error(`Fixture '${fixtureId}' not found.`);

      if (fixture.status === 'CONFIRMED') {
        throw new Error('This fixture is already confirmed.');
      }
      if (['CANCELLED', 'POSTPONED'].includes(String(fixture.status))) {
        throw new Error(`This fixture cannot accept a result while status is ${fixture.status}.`);
      }

      const membership = queryGet<any>(
        `SELECT club_id FROM club_memberships
          WHERE season_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
        [fixture.season_id, userId]
      );
      if (!membership) throw new Error('You do not have an active club for this season.');

      const userClubId = membership.club_id;
      if (userClubId !== fixture.home_club_id && userClubId !== fixture.away_club_id) {
        throw new Error('You are not an owner of either club in this fixture.');
      }

      const existing = queryGet<any>(
        `SELECT * FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ? LIMIT 1`,
        [fixtureId, userId]
      );

      const submissionId = existing?.id || `sub_${fixtureId}_${userId}`;
      queryRun(
        `INSERT INTO result_submissions
          (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fixture_id, submitted_by_user_id) DO UPDATE SET
           home_score = excluded.home_score,
           away_score = excluded.away_score,
           proof_url = excluded.proof_url`,
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, existing?.created_at || now]
      );

      const submissions = queryAll<any>(
        `SELECT * FROM result_submissions WHERE fixture_id = ? ORDER BY created_at ASC`,
        [fixtureId]
      );

      let status = 'PENDING_CONFIRMATION';
      let winnerClubId: string | null = null;
      let confirmedAt: string | null = null;
      let confirmedHome: number | null = null;
      let confirmedAway: number | null = null;

      if (submissions.length >= 2) {
        const first = submissions[0];
        const second = submissions[1];
        if (Number(first.home_score) === Number(second.home_score) && Number(first.away_score) === Number(second.away_score)) {
          status = 'CONFIRMED';
          confirmedHome = Number(first.home_score);
          confirmedAway = Number(first.away_score);
          confirmedAt = now;
          if (confirmedHome > confirmedAway) winnerClubId = fixture.home_club_id;
          else if (confirmedAway > confirmedHome) winnerClubId = fixture.away_club_id;
        } else {
          status = 'DISPUTED';
        }
      }

      queryRun(
        `UPDATE fixtures
            SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?,
                result_confirmed_at = ?, updated_at = ?
          WHERE id = ?`,
        [status, confirmedHome, confirmedAway, winnerClubId, confirmedAt, now, fixtureId]
      );

      if (status === 'DISPUTED') {
        const disputeId = `dispute_${fixtureId}`;
        const homeSubmission = submissions.find((s) => s.club_id === fixture.home_club_id);
        const awaySubmission = submissions.find((s) => s.club_id === fixture.away_club_id);
        queryRun(
          `INSERT OR REPLACE INTO disputes
            (id, fixture_id, season_id, home_submission_id, away_submission_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'OPEN', COALESCE((SELECT created_at FROM disputes WHERE id = ?), ?))`,
          [disputeId, fixtureId, fixture.season_id, homeSubmission?.id || null, awaySubmission?.id || null, disputeId, now]
        );
      }

      const standings = status === 'CONFIRMED'
        ? refreshMaterializedStandingsForCompetition(fixture.competition_id)
        : undefined;

      enqueueMutation({
        mutationId: `result_${fixtureId}_${userId}`,
        entityType: 'RESULT_SUBMISSION',
        entityId: fixtureId,
        operation: 'SUBMIT_RESULT',
        payload: {
          fixtureId,
          userId,
          userClubId,
          homeScore,
          awayScore,
          proofUrl: proofUrl || null,
          submissionId,
          createdAt: existing?.created_at || now,
          updatedAt: now,
        },
        createdAt: now,
      });

      return {
        fixture: normalizeFixture(queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId])),
        status,
        standings,
      };
    });

    res.json({
      success: true,
      source: 'SQLITE',
      syncStatus: 'PENDING_FIRESTORE_SYNC',
      message:
        result.status === 'CONFIRMED'
          ? 'Match result confirmed!'
          : result.status === 'DISPUTED'
          ? 'Scores differ! Match has been marked DISPUTED and sent to admin.'
          : 'Score submitted! Awaiting opponent confirmation.',
      fixture: result.fixture,
      standings: result.standings,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not submit result', code: 'RESULT_SUBMISSION_FAILED' });
  }
});
