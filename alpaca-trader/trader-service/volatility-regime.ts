/**
 * Volatility Regime Engine — classifies market volatility into 4 states.
 *
 * Uses ATR relative to its 20-period SMA as baseline:
 *  LOW     ATR < ATR_SMA20 × 0.7  → setup not mature, skip
 *  NORMAL  ATR 0.7x–1.5x          → ideal trading zone
 *  HIGH    ATR > ATR_SMA20 × 1.5  → reduce risk 50%, cap confidence
 *  EXTREME ATR > ATR_SMA20 × 2.5  → NO TRADE (news / black swan)
 */
import { sma, atr } from './indicators.js';

export type VolatilityState = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export type VolatilityRegime = {
  state: VolatilityState;
  atr: number;
  atrSma20: number;
  /** ATR / ATR_SMA20 */
  ratio: number;
  /** false = no trades */
  allowed: boolean;
  /** 1.0 normal, 0.5 high, 0 extreme */
  riskMultiplier: number;
  /** +1 NORMAL, -1 LOW, 0 otherwise */
  scoreAdjustment: number;
  /** null = no cap */
  scoreCap: number | null;
  reason: string;
};

const LOW_THRESHOLD     = 0.7;
const HIGH_THRESHOLD    = 1.5;
const EXTREME_THRESHOLD = 2.5;

/**
 * Calculate ATR series from raw OHLC arrays.
 * @param highs high prices
 * @param lows low prices
 * @param closes close prices
 * @param period ATR period (default 14)
 * @returns ATR value series
 */
export function calculateAtrSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  const atrs: number[] = [];
  if (trs.length < period) return atrs;
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrs.push(prev);
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    atrs.push(prev);
  }
  return atrs;
}

/**
 * Classify current volatility given OHLC arrays.
 * @param highs high prices (oldest first)
 * @param lows low prices (oldest first)
 * @param closes close prices (oldest first)
 * @param period ATR period (default 14)
 * @returns VolatilityRegime classification
 */
export function getVolatilityRegime(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): VolatilityRegime {
  const atrSeries = calculateAtrSeries(highs, lows, closes, period);

  if (atrSeries.length < 2) {
    return {
      state: 'NORMAL', atr: 0, atrSma20: 0, ratio: 1,
      allowed: true, riskMultiplier: 1.0, scoreAdjustment: 1, scoreCap: null,
      reason: 'Volatility: NORMAL (insufficient data)',
    };
  }

  const currentAtr = atrSeries[atrSeries.length - 1];
  const atrSma20 = sma(atrSeries, Math.min(20, atrSeries.length));
  const ratio = atrSma20 > 0 ? currentAtr / atrSma20 : 1;

  let state: VolatilityState;
  let allowed: boolean;
  let riskMultiplier: number;
  let scoreAdjustment: number;
  let scoreCap: number | null;
  let reason: string;

  if (ratio >= EXTREME_THRESHOLD) {
    state = 'EXTREME';
    allowed = false;
    riskMultiplier = 0;
    scoreAdjustment = 0;
    scoreCap = null;
    reason = `Volatility: EXTREME (ATR ratio ${ratio.toFixed(2)}x ≥ ${EXTREME_THRESHOLD}x) — NO TRADE`;
  } else if (ratio >= HIGH_THRESHOLD) {
    state = 'HIGH';
    allowed = true;
    riskMultiplier = 0.5;
    scoreAdjustment = 0;
    scoreCap = 10;
    reason = `Volatility: HIGH (ATR ratio ${ratio.toFixed(2)}x) — risk ×0.5`;
  } else if (ratio < LOW_THRESHOLD) {
    state = 'LOW';
    allowed = true;
    riskMultiplier = 1.0;
    scoreAdjustment = -1;
    scoreCap = null;
    reason = `Volatility: LOW (ATR ratio ${ratio.toFixed(2)}x < ${LOW_THRESHOLD}x) — setup not mature`;
  } else {
    state = 'NORMAL';
    allowed = true;
    riskMultiplier = 1.0;
    scoreAdjustment = 1;
    scoreCap = null;
    reason = `Volatility: NORMAL (ATR ratio ${ratio.toFixed(2)}x)`;
  }

  return { state, atr: currentAtr, atrSma20, ratio, allowed, riskMultiplier, scoreAdjustment, scoreCap, reason };
}
