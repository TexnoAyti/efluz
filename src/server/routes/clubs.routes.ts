import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getClubByIdFirestore,
  claimClubAtomicFirestore,
  ClubConflictError,
  ClubNotFoundError,
} from '../firebase/firestoreStore';

export const clubsRouter = Router();

clubsRouter.get('/:id', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const club = await getClubByIdFirestore(req.params.id, seasonId);
    if (!club) {
      res.status(404).json({ error: 'Club not found' });
      return;
    }
    res.json({ club });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch club', message: err.message });
  }
});

clubsRouter.post('/:id/claim', requireAuth, async (req: Request, res: Response) => {
  const seasonId = (req.body.seasonId as string) || 'season-2026-27';
  const userId = req.user!.id;
  const clubId = req.params.id;

  try {
    const result = await claimClubAtomicFirestore(userId, clubId, seasonId);
    res.json({
      success: true,
      message: `Successfully claimed ${result.club.name}!`,
      club: result.club,
    });
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      res.status(409).json({
        error: err.code || 'CLUB_CONFLICT',
        message: err.message,
      });
      return;
    }
    if (err instanceof ClubNotFoundError) {
      res.status(404).json({
        error: 'CLUB_NOT_FOUND',
        message: err.message,
      });
      return;
    }
    console.error('Error claiming club in Firestore:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message || 'Failed to claim club.' });
  }
});
