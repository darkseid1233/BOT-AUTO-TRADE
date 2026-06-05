/**
 * Daily / 4H Trend Filter — avoids entries against the major trend.
 *
 * Problem: bot can SHORT on 15m when the 4H/Daily trend is bullish → loses.
 * Solution: EMA50 vs EMA200 on the 1H timeframe (Alpaca "1Hour") as a proxy
 * for the 4H trend, plus RSI as supplemental filter.
 *
 * Rules:
 *  LONG  allowed when 1H trend is bullish or neutral
 *  SHORT allowed when 1H trend is bearish or neutral
 *  Going against the major trend → riskMultiplier 0.7 (not a hard block)
 *
 * Cache: 15 minutes per symbol (1H candles change slowly).
 * Fallback: returns NEUTRAL (no block) when the API is down.
 */
import { ema, rsi, adx } from './indicators.js';
import type { AlpacaClient } from './alpaca-client.js';
import { log } from './logger.js';

export type DailyTrendResult = {
  symbol: string;
  trend1h: 'bullish' | 'bearish' | 'neutral';
  ema50_1h: number;
  ema200_1h: number;
  rsi_1h: number;
  adx_1h: number;
  blockLong: boolean;
  blockShort: boolean;
  riskMultiplier: number;
  reason: string;
};

const cache = new Map<string, { data: DailyTrendResult; at: number }>();
const TTL_MS = 15 * 60_000;

/** Singleton Alpaca client reference set at startup. */
let alpacaClient: AlpacaClient | null = null;

/**
 * Register the Alpaca client so daily-trend can fetch 1H bars.
 * Call this once from bot.ts / trader-service.ts at startup.
 * @param client the shared AlpacaClient instance
 */
export function setDailyTrendClient(client: AlpacaClient): void {
  alpacaClient = client;
}

/**
 * Check whether a trade direction aligns with the 1H trend.
 * @param symbol Alpaca crypto symbol (e.g. "BTC/USD")
 * @param side trade direction to evaluate
 * @returns DailyTrendResult with block flags and risk multiplier
 */
export async function getDailyTrend(
  symbol: string,
  side?: 'LONG' | 'SHORT',
): Promise<DailyTrendResult> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) {
    const d = cached.data;
    return applyBlock(d, side);
  }

  const neutral: DailyTrendResult = {
    symbol,
    trend1h: 'neutral',
    ema50_1h: 0,
    ema200_1h: 0,
    rsi_1h: 50,
    adx_1h: 0,
    blockLong: false,
    blockShort: false,
    riskMultiplier: 1.0,
    reason: '1H trend: NEUTRAL (API fallback)',
  };

  if (!alpacaClient) return neutral;

  try {
    const bars = await alpacaClient.getCryptoBars(symbol, '1Hour', 250);
    if (bars.length < 50) return neutral;

    const closes = bars.map((b) => b.close);
    const candles = bars.map((b) => ({ high: b.high, low: b.low, close: b.close }));

    const e50  = ema(closes, 50);
    const e200 = ema(closes, Math.min(200, closes.length));
    const rsiVal = rsi(closes);
    const adxData = adx(candles, 14);

    let trend1h: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (e50 > e200 && adxData.adx > 18) trend1h = 'bullish';
    else if (e50 < e200 && adxData.adx > 18) trend1h = 'bearish';

    const result: DailyTrendResult = {
      symbol,
      trend1h,
      ema50_1h: e50,
      ema200_1h: e200,
      rsi_1h: rsiVal,
      adx_1h: adxData.adx,
      blockLong: false,
      blockShort: false,
      riskMultiplier: 1.0,
      reason: `1H trend: ${trend1h.toUpperCase()} (EMA50=${e50.toFixed(2)} EMA200=${e200.toFixed(2)} ADX=${adxData.adx.toFixed(1)})`,
    };

    cache.set(symbol, { data: result, at: Date.now() });
    return applyBlock(result, side);
  } catch (e) {
    log.debug(`[daily-trend] ${symbol} failed: ${(e as Error).message}`);
    return neutral;
  }
}

/** Apply block/risk logic for a specific trade side. */
function applyBlock(
  d: DailyTrendResult,
  side?: 'LONG' | 'SHORT',
): DailyTrendResult {
  let blockLong = false;
  let blockShort = false;
  let riskMultiplier = 1.0;
  let reason = d.reason;

  if (d.trend1h === 'bearish' && side === 'LONG') {
    riskMultiplier = 0.7;
    reason += ' — LONG against 1H bear trend (risk ×0.7)';
  } else if (d.trend1h === 'bullish' && side === 'SHORT') {
    riskMultiplier = 0.7;
    reason += ' — SHORT against 1H bull trend (risk ×0.7)';
  }

  return { ...d, blockLong, blockShort, riskMultiplier, reason };
}
