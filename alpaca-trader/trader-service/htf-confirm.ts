/**
 * Higher-Timeframe (1H) Confirmation — real multi-timeframe analysis.
 *
 * The old engine set `trend1h: 'pending'` and never actually confirmed the higher
 * timeframe inside the signal scoring (it computed a 1H trend separately in
 * daily-trend.ts but only as a soft risk multiplier AFTER the signal was built).
 *
 * This module computes the 1H trend from real 1H bars and reports whether the
 * 15m trade side is ALIGNED, OPPOSED, or NEUTRAL relative to it. The signal engine
 * feeds this into the Weighted Scoring System (HTF Alignment factor) and uses
 * "opposed" as a strong score penalty.
 */
import { ema, rsi, adx } from './indicators.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Bar } from './market-regime.js';

export type HtfResult = {
  trend: 'bullish' | 'bearish' | 'neutral';
  aligned: boolean;
  opposed: boolean;
  ema50: number;
  ema200: number;
  rsi: number;
  adx: number;
};

const cache = new Map<string, { bars: Bar[]; at: number }>();
const TTL_MS = 10 * 60_000;

async function get1hBars(symbol: string, client: AlpacaClient): Promise<Bar[]> {
  const c = cache.get(symbol);
  if (c && Date.now() - c.at < TTL_MS) return c.bars;
  const bars = (await client.getCryptoBars(symbol, '1Hour', 250)) as Bar[];
  cache.set(symbol, { bars, at: Date.now() });
  return bars;
}

/**
 * Confirm a 15m trade side against the 1H trend.
 * @param symbol Alpaca crypto symbol
 * @param side the proposed trade side
 * @param client AlpacaClient for 1H bars
 * @returns HtfResult with aligned/opposed flags
 */
export async function confirmHtf(
  symbol: string,
  side: 'LONG' | 'SHORT',
  client: AlpacaClient,
): Promise<HtfResult> {
  const neutral: HtfResult = {
    trend: 'neutral', aligned: false, opposed: false, ema50: 0, ema200: 0, rsi: 50, adx: 0,
  };
  try {
    const bars = await get1hBars(symbol, client);
    if (bars.length < 200) return neutral;
    const closes = bars.map((b) => b.close);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const rsiVal = rsi(closes);
    const adxVal = adx(bars, 14).adx;

    let trend: HtfResult['trend'] = 'neutral';
    if (e50 > e200 && adxVal > 20) trend = 'bullish';
    else if (e50 < e200 && adxVal > 20) trend = 'bearish';

    const aligned = (side === 'LONG' && trend === 'bullish') || (side === 'SHORT' && trend === 'bearish');
    const opposed = (side === 'LONG' && trend === 'bearish') || (side === 'SHORT' && trend === 'bullish');
    return { trend, aligned, opposed, ema50: e50, ema200: e200, rsi: rsiVal, adx: adxVal };
  } catch {
    return neutral;
  }
}
