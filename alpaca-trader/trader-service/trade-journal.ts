/**
 * Trade Journal — complete per-trade record + analytics.
 *
 * Inspired by bcj2023's gate-stats.ts (entry-reason analytics) but expanded into a
 * full journal: every closed trade is stored with its Signal Quality Score, regime,
 * the 7 quality factors, entry reasons and exit reason. Analytics then break down
 * performance BY regime, BY quality bucket, and BY each scoring factor — so you can
 * see which factor actually predicts winners and re-tune the weights in config.
 *
 * In-memory ring buffer (no DB dependency). Survives within the process lifetime.
 */

export type JournalEntry = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  closePrice: number;
  qty: number;
  realizedPnl: number;
  pnlPercent: number;
  reason: string;                 // TP / SL / TRAILING / MANUAL / PANIC
  openedAt: number;
  closedAt: number;
  holdMinutes: number;
  won: boolean;
  // ── Signal context captured at entry ──
  qualityScore: number;
  marketRegime: string;
  btcState?: string;
  trend1h?: string;
  entryReasons: string[];
  qualityFactors?: Record<string, number>;
};

export type FactorCorrelation = {
  factor: string;
  /** Avg factor value among winners. */
  avgWin: number;
  /** Avg factor value among losers. */
  avgLoss: number;
  /** avgWin - avgLoss — positive means the factor predicts winners. */
  edge: number;
};

export type JournalReport = {
  totalTrades: number;
  byRegime: Record<string, { trades: number; wins: number; winRate: number; avgPnlPct: number }>;
  byQualityBucket: Record<string, { trades: number; wins: number; winRate: number; avgPnlPct: number }>;
  factorEdge: FactorCorrelation[];
  bestRegime: string | null;
  worstRegime: string | null;
};

const MAX_ENTRIES = 1000;
const entries: JournalEntry[] = [];

/** Record a closed trade into the journal. */
export function recordTrade(entry: JournalEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** @returns recent journal entries, newest first. */
export function getJournal(limit = 100): JournalEntry[] {
  return entries.slice(-limit).reverse();
}

/** Reset the journal (testing/debug). */
export function resetJournal(): void {
  entries.length = 0;
}

function bucketFor(q: number): string {
  if (q >= 90) return '90-100';
  if (q >= 80) return '80-89';
  if (q >= 70) return '70-79';
  return '<70';
}

/** Compute the full journal analytics report. */
export function computeJournalReport(): JournalReport {
  if (entries.length === 0) {
    return { totalTrades: 0, byRegime: {}, byQualityBucket: {}, factorEdge: [], bestRegime: null, worstRegime: null };
  }

  const byRegime: JournalReport['byRegime'] = {};
  const byQualityBucket: JournalReport['byQualityBucket'] = {};

  for (const e of entries) {
    const r = (byRegime[e.marketRegime] ??= { trades: 0, wins: 0, winRate: 0, avgPnlPct: 0 });
    r.trades++; if (e.won) r.wins++; r.avgPnlPct += e.pnlPercent;

    const bk = bucketFor(e.qualityScore);
    const b = (byQualityBucket[bk] ??= { trades: 0, wins: 0, winRate: 0, avgPnlPct: 0 });
    b.trades++; if (e.won) b.wins++; b.avgPnlPct += e.pnlPercent;
  }
  for (const r of Object.values(byRegime)) { r.winRate = (r.wins / r.trades) * 100; r.avgPnlPct /= r.trades; }
  for (const b of Object.values(byQualityBucket)) { b.winRate = (b.wins / b.trades) * 100; b.avgPnlPct /= b.trades; }

  // Factor edge — which scoring factors separate winners from losers.
  const winners = entries.filter((e) => e.won && e.qualityFactors);
  const losers = entries.filter((e) => !e.won && e.qualityFactors);
  const factorNames = new Set<string>();
  for (const e of entries) if (e.qualityFactors) Object.keys(e.qualityFactors).forEach((k) => factorNames.add(k));

  const avg = (arr: JournalEntry[], f: string) =>
    arr.length ? arr.reduce((s, e) => s + (e.qualityFactors?.[f] ?? 0), 0) / arr.length : 0;

  const factorEdge: FactorCorrelation[] = Array.from(factorNames).map((factor) => {
    const avgWin = avg(winners, factor);
    const avgLoss = avg(losers, factor);
    return { factor, avgWin, avgLoss, edge: avgWin - avgLoss };
  }).sort((a, b) => b.edge - a.edge);

  const regimesRanked = Object.entries(byRegime)
    .filter(([, v]) => v.trades >= 3)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  return {
    totalTrades: entries.length,
    byRegime, byQualityBucket, factorEdge,
    bestRegime: regimesRanked[0]?.[0] ?? null,
    worstRegime: regimesRanked[regimesRanked.length - 1]?.[0] ?? null,
  };
}
