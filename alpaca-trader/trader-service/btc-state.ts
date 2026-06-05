/**
 * BTC Market State Analysis — the macro filter for the whole watchlist.
 *
 * Crypto is highly correlated to BTC. Taking a LONG on an altcoin while BTC is in
 * a strong bearish trend is a low-probability fade. This module classifies BTC's
 * state once per scan (cached) and exposes:
 *   - direction:  bullish | bearish | neutral
 *   - strength:   how strong (ADX + RSI extremes) → used to HARD-BLOCK vs SCALE-DOWN
 *
 * Used two ways downstream:
 *   1. HARD gate  — strong opposing BTC trend blocks the trade entirely.
 *   2. SOFT score — the BTC Correlation factor of the Weighted Scoring System.
 */
import { ema, rsi, adx } from './indicators.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Bar } from './market-regime.js';

export type BtcState = {
  direction: 'bullish' | 'bearish' | 'neutral';
  /** 'strong' triggers hard blocks; 'moderate' only scales size / score. */
  strength: 'strong' | 'moderate' | 'none';
  ema50: number;
  ema200: number;
  rsi: number;
  adx: number;
  label: string;
};

let cache: { state: BtcState; at: number } | null = null;
const TTL_MS = 5 * 60_000;

const NEUTRAL: BtcState = {
  direction: 'neutral', strength: 'none', ema50: 0, ema200: 0, rsi: 50, adx: 0,
  label: 'BTC NEUTRAL',
};

/**
 * Analyze BTC's macro state on the 1H timeframe (cached 5 min).
 * @param client AlpacaClient used to fetch BTC 1H bars
 * @returns BtcState classification
 */
export async function analyzeBtcState(client: AlpacaClient): Promise<BtcState> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.state;
  try {
    const bars = (await client.getCryptoBars('BTC/USD', '1Hour', 250)) as Bar[];
    if (bars.length < 200) return NEUTRAL;
    const closes = bars.map((b) => b.close);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const rsiVal = rsi(closes);
    const adxVal = adx(bars, 14).adx;

    let direction: BtcState['direction'] = 'neutral';
    let strength: BtcState['strength'] = 'none';

    if (e50 > e200 && adxVal > 20 && rsiVal > 50) {
      direction = 'bullish';
      strength = adxVal > 30 && rsiVal > 60 ? 'strong' : 'moderate';
    } else if (e50 < e200 && adxVal > 20 && rsiVal < 50) {
      direction = 'bearish';
      strength = adxVal > 30 && rsiVal < 40 ? 'strong' : 'moderate';
    }

    const state: BtcState = {
      direction, strength, ema50: e50, ema200: e200, rsi: rsiVal, adx: adxVal,
      label: `BTC ${direction.toUpperCase()} (${strength}, ADX ${adxVal.toFixed(0)}, RSI ${rsiVal.toFixed(0)})`,
    };
    cache = { state, at: Date.now() };
    return state;
  } catch {
    return NEUTRAL;
  }
}

/** Force-refresh on next call (e.g. after a long idle period). */
export function invalidateBtcState(): void {
  cache = null;
}
