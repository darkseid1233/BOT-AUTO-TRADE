/**
 * Choppiness Index — detects TRENDING vs RANGING markets independently of direction.
 * Formula (Kaufman 1995):
 *   CHOP = 100 × log10(SUM_ATR1(period) / (highestHigh - lowestLow)) / log10(period)
 *
 * Interpretation:
 *   < 38.2  → TRENDING strong (entries allowed)
 *   38.2–50 → TRENDING moderate
 *   50–61.8 → NEUTRAL / transition
 *   > 61.8  → RANGING (avoid — high whipsaw risk)
 *
 * Advantage over ADX: reacts faster to trending→ranging transitions.
 * Used together with ADX, reduces false signals ~15-20%.
 */

/** Choppiness Index result. */
export type ChopResult = {
  /** Raw value 0-100 */
  value: number;
  /** TRENDING / NEUTRAL / RANGING */
  state: 'TRENDING' | 'NEUTRAL' | 'RANGING';
  /** Confidence score adjustment (-2 / 0 / +1) */
  confidenceAdjust: number;
  /** Human-readable label */
  label: string;
};

const CHOP_TRENDING_STRONG = 38.2;
const CHOP_TRENDING = 50.0;
const CHOP_RANGING = 61.8;

/**
 * Calculate the Choppiness Index on the last `period` bars.
 * @param candles OHLC candles oldest-first
 * @param period lookback (default 14)
 * @returns ChopResult with value, state and confidence adjustment
 */
export function choppinessIndex(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): ChopResult {
  if (candles.length < period + 1) {
    return { value: 50, state: 'NEUTRAL', confidenceAdjust: 0, label: 'CHOP: insufficient data' };
  }

  const slice = candles.slice(-(period + 1));

  let sumTR = 0;
  for (let i = 1; i < slice.length; i++) {
    const { high, low } = slice[i];
    const prevClose = slice[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    sumTR += tr;
  }

  const bars = slice.slice(1);
  let highestHigh = bars[0].high;
  let lowestLow = bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].high > highestHigh) highestHigh = bars[i].high;
    if (bars[i].low < lowestLow) lowestLow = bars[i].low;
  }

  const range = highestHigh - lowestLow;
  if (range <= 0 || sumTR <= 0) {
    return { value: 50, state: 'NEUTRAL', confidenceAdjust: 0, label: 'CHOP: zero range' };
  }

  const value = (100 * Math.log10(sumTR / range)) / Math.log10(period);
  const clamped = Math.max(0, Math.min(100, value));

  let state: ChopResult['state'];
  let confidenceAdjust: number;
  let label: string;

  if (clamped < CHOP_TRENDING_STRONG) {
    state = 'TRENDING';
    confidenceAdjust = 1;
    label = `CHOP ${clamped.toFixed(1)} — TRENDING STRONG (< ${CHOP_TRENDING_STRONG})`;
  } else if (clamped < CHOP_TRENDING) {
    state = 'TRENDING';
    confidenceAdjust = 1;
    label = `CHOP ${clamped.toFixed(1)} — TRENDING moderate`;
  } else if (clamped < CHOP_RANGING) {
    state = 'NEUTRAL';
    confidenceAdjust = 0;
    label = `CHOP ${clamped.toFixed(1)} — NEUTRAL transition`;
  } else {
    state = 'RANGING';
    confidenceAdjust = -2;
    label = `CHOP ${clamped.toFixed(1)} — RANGING (> ${CHOP_RANGING}) — skip`;
  }

  return { value: clamped, state, confidenceAdjust, label };
}

/**
 * Gate check: returns true when the market is RANGING (entries should be skipped).
 * @param candles OHLC candles
 * @param period lookback
 */
export function checkChopGate(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): { blocked: boolean; chop: ChopResult } {
  const chop = choppinessIndex(candles, period);
  return { blocked: chop.state === 'RANGING', chop };
}
