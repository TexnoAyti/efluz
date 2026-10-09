import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { paintTournamentImage, type TournamentImageModel } from '../../lib/tournamentImage';
import { SEED_CLUBS } from '../db/seed';

const require = createRequire(path.join(process.cwd(), 'package.json'));
let fontsReady = false;
const imageCache = new Map<string, Buffer>();

/** Use the same painter as the admin PNG download; never stretch badges. */
export async function renderTournamentImagePng(model: TournamentImageModel): Promise<Buffer> {
  if (!model.rows.length || model.rows.length > 40) throw Error('INVALID_TOURNAMENT_IMAGE_ROWS');
  if (!fontsReady) {
    const fonts = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
    for (const name of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
      if (!GlobalFonts.registerFromPath(path.join(fonts, 'ttf', name), 'Arial')) throw Error('TOURNAMENT_FONT_UNAVAILABLE');
    }
    fontsReady = true;
  }
  const crests = new Map<string, CanvasImageSource>();
  if (model.branding?.emblemUrl) {
    const filename = path.basename(model.branding.emblemUrl);
    if (!['premier-league.svg', 'la-liga.svg', 'serie-a.svg', 'bundesliga.svg', 'ligue-1.svg'].includes(filename)) throw Error('INVALID_COMPETITION_EMBLEM');
    const bytes = await readFile(path.join(process.cwd(), 'public', 'export-emblems', filename));
    crests.set('__competition__', await loadImage(bytes) as unknown as CanvasImageSource);
  }
  const ids = [...new Set(model.rows.flatMap(row => [row.id, row.awayId]).filter(Boolean))];
  await Promise.all(ids.map(async id => {
    const club = SEED_CLUBS.find(c => c.id === id);
    if (!club?.logoUrl) return;
    // Only static seed URLs are fetched; no user/model-controlled network targets.
    try {
      let bytes = imageCache.get(club.logoUrl);
      if (!bytes) {
        const response = await fetch(club.logoUrl, { signal: AbortSignal.timeout(4000), redirect: 'error' });
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 2_000_000) return;
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 2_000_000) return;
        imageCache.set(club.logoUrl, bytes);
      }
      crests.set(id!, await loadImage(bytes) as unknown as CanvasImageSource);
    } catch { /* The shared painter uses club initials if a crest is unavailable. */ }
  }));
  const canvas = createCanvas(1080, 1);
  paintTournamentImage(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, model, crests);
  return canvas.encode('png');
}
