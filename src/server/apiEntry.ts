import app, { ensureDbReady } from './app';
import { installFirestoreReadGuard } from './firebase/firestoreReadGuard';

installFirestoreReadGuard();

export default async function handler(req: any, res: any) {
  try {
    await ensureDbReady();
    
    // Normalize URL if Vercel strips /api or passes custom prefix
    if (req.url && !req.url.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }

    return app(req, res);
  } catch (err: any) {
    console.error('[VERCEL API ERROR]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Serverless execution failure', details: err.message }));
    }
  }
}
