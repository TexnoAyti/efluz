import app from './app';

export default async function handler(req: any, res: any) {
  try {
    // Database initialization belongs to Express, after the authenticated worker route.
    
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
