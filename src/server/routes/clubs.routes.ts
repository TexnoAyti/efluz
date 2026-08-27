import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getClubByIdFirestore,
  getAvailableClubsFirestore,
  claimClubAtomicFirestore,
  ClubConflictError,
  ClubNotFoundError,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const clubsRouter = Router();

// 1. Available clubs endpoint (must be BEFORE /:id to prevent matching 'available' as an ID)
clubsRouter.get('/available', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const currentUserId = req.user?.id;
  try {
    const clubs = await getAvailableClubsFirestore(seasonId, currentUserId);
    res.json({ clubs });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/clubs/available');
  }
});

// 2. Club by ID endpoint
clubsRouter.get('/:id', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const currentUserId = req.user?.id;
  try {
    const club = await getClubByIdFirestore(req.params.id, seasonId, currentUserId);
    if (!club) {
      res.status(404).json({ error: 'Club not found', code: 'NOT_FOUND', message: `Club '${req.params.id}' not found.` });
      return;
    }
    res.json({ club });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/clubs/${req.params.id}`);
  }
});

// 3. Club claim endpoint
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
        code: err.code || 'CLUB_CONFLICT',
        message: err.message,
      });
      return;
    }
    if (err instanceof ClubNotFoundError) {
      res.status(404).json({
        error: 'CLUB_NOT_FOUND',
        code: 'CLUB_NOT_FOUND',
        message: err.message,
      });
      return;
    }
    handleFirestoreError(res, err, `POST /api/clubs/${clubId}/claim`);
  }
});
