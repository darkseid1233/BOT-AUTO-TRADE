/**
 * Trade Journal — SQLite persistence layer.
 *
 * Saves every closed trade to a local SQLite database so analytics survive
 * restarts. Falls back gracefully to in-memory-only mode when `better-sqlite3`
 * is not available (e.g. first boot before `npm install`).
 *
 * DB file location: process.env.JOURNAL_DB_PATH ?? './data/journal.db'
 * All operations are synchronous (better-sqlite3 is a sync API).
 */

import { log } from './logger.js';
import type { JournalEntry } from './trade-journal.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stmt = any;

let db: Db = null;
let insertStmt: Stmt = null;
let ready = false;

const DB_PATH = process.env.JOURNAL_DB_PATH ?? './data/journal.db';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS journal (
  id            TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  entry_price   REAL NOT NULL,
  close_price   REAL NOT NULL,
  qty           REAL NOT NULL,
  realized_pnl  REAL NOT NULL,
  pnl_percent   REAL NOT NULL,
  reason        TEXT NOT NULL,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER NOT NULL,
  hold_minutes  REAL NOT NULL,
  won           INTEGER NOT NULL,
  quality_score REAL NOT NULL,
  market_regime TEXT NOT NULL,
  btc_state     TEXT,
  trend_1h      TEXT,
  entry_reasons TEXT NOT NULL,
  quality_factors TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_closed ON journal(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_regime ON journal(market_regime);
`;

const INSERT_SQL = `
INSERT OR REPLACE INTO journal (
  id, symbol, side, entry_price, close_price, qty, realized_pnl, pnl_percent,
  reason, opened_at, closed_at, hold_minutes, won, quality_score, market_regime,
  btc_state, trend_1h, entry_reasons, quality_factors
) VALUES (
  @id, @symbol, @side, @entry_price, @close_price, @qty, @realized_pnl, @pnl_percent,
  @reason, @opened_at, @closed_at, @hold_minutes, @won, @quality_score, @market_regime,
  @btc_state, @trend_1h, @entry_reasons, @quality_factors
)`;

/** Attempt to open (or create) the SQLite database. Returns true on success. */
export function initDb(): boolean {
  if (ready) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(CREATE_TABLE);
    insertStmt = db.prepare(INSERT_SQL);
    ready = true;
    log.info(`[journal-db] SQLite opened at ${DB_PATH}`);
    return true;
  } catch (e) {
    log.warn(`[journal-db] SQLite unavailable, using in-memory only: ${(e as Error).message}`);
    return false;
  }
}

/** Persist a single journal entry. No-op if DB is not available. */
export function dbInsert(entry: JournalEntry): void {
  if (!ready || !insertStmt) return;
  try {
    insertStmt.run({
      id: entry.id, symbol: entry.symbol, side: entry.side,
      entry_price: entry.entryPrice, close_price: entry.closePrice, qty: entry.qty,
      realized_pnl: entry.realizedPnl, pnl_percent: entry.pnlPercent,
      reason: entry.reason, opened_at: entry.openedAt, closed_at: entry.closedAt,
      hold_minutes: entry.holdMinutes, won: entry.won ? 1 : 0,
      quality_score: entry.qualityScore, market_regime: entry.marketRegime,
      btc_state: entry.btcState ?? null, trend_1h: entry.trend1h ?? null,
      entry_reasons: JSON.stringify(entry.entryReasons),
      quality_factors: entry.qualityFactors ? JSON.stringify(entry.qualityFactors) : null,
    });
  } catch (e) {
    log.warn(`[journal-db] insert failed: ${(e as Error).message}`);
  }
}

/** Load all persisted entries from SQLite (called once on startup). */
export function dbLoadAll(): JournalEntry[] {
  if (!ready || !db) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = db.prepare('SELECT * FROM journal ORDER BY closed_at ASC').all();
    return rows.map((r) => ({
      id: r.id, symbol: r.symbol, side: r.side as 'LONG' | 'SHORT',
      entryPrice: r.entry_price, closePrice: r.close_price, qty: r.qty,
      realizedPnl: r.realized_pnl, pnlPercent: r.pnl_percent, reason: r.reason,
      openedAt: r.opened_at, closedAt: r.closed_at, holdMinutes: r.hold_minutes,
      won: r.won === 1, qualityScore: r.quality_score, marketRegime: r.market_regime,
      btcState: r.btc_state ?? undefined, trend1h: r.trend_1h ?? undefined,
      entryReasons: JSON.parse(r.entry_reasons ?? '[]'),
      qualityFactors: r.quality_factors ? JSON.parse(r.quality_factors) : undefined,
    }));
  } catch (e) {
    log.warn(`[journal-db] load failed: ${(e as Error).message}`);
    return [];
  }
}

/** @returns total number of entries stored in the DB. */
export function dbCount(): number {
  if (!ready || !db) return 0;
  try {
    return (db.prepare('SELECT COUNT(*) as n FROM journal').get() as { n: number }).n;
  } catch { return 0; }
}
