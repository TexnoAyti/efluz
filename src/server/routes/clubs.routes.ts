import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { getClubById, claimClubAtomic, ClubConflictError, ClubNotFoundError } from '../services/clubService';

export const clubsRouter = Router();

clubsRouter.get('/:id', (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const club = getClubById(req.params.id, seasonId);
  if (!club) {
    res.status(404).json({ error: 'Club not found' });
    return;
  }
  res.json({ club });
});

clubsRouter.post('/:id/claim', requireAuth, (req: Request, res: Response) => {
  const seasonId = (req.body.seasonId as string) || 'season-2026-27';
  const userId = req.user!.id;
  const clubId = req.params.id;

  try {
    const result = claimClubAtomic(userId, clubId, seasonId);
    res.json({
      success: true,
      message: `Successfully claimed ${result.club.name}!`,
      club: result.club,
    });
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      res.status(409).json({
        error: 'Conflict',
        message: err.message,
      });
      return;
    }
    if (err instanceof ClubNotFoundError) {
      res.status(404).json({
        error: 'Not Found',
        message: err.message,
      });
      return;
    }
    console.error('Error claiming club:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to claim club.' });
  }
});
