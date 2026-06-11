/**
 * Correlation Filter — world-class portfolio risk management.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM (why most retail bots blow up)
 * ─────────────────────────────────────────────────────────────────────────────
 * BTC, ETH, SOL, LINK, AVAX, DOGE are 80-95% correlated in a trending market.
 * Opening LONG on all 6 simultaneously is NOT diversification — it is 6x leverage
 * on a single crypto market direction. When BTC dumps 8%, ALL of them dump and
 * ALL stops get hit at once. The bot's daily loss limit fires, trading halts,
 * and the account is deeply in drawdown from what looked like "6 independent trades."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SOLUTION (Freqtrade / Nautilus Trader approach)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. GROUP symbols by correlation cluster (BTC-family vs stablecoin-adjacent, etc.)
 * 2. LIMIT how many positions can be open in the same direction within a cluster
 * 3. RANK pending signals by quality and prefer the HIGHEST quality one when the
 *    cluster is full — so only the best setup gets a slot
 * 4. SCALE DOWN position size when adding a correlated position (portfolio heat)
 *
 * Correlation groups are static (crypto market structure changes slowly) but
 * override-able via CORRELATION_GROUPS env var for live tuning.
 */

import { log } from './logger.js';
import type { OpenPosition } from './types.js';

/**
 * Static correlation cluster definitions.
 * All assets in the same cluster are treated as correlated.
 * Symbols NOT listed fall into the implicit 'other' cluster.
 */
const DEFAULT_CLUSTERS: Record<string, string[]> = {
  btcFamily:    ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD'],
  altFamily:    ['DOGE/USD', 'LTC/USD', 'UNI/USD'],
};

/** Maximum concurrent SAME-DIRECTION positions per cluster (env-overridable). */
const MAX_PER_CLUSTER = Number(process.env.MAX_PER_CLUSTER ?? '2');

/**
 * Portfolio heat multiplier — when adding a 2nd position in the same cluster,
 * scale its size by this factor to reduce correlated risk. 0.7 = 30% smaller.
 * Env-overridable via CORR_HEAT_MULT.
 */
const HEAT_MULT = Math.min(1, Math.max(0.1, Number(process.env.CORR_HEAT_MULT ?? '0.7')));

function getClusters(): Record<string, string[]> {
  try {
    const raw = process.env.CORRELATION_GROUPS;
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
  } catch { /* use default */ }
  return DEFAULT_CLUSTERS;
}

/**
 * Find which cluster a symbol belongs to.
 * @param symbol e.g. "ETH/USD"
 * @returns cluster name or "other"
 */
export function clusterOf(symbol: string): string {
  const clusters = getClusters();
  for (const [name, members] of Object.entries(clusters)) {
    if (members.includes(symbol)) return name;
  }
  return 'other';
}

/**
 * Correlation-aware position sizing multiplier.
 *
 * Called before opening a new position. Returns a multiplier [0, 1]:
 *  - 1.0  → cluster slot is free, full size
 *  - 0.7  → one same-direction position already open in this cluster (heat reduction)
 *  - 0.0  → cluster is full (MAX_PER_CLUSTER same-direction positions open), BLOCK
 *
 * @param symbol the candidate symbol
 * @param side the candidate direction ("LONG" | "SHORT")
 * @param openPositions all currently open positions
 * @returns { allowed: boolean, mult: number, reason: string }
 */
export function correlationCheck(
  symbol: string,
  side: string,
  openPositions: OpenPosition[],
): { allowed: boolean; mult: number; reason: string } {
  const cluster = clusterOf(symbol);

  // "other" cluster has no correlation restriction.
  if (cluster === 'other') return { allowed: true, mult: 1.0, reason: 'unclustered' };

  const clusters = getClusters();
  const clusterMembers = clusters[cluster] ?? [];

  // Count how many open positions are in the same cluster AND same direction.
  const sameDirectionOpen = openPositions.filter(
    (p) => clusterMembers.includes(p.symbol) && p.side === side && p.symbol !== symbol,
  );

  if (sameDirectionOpen.length === 0) {
    return { allowed: true, mult: 1.0, reason: `cluster "${cluster}" slot 1/${MAX_PER_CLUSTER}` };
  }

  if (sameDirectionOpen.length >= MAX_PER_CLUSTER) {
    const symbols = sameDirectionOpen.map((p) => p.symbol).join(', ');
    log.info(
      `[corr] ${symbol} ${side} BLOCKED — cluster "${cluster}" full ` +
      `(${sameDirectionOpen.length}/${MAX_PER_CLUSTER} open: ${symbols})`,
    );
    return {
      allowed: false,
      mult: 0,
      reason: `cluster "${cluster}" full (${sameDirectionOpen.length}/${MAX_PER_CLUSTER})`,
    };
  }

  // Partial slot: allowed but with heat reduction.
  const symbols = sameDirectionOpen.map((p) => p.symbol).join(', ');
  log.info(
    `[corr] ${symbol} ${side} — cluster "${cluster}" slot ` +
    `${sameDirectionOpen.length + 1}/${MAX_PER_CLUSTER} → sizing ×${HEAT_MULT} (correlated: ${symbols})`,
  );
  return {
    allowed: true,
    mult: HEAT_MULT,
    reason: `cluster "${cluster}" heat ×${HEAT_MULT}`,
  };
}
