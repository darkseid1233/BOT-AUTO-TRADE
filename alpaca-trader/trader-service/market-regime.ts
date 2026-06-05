/**
 * Market Regime Detection — TRENDING_BULL / TRENDING_BEAR / RANGING / HIGH_VOL.
 *
 * Why this matters (vs the old code):
 *   The old engine had a `classifyRegime` but still scored RSI/Bollinger/StochRSI
 *   as CONTRARIAN signals regardless of regime — i.e. it bought oversold RSI in a
 *   downtrend. This module makes regime the FIRST-CLASS gate: the regime decides
 *   the ONLY allowed direction. LONG is permitted ONLY in TRENDING_BULL, SHORT
 *   ONLY in TRENDING_BEAR. RANGING and HIGH_VOL produce NO trades.
 *
 * Decision is a confluence of three orthogonal measures (no single point of failure):
 *   1. ADX            — trend STRENGTH (is there a trend at all?)
 *   2. EMA50/EMA200   — trend DIRECTION + a minimum spread (avoids whipsaw on a cross)
 *   3. Choppiness IDX — independent ranging detector (reacts faster than ADX)
 *   + ATR ratio       — EXTREME volatility veto (news / black-swan candles)
 */
import { ema, rsi, adx, sma } from './indicators.js';
import { choppinessIndex } from './choppiness-index.js';
import type { StrategyConfig } from './strategy-config.js';

export type MarketRegime = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'HIGH_VOL';

export type Bar = { open: number; high: number; low: number; close: number; volume: number };

export type RegimeResult = {
  regime: MarketRegime;
  /** The ONLY trade side this regime allows (NEUTRAL for RANGING/HIGH_VOL). */
  allowedSide: 'LONG' | 'SHORT' | 'NEUTRAL';
  adx: number;
  ema50: number;
  ema200: number;
  emaSpreadPct: number;
  chop: number;
  rsi: number;
  /** ATR / ATR-SMA20 — volatility ratio. */
  volRatio: number;
  reason: string;
};

/** ATR ratio = current ATR vs its 20-period average. > extremeVolRatio = EXTREME. */
function atrRatio(candles: Bar[], period = 14, lookback = 20): number {
  if (candles.length < period + lookback + 1) return 1;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }
  // Wilder ATR series
  const atrs: number[] = [];
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrs.push(val);
  for (let i = period; i < trs.length; i++) {
    val = (val * (period - 1) + trs[i]) / period;
    atrs.push(val);
  }
  if (atrs.length < 2) return 1;
  const current = atrs[atrs.length - 1];
  const avg = sma(atrs, Math.min(lookback, atrs.length));
  return avg > 0 ? current / avg : 1;
}

/**
 * Classify the market regime for the 15m timeframe.
 * @param candles 15m OHLC bars (oldest-first)
 * @param cfg strategy config (thresholds)
 * @returns regime + the single allowed trade side
 */
export function detectRegime(candles: Bar[], cfg: StrategyConfig): RegimeResult {
  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, Math.min(200, closes.length));
  const adxVal = adx(candles, 14).adx;
  const rsiVal = rsi(closes);
  const chop = choppinessIndex(candles, 14).value;
  const volRatio = atrRatio(candles);
  const emaSpreadPct = ema200 > 0 ? (Math.abs(ema50 - ema200) / ema200) * 100 : 0;

  const base = { adx: adxVal, ema50, ema200, emaSpreadPct, chop, rsi: rsiVal, volRatio };

  // 1) EXTREME volatility veto — never trade a black-swan candle.
  if (volRatio >= cfg.extremeVolRatio) {
    return { ...base, regime: 'HIGH_VOL', allowedSide: 'NEUTRAL',
      reason: `HIGH_VOL (ATR ratio ${volRatio.toFixed(2)}x ≥ ${cfg.extremeVolRatio}x)` };
  }

  // 2) No trend strength OR ambiguous EMA spread OR choppiness → RANGING.
  const weakTrend = adxVal < cfg.adxTrendThreshold;
  const ambiguousEma = emaSpreadPct < cfg.emaTrendSpreadPct;
  const choppy = chop > cfg.chopRangingThreshold;
  if (weakTrend || ambiguousEma || choppy) {
    const why = weakTrend
      ? `ADX ${adxVal.toFixed(1)} < ${cfg.adxTrendThreshold}`
      : ambiguousEma
        ? `EMA50≈EMA200 (spread ${emaSpreadPct.toFixed(2)}% < ${cfg.emaTrendSpreadPct}%)`
        : `CHOP ${chop.toFixed(1)} > ${cfg.chopRangingThreshold}`;
    return { ...base, regime: 'RANGING', allowedSide: 'NEUTRAL', reason: `RANGING (${why})` };
  }

  // 3) Clear, strong trend → direction from EMA stack.
  if (ema50 > ema200) {
    return { ...base, regime: 'TRENDING_BULL', allowedSide: 'LONG',
      reason: `TRENDING_BULL (ADX ${adxVal.toFixed(1)}, EMA spread ${emaSpreadPct.toFixed(2)}%)` };
  }
  return { ...base, regime: 'TRENDING_BEAR', allowedSide: 'SHORT',
    reason: `TRENDING_BEAR (ADX ${adxVal.toFixed(1)}, EMA spread ${emaSpreadPct.toFixed(2)}%)` };
}
