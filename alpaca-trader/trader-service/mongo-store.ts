/**
 * MongoDB persistence layer — survives Railway redeploys.
 *
 * SQLite (journal-db.ts) persists to a LOCAL file, which Railway wipes on every
 * redeploy unless a volume is mounted. MongoDB stores state OUTSIDE the
 * container, so the trade journal AND the live bot state (balance, peak equity,
 * open positions, equity curve) all survive restarts and deploys.
 *
 * Activation: set MONGO_URL (Railway → add the MongoDB plugin, then reference
 * its connection string). When MONGO_URL is absent the whole module is a no-op
 * and the bot falls back to SQLite / in-memory exactly as before.
 *
 * The `mongodb` driver is imported dynamically so the app still boots when the
 * package isn't installed (graceful degradation, like journal-db.ts).
 */

import { log } from './logger.js';
import type { JournalEntry } from './trade-journal.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Collection = any;

const MONGO_URL = process.env.MONGO_URL ?? process.env.MONGODB_URI ?? '';
const DB_NAME = process.env.MONGO_DB_NAME ?? 'alpacabot';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
let journalCol: Collection = null;
let stateCol: Collection = null;
let ready = false;
let connecting: Promise<boolean> | null = null;

/** Persisted snapshot of the trader's live state (single document, id='current'). */
export type BotStateSnapshot = {
  balance: number;
  startingBalance: number;
  peakEquity: number;
  dayStartEquity: number;
  dayStartDay: number;
  paused: boolean;
  pausedReason: string;
  idSeq: number;
  totalCosts: number;
  recentOutcomes: boolean[];
  // Serialised maps/arrays (Mongo-safe).
  positions: unknown[];
  history: unknown[];
  equityCurve: unknown[];
  updatedAt: number;
};

/** True when a Mongo connection string is configured (feature enabled). */
export function mongoEnabled(): boolean {
  return Boolean(MONGO_URL);
}

/**
 * Lazily connect to MongoDB. Safe to call repeatedly — connects once.
 * @returns true when the connection (and collections) are ready
 */
export async function initMongo(): Promise<boolean> {
  if (ready) return true;
  if (!MONGO_URL) return false;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const { MongoClient } = await import('mongodb');
      client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const db = client.db(DB_NAME);
      journalCol = db.collection('journal');
      stateCol = db.collection('bot_state');
      await journalCol.createIndex({ closedAt: -1 });
      await journalCol.createIndex({ marketRegime: 1 });
      ready = true;
      log.info(`[mongo] connected — db "${DB_NAME}" (persistence ON)`);
      return true;
    } catch (e) {
      log.warn(`[mongo] connection failed, falling back to SQLite/in-memory: ${(e as Error).message}`);
      return false;
    }
  })();
  return connecting;
}

/**
 * Upsert a journal entry into MongoDB. No-op when Mongo is disabled.
 * @param entry the closed-trade journal entry
 */
export async function mongoInsertJournal(entry: JournalEntry): Promise<void> {
  if (!ready || !journalCol) return;
  try {
    await journalCol.updateOne({ id: entry.id }, { $set: entry }, { upsert: true });
  } catch (e) {
    log.warn(`[mongo] journal insert failed: ${(e as Error).message}`);
  }
}

/**
 * Load all journal entries from MongoDB (oldest first).
 * @returns persisted entries, or [] when disabled/unavailable
 */
export async function mongoLoadJournal(): Promise<JournalEntry[]> {
  if (!ready || !journalCol) return [];
  try {
    const rows = await journalCol.find({}, { projection: { _id: 0 } }).sort({ closedAt: 1 }).toArray();
    return rows as JournalEntry[];
  } catch (e) {
    log.warn(`[mongo] journal load failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Persist the trader's live state snapshot (single 'current' document).
 * @param snap the full state snapshot
 */
export async function mongoSaveState(snap: BotStateSnapshot): Promise<void> {
  if (!ready || !stateCol) return;
  try {
    await stateCol.updateOne({ _id: 'current' }, { $set: { ...snap, updatedAt: Date.now() } }, { upsert: true });
  } catch (e) {
    log.warn(`[mongo] state save failed: ${(e as Error).message}`);
  }
}

/**
 * Load the persisted trader state snapshot.
 * @returns the snapshot, or null when none exists / disabled
 */
export async function mongoLoadState(): Promise<BotStateSnapshot | null> {
  if (!ready || !stateCol) return null;
  try {
    const doc = await stateCol.findOne({ _id: 'current' });
    if (!doc) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = doc;
    return rest as BotStateSnapshot;
  } catch (e) {
    log.warn(`[mongo] state load failed: ${(e as Error).message}`);
    return null;
  }
}

/** Close the Mongo connection (graceful shutdown). */
export async function closeMongo(): Promise<void> {
  if (client) {
    try { await client.close(); } catch { /* ignore */ }
  }
}
