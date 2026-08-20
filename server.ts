import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import app, { ensureDbReady } from './src/server/app';

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);

  // Initialize SQLite database and seed top 5 European leagues & competitions
  try {
    await ensureDbReady();
  } catch (err) {
    console.error('[BOOT] Fatal error initializing database:', err);
    process.exit(1);
  }

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚽ eFootball Tournament Platform server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();

