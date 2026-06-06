import express from 'express';
import { TraderService } from './trader-service.js';
import { log } from './logger.js';

export function run() {
  const app = express();
  const service = TraderService.from();
  const port = Number(process.env.PORT) || 3000;
  app.use(express.json());

  app.get('/api/status', (_req, res) => res.json(service.getStats()));
  app.get('/api/positions', (_req, res) => res.json(service.getPositions()));
  app.get('/api/history', (req, res) => { const limit = Number(req.query.limit) || 100; res.json(service.getHistory(limit)); });
  app.get('/api/equity', (_req, res) => res.json(service.getEquity()));
  app.get('/api/signals', (_req, res) => res.json(service.getSignals()));
  app.get('/api/watchlist', (_req, res) => res.json(service.getWatchlist()));

  app.get('/api/journal', (req, res) => { const limit = Number(req.query.limit) || 100; res.json(service.getJournal(limit)); });
  app.get('/api/journal/report', (_req, res) => res.json(service.getJournalReport()));

  app.get('/api/backtest/compare/:symbol', async (req, res) => {
    try {
      const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
      const walk = req.query.walk !== 'false';
      res.json(await service.runCompare(symbol, walk));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get('/api/backtest/:symbol', async (req, res) => {
    try {
      const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
      const walk = req.query.walk === 'true';
      res.json(await service.runBacktest(symbol, walk));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/health/deep', (_req, res) => { const h = service.getHealth(); res.status(h.ok ? 200 : 503).json(h); });
  app.get('/api/logs', (req, res) => {
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(service.getLogs(since, limit));
  });

  app.post('/api/control/pause', (_req, res) => res.json(service.pause()));
  app.post('/api/control/resume', (_req, res) => res.json(service.resume()));
  app.post('/api/control/panic', async (_req, res) => {
    try { res.json(await service.panic()); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/control/close/:symbol', async (req, res) => {
    try {
      const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
      const out = await service.closeSymbol(symbol);
      if (!out.closed) { res.status(404).json({ error: 'no open position for symbol' }); return; }
      res.json(out);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/account', async (_req, res) => {
    try { res.json(await service.getAccount()); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/connect', async (req, res) => {
    try {
      const { keyId, secret, paper } = req.body ?? {};
      if (!keyId || !secret) { res.status(400).json({ connected: false, paper: true, message: 'keyId and secret are required' }); return; }
      res.json(await service.connect(String(keyId), String(secret), paper !== false));
    } catch (e) { res.status(500).json({ connected: false, paper: true, message: (e as Error).message }); }
  });
  app.post('/api/disconnect', (_req, res) => res.json(service.disconnect()));
  app.get('/api/risk', (_req, res) => res.json(service.getRisk()));
  app.post('/api/risk', (req, res) => {
    try { res.json(service.updateRisk(req.body ?? {})); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get('/api/breaker', (_req, res) => res.json(service.getBreakerStatus()));
  app.post('/api/breaker/resume', async (_req, res) => {
    try { res.json(await service.resumeBreaker()); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get('/api/news', async (_req, res) => {
    const { getLatestNews } = await import('./news-engine.js');
    res.json(getLatestNews(20));
  });
  app.get('/api/scan-stats', (_req, res) => res.json(service.getScanStats()));
  app.get('/api/news', (req, res) => { const limit = Number(req.query.limit) || 20; res.json(service.getNews(limit)); });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const server = app.listen(port, () => { log.info(`🚀 trader-service ready on http://localhost:${port}`); });
  service.start().catch((e) => log.error(`[boot] ${(e as Error).message}`));
  return { port, stop: async () => { server.closeAllConnections(); server.close(); } };
}
