import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getClubByIdFirestore,
  getAvailableClubsFirestore,
  claimClubAtomicFirestore,
  ClubConflictError,
  ClubNotFoundError,
} from '../firebase/firestoreStore';
import { SEED_CLUBS } from '../db/seed';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { verifyTelegramGroupMembership } from '../services/telegramBotService';

export const clubsRouter = Router();

// Helper to resolve canonical club from canonical id or numeric/external id
function resolveCanonicalClub(id: string) {
  if (!id) return null;
  const trimmed = id.trim();
  const normalized = trimmed.toLowerCase();

  // 1. Direct canonical id in seed
  let found = SEED_CLUBS.find((c) => c.id === trimmed || c.id.toLowerCase() === normalized);
  if (found) return found;

  // 2. club- prefix
  found = SEED_CLUBS.find((c) => c.id === `club-${normalized}` || c.id.toLowerCase() === `club-${normalized}`);
  if (found) return found;

  // 3. Logo URL filename match (/86.png, /t3.svg, 86, t3, 3)
  found = SEED_CLUBS.find((c) => {
    const url = c.logoUrl;
    if (url.endsWith(`/${normalized}.png`) || url.endsWith(`/${normalized}.svg`)) return true;
    if (url.endsWith(`/t${normalized}.svg`)) return true;
    const match = url.match(/\/([a-zA-Z0-9_-]+)\.(png|svg|webp|jpg)$/i);
    if (match && match[1].toLowerCase() === normalized) return true;
    return false;
  });
  if (found) return found;

  // 4. Shortname or Name match
  found = SEED_CLUBS.find(
    (c) => c.shortName.toLowerCase() === normalized || c.name.toLowerCase() === normalized
  );
  return found || null;
}

// In-memory image cache for fast asset serving
interface CachedImage {
  buffer: Buffer;
  contentType: string;
  expiry: number;
}
const imageCache = new Map<string, CachedImage>();

// Helper to generate dynamic fallback SVG badge
function generateFallbackSvgBadge(name: string, shortName?: string): string {
  const text = (shortName || name.slice(0, 3)).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
    </defs>
    <path d="M50 5 L85 20 L85 55 C85 75 50 95 50 95 C50 95 15 75 15 55 L15 20 Z" fill="url(#bgGrad)" stroke="#38bdf8" stroke-width="3"/>
    <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#f8fafc" text-anchor="middle" letter-spacing="1">${text}</text>
  </svg>`;
}

// Helper to wrap raster image (PNG, WebP, JPG) into an SVG container with embedded base64 data URI
function wrapRasterImageInSvg(buffer: Buffer, mimeType: string): Buffer {
  const base64Data = buffer.toString('base64');
  const cleanMime = mimeType.split(';')[0].trim() || 'image/png';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" preserveAspectRatio="xMidYMid meet">
  <image href="data:${cleanMime};base64,${base64Data}" width="256" height="256" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

async function fetchAndServeImage(imageUrl: string, res: Response, fallbackName = 'FC', fallbackShortName = 'FC') {
  const now = Date.now();
  const cached = imageCache.get(imageUrl);
  if (cached && cached.expiry > now) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(cached.buffer);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const rawContentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);

      let finalBuffer: Buffer;
      let finalContentType: string;

      const isSvg = rawContentType.includes('svg') || imageUrl.toLowerCase().endsWith('.svg');
      if (isSvg) {
        finalBuffer = rawBuffer;
        finalContentType = 'image/svg+xml; charset=utf-8';
      } else {
        finalBuffer = wrapRasterImageInSvg(rawBuffer, rawContentType);
        finalContentType = 'image/svg+xml; charset=utf-8';
      }

      // Cache for 7 days
      imageCache.set(imageUrl, {
        buffer: finalBuffer,
        contentType: finalContentType,
        expiry: now + 7 * 24 * 60 * 60 * 1000,
      });

      res.setHeader('Content-Type', finalContentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(finalBuffer);
      return;
    }
  } catch (e) {
    // Upstream fetch failed, proceed to fallback SVG
  }

  // Render SVG fallback
  const svg = generateFallbackSvgBadge(fallbackName, fallbackShortName);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(Buffer.from(svg, 'utf-8'));
}

// 0. Generic Crest Proxy endpoint (for any whitelisted club crest URL)
clubsRouter.get('/crest-proxy', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid image URL is required' });
    return;
  }
  await fetchAndServeImage(url, res);
});

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

// 2. Club Crest Asset Endpoint (serves reliable proxy/cache with dynamic SVG fallback)
clubsRouter.get('/:id/crest', async (req: Request, res: Response) => {
  const requestedId = req.params.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    // 1. Resolve canonical club from canonical id or numeric/external id
    const resolvedSeedClub = resolveCanonicalClub(requestedId);
    if (resolvedSeedClub?.logoUrl) {
      await fetchAndServeImage(
        resolvedSeedClub.logoUrl,
        res,
        resolvedSeedClub.name,
        resolvedSeedClub.shortName
      );
      return;
    }

    const canonicalId = resolvedSeedClub?.id || requestedId;

    // 2. Lookup club in Firestore with canonicalId first, then requestedId
    let club = await getClubByIdFirestore(canonicalId, seasonId);
    if (!club && canonicalId !== requestedId) {
      club = await getClubByIdFirestore(requestedId, seasonId);
    }

    // 3. Determine logoUrl from Firestore or resolved seed metadata
    const finalLogoUrl = club?.logoUrl || resolvedSeedClub?.logoUrl;
    const finalName = club?.name || resolvedSeedClub?.name || requestedId;
    const finalShortName = club?.shortName || resolvedSeedClub?.shortName;

    if (!finalLogoUrl) {
      const svg = generateFallbackSvgBadge(finalName, finalShortName);
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(Buffer.from(svg, 'utf-8'));
      return;
    }

    await fetchAndServeImage(finalLogoUrl, res, finalName, finalShortName);
  } catch (err) {
    const resolvedSeedClub = resolveCanonicalClub(requestedId);
    if (resolvedSeedClub?.logoUrl) {
      await fetchAndServeImage(resolvedSeedClub.logoUrl, res, resolvedSeedClub.name, resolvedSeedClub.shortName);
      return;
    }
    const svg = generateFallbackSvgBadge(requestedId);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(svg, 'utf-8'));
  }
});

// 3. Club by ID endpoint
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
  const telegramId = req.user!.telegramId;

  // Enforce Telegram group membership verification (@efleagueuz) ONLY when claiming
  if (telegramId) {
    const membership = await verifyTelegramGroupMembership(telegramId);
    if (!membership.isMember) {
      res.status(403).json({
        error: 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
        code: 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED',
        message: "Klub tanlash uchun avval @efleagueuz Telegram guruhiga a'zo bo'lishingiz lozim.",
        groupUsername: '@efleagueuz',
        groupUrl: 'https://t.me/efleagueuz',
      });
      return;
    }
  }

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
