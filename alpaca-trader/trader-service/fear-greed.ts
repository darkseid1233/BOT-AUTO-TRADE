/**
 * Fear & Greed Index filter.
 *
 * Source: alternative.me/crypto/fear-and-greed-index (free, no key required).
 * Cached for 30 minutes (index updates once per hour).
 *
 * Trading rules:
 *  - Extreme Fear  (<  FG_EXTREME_FEAR,  default 20) → block LONGs (panic selling = liquidated longs)
 *  - Extreme Greed (>  FG_EXTREME_GREED, default 80) → block SHORTs (strong bull momentum)
 *  - Fear          (<  FG_FEAR,          default 35) → risk multiplier 0.75 for LONGs
 *  - Greed         (>  FG_GREED,         default 65) → risk multiplier 0.75 for SHORTs
 */
import { log } from './logger.js';

function readEnv(name: string, def: number): number {
  const v = process.env[name];
  if (!v || v.trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export type FearGreedData = {
  /** 0-100 (0 = extreme fear, 100 = extreme greed) */
  value: number;
  classification: string;
  timestamp: number;
  fetchedAt: number;
};

export type MarketSentiment = {
  fearGreed: FearGreedData | null;
  /** Block new LONG trades */
  blockLong: boolean;
  /** Block new SHORT trades */
  blockShort: boolean;
  /** Risk multiplier (0.5-1.0) */
  riskMultiplier: number;
  reason: string;
};

let cache: FearGreedData | null = null;
let cacheAt = 0;
const TTL_MS = 30 * 60_000;

/**
 * Fetch current Fear & Greed index value.
 * Returns null if the API is unavailable.
 */
export async function getFearGreed(): Promise<FearGreedData | null> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as {
      data: { value: string; value_classification: string; timestamp: string }[];
    };
    const d = json.data[0];
    cache = {
      value: parseInt(d.value, 10),
      classification: d.value_classification,
      timestamp: parseInt(d.timestamp, 10) * 1000,
      fetchedAt: Date.now(),
    };
    cacheAt = Date.now();
    log.debug(`[fear-greed] ${cache.value} — ${cache.classification}`);
    return cache;
  } catch (e) {
    log.debug(`[fear-greed] fetch failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Evaluate market sentiment and return block flags / risk multiplier.
 * SAFE: returns neutral (no block) when API is unavailable.
 * @param side optional trade direction to evaluate specifically
 */
export async function getMarketSentiment(
  side?: 'LONG' | 'SHORT',
): Promise<MarketSentiment> {
  const EXTREME_FEAR  = readEnv('FG_EXTREME_FEAR', 20);
  const EXTREME_GREED = readEnv('FG_EXTREME_GREED', 80);
  const FEAR_LEVEL    = readEnv('FG_FEAR', 35);
  const GREED_LEVEL   = readEnv('FG_GREED', 65);

  const fg = await getFearGreed();
  if (!fg) {
    return { fearGreed: null, blockLong: false, blockShort: false, riskMultiplier: 1.0, reason: 'Fear&Greed API unavailable — neutral' };
  }

  const v = fg.value;
  let blockLong = false;
  let blockShort = false;
  let riskMultiplier = 1.0;
  let reason = `Fear&Greed: ${v} (${fg.classification})`;

  if (v < EXTREME_FEAR) {
    blockLong = true;
    riskMultiplier = 0.5;
    reason += ` — Extreme Fear: LONGs blocked`;
  } else if (v > EXTREME_GREED) {
    blockShort = true;
    riskMultiplier = 0.5;
    reason += ` — Extreme Greed: SHORTs blocked`;
  } else if (v < FEAR_LEVEL) {
    riskMultiplier = side === 'LONG' ? 0.75 : 1.0;
    reason += ` — Fear: LONG risk ×0.75`;
  } else if (v > GREED_LEVEL) {
    riskMultiplier = side === 'SHORT' ? 0.75 : 1.0;
    reason += ` — Greed: SHORT risk ×0.75`;
  }

  return { fearGreed: fg, blockLong, blockShort, riskMultiplier, reason };
}
