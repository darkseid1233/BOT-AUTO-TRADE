/**
 * AlpacaBot — Railway standalone server
 *
 * Serves:
 *   /trader-service/api/*  →  backend REST API (Express)
 *   /*                      →  React dashboard static files
 *
 * Run:  node server.js
 * Env:  PORT (set by Railway), ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY
 */

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Dynamic import of compiled bot modules
const { TraderService } = await import('./dist/trader-service.js');
const { log } = await import('./dist/logger.js');

const app = express();
const port = Number(process.env.PORT) || 3000;
const service = TraderService.from();

// ── CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json());

// ── API routes under /trader-service/api/*
const api = express.Router();

api.get('/status', (_req, res) => res.json(service.getStats()));
api.get('/positions', (_req, res) => res.json(service.getPositions()));
api.get('/history', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json(service.getHistory(limit));
});
api.get('/equity', (_req, res) => res.json(service.getEquity()));
api.get('/signals', (_req, res) => res.json(service.getSignals()));
api.get('/watchlist', (_req, res) => res.json(service.getWatchlist()));
api.get('/health/deep', (_req, res) => {
  const h = service.getHealth();
  res.status(h.ok ? 200 : 503).json(h);
});
api.get('/logs', (req, res) => {
  const since = Number(req.query.since) || 0;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(service.getLogs(since, limit));
});
api.post('/control/pause', (_req, res) => res.json(service.pause()));
api.post('/control/resume', (_req, res) => res.json(service.resume()));
api.post('/control/panic', async (_req, res) => {
  try { res.json(await service.panic()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
api.post('/control/close/:symbol', async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
    const out = await service.closeSymbol(symbol);
    if (!out.closed) { res.status(404).json({ error: 'no open position' }); return; }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
api.get('/account', async (_req, res) => {
  try { res.json(await service.getAccount()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
api.post('/connect', async (req, res) => {
  try {
    const { keyId, secret, paper } = req.body ?? {};
    if (!keyId || !secret) {
      res.status(400).json({ connected: false, paper: true, message: keyId and secret required });
      return;
    }
    res.json(await service.connect(String(keyId), String(secret), paper !== false));
  } catch (e) { res.status(500).json({ connected: false, paper: true, message: e.message }); }
});
api.post('/disconnect', (_req, res) => res.json(service.disconnect()));
api.get('/risk', (_req, res) => res.json(service.getRisk()));
api.post('/risk', (req, res) => {
  try { res.json(service.updateRisk(req.body ?? {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
api.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/trader-service/api', api);

// ── Static React dashboard
const staticDir = join(__dirname, 'public');
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  // SPA fallback — Express 5 requires '/{*path}' instead of '*'
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(staticDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('<h1>AlpacaBot API running</h1><p>Dashboard not built.</p>'));
}

// ── Boot
const server = createServer(app);
server.listen(port, () => {
  log.info(`🚠 AlpacaBot server on http://localhost:${port}`);
});

service.start().catch((e) => log.error(`[boot] ${e.message}`));

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
