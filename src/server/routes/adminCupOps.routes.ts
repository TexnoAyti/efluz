import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import {
  adminApproveFixtureResultFirestore,
  reopenFixtureFirestore,
} from '../firebase/firestoreStore';
import {
  getDomesticCupBracketHealth,
  reconcileDomesticCupBracketSafe,
  reconcileDomesticCupSourceFixture,
  setDomesticCupRoundStateSafe,
  advanceDomesticCupRoundSafe,
} from '../tournament/domesticCupRoundOps';
import { DOMESTIC_CUPS, advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import { refreshChangedFixtureReadModel, invalidateFixtureReadModels } from '../readModel/readModelStore';

export const adminCupOpsRouter = Router();
adminCupOpsRouter.use(requireAdmin);

adminCupOpsRouter.get('/cups/:cupId/health', async (req: Request, res: Response) => {
  try {
    const health = await getDomesticCupBracketHealth(req.params.cupId);
    res.json(health);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/reconcile', async (req: Request, res: Response) => {
  try {
    const result = await reconcileDomesticCupBracketSafe(req.params.cupId, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
      reason: req.body?.reason || 'admin-bracket-health-reconcile',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/round', async (req: Request, res: Response) => {
  const roundNumber = Number(req.body?.roundNumber);
  const action = req.body?.action;
  if (!Number.isInteger(roundNumber) || !['OPEN', 'LOCK'].includes(action)) {
    res.status(400).json({ error: 'roundNumber and action OPEN|LOCK are required.' });
    return;
  }
  try {
    const result = await setDomesticCupRoundStateSafe(req.params.cupId, roundNumber, action, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/round/advance', async (req: Request, res: Response) => {
  try {
    const result = await advanceDomesticCupRoundSafe(req.params.cupId, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Shadow the generic admin approve endpoint so domestic cup confirmations auto-progress.
adminCupOpsRouter.post('/results/:fixtureId/approve', async (req: Request, res: Response, next) => {
  const { homeScore, awayScore, notes } = req.body || {};
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    next();
    return;
  }
  try {
    const result = await adminApproveFixtureResultFirestore(req.user!.id, req.params.fixtureId, homeScore, awayScore, notes);
    const fixture = (result as any)?.fixture;
    const competitionId = fixture?.competitionId || '';
    if (competitionId && DOMESTIC_CUPS[competitionId] && fixture?.status === 'CONFIRMED') {
      await advanceDomesticCupWinnerSafe(req.params.fixtureId, {
        adminUserId: req.user!.id,
        adminUsername: req.user?.username || 'admin',
      }).catch(async () => {
        await reconcileDomesticCupSourceFixture(req.params.fixtureId, {
          actorUserId: req.user!.id,
          actorUsername: req.user?.username || 'admin',
          reason: 'admin-result-approved',
        });
      });
    }
    await refreshChangedFixtureReadModel(req.params.fixtureId)
      .catch(() => invalidateFixtureReadModels(competitionId, fixture?.seasonId || 'season-2026-27'))
      .catch(() => {});
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${req.params.fixtureId}/approve`);
  }
});

// Shadow reopen/reject so a previously advanced cup winner is removed from its source-bound slot.
adminCupOpsRouter.post('/fixtures/:id/reopen', async (req: Request, res: Response) => {
  const fixtureId = req.params.id;
  try {
    const result = await reopenFixtureFirestore(req.user!.id, fixtureId, req.body?.notes);
    await reconcileDomesticCupSourceFixture(fixtureId, {
      actorUserId: req.user!.id,
      actorUsername: req.user?.username || 'admin',
      reason: 'fixture-reopened',
    }).catch(() => {});
    res.json({ success: true, message: 'Fixture has been reopened for submissions.', result });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/reopen`);
  }
});

adminCupOpsRouter.post('/results/:fixtureId/reject', async (req: Request, res: Response) => {
  const fixtureId = req.params.fixtureId;
  try {
    const result = await reopenFixtureFirestore(
      req.user!.id,
      fixtureId,
      req.body?.notes || 'Rejected by tournament administrator'
    );
    await reconcileDomesticCupSourceFixture(fixtureId, {
      actorUserId: req.user!.id,
      actorUsername: req.user?.username || 'admin',
      reason: 'admin-result-rejected',
    }).catch(() => {});
    res.json({ success: true, message: 'Pending result rejected and match reopened for re-submission.', result });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/reject`);
  }
});
