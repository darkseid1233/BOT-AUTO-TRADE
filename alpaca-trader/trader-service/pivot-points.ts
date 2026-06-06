/**
 * Pivot Points — key support/resistance levels used by virtually all professional bots.
 *
 * Why top bots use them:
 *  - Freqtrade NostalgiaForInfinity strategy uses pivot points for SL/TP placement.
 *  - Jesse-AI uses them as dynamic S/R for entry confirmation.
 *  - They represent key institutional levels where orders cluster.
 *
 * We compute 3 types:
 *  1. Standard Pivot (floor pivot) — most common
 *  2. Fibonacci Pivot — more accurate for crypto (aligns with 38.2%, 61.8% levels)
 *  3. Camarilla Pivot — tighter levels, best for range-bound markets
 *
 * Usage in our bot: signal quality bonus when price is near a key support/resistance pivot.
 *
 * Input: previous session's high, low, close (daily or 4H bar).
 */

export type PivotLevels = {
  pp: number;   // Pivot Point (central level)
  r1: number; r2: number; r3: number;  // Resistance levels
  s1: number; s2: number; s3: number;  // Support levels
};

export type PivotResult = {
  standard: PivotLevels;
  fibonacci: PivotLevels;
  camarilla: { r1: number; r2: number; r3: number; r4: number; s1: number; s2: number; s3: number; s4: number };
  /** Closest pivot level to current price */
  nearestLevel: number;
  /** Distance from current price to nearest pivot as % */
  distancePct: number;
  /** Whether current price is near a pivot (within PIVOT_PROXIMITY_PCT) */
  nearPivot: boolean;
  /** Which level is nearest */
  nearestLabel: string;
};

const PROXIMITY_PCT = 0.3; // within 0.3% of a pivot = "near pivot"

/**
 * Calculate Standard Floor Pivots.
 * @param high previous session high
 * @param low previous session low
 * @param close previous session close
 */
export function standardPivots(high: number, low: number, close: number): PivotLevels {
  const pp = (high + low + close) / 3;
  const r1 = 2 * pp - low;
  const r2 = pp + (high - low);
  const r3 = high + 2 * (pp - low);
  const s1 = 2 * pp - high;
  const s2 = pp - (high - low);
  const s3 = low - 2 * (high - pp);
  return { pp, r1, r2, r3, s1, s2, s3 };
}

/**
 * Calculate Fibonacci Pivots.
 * Fibonacci ratios (38.2%, 61.8%, 100%) applied to the pivot range.
 */
export function fibonacciPivots(high: number, low: number, close: number): PivotLevels {
  const pp = (high + low + close) / 3;
  const range = high - low;
  const r1 = pp + range * 0.382;
  const r2 = pp + range * 0.618;
  const r3 = pp + range * 1.0;
  const s1 = pp - range * 0.382;
  const s2 = pp - range * 0.618;
  const s3 = pp - range * 1.0;
  return { pp, r1, r2, r3, s1, s2, s3 };
}

/**
 * Calculate Camarilla Pivots.
 * Tighter levels, especially useful for intraday range trading.
 */
export function camarillaPivots(high: number, low: number, close: number) {
  const range = high - low;
  return {
    r1: close + range * 1.0833,
    r2: close + range * 1.1666,
    r3: close + range * 1.25,
    r4: close + range * 1.5,
    s1: close - range * 1.0833,
    s2: close - range * 1.1666,
    s3: close - range * 1.25,
    s4: close - range * 1.5,
  };
}

/**
 * Full pivot analysis: all three types + nearest-level detection.
 * @param prevHigh previous session high
 * @param prevLow previous session low
 * @param prevClose previous session close
 * @param currentPrice current market price
 */
export function analyzePivots(
  prevHigh: number,
  prevLow: number,
  prevClose: number,
  currentPrice: number,
): PivotResult {
  const standard = standardPivots(prevHigh, prevLow, prevClose);
  const fibonacci = fibonacciPivots(prevHigh, prevLow, prevClose);
  const camarilla = camarillaPivots(prevHigh, prevLow, prevClose);

  // Collect all levels with labels
  const levels: Array<{ label: string; value: number }> = [
    { label: 'PP', value: standard.pp },
    { label: 'R1', value: standard.r1 },
    { label: 'R2', value: standard.r2 },
    { label: 'R3', value: standard.r3 },
    { label: 'S1', value: standard.s1 },
    { label: 'S2', value: standard.s2 },
    { label: 'S3', value: standard.s3 },
    { label: 'FibR1', value: fibonacci.r1 },
    { label: 'FibS1', value: fibonacci.s1 },
    { label: 'FibR2', value: fibonacci.r2 },
    { label: 'FibS2', value: fibonacci.s2 },
    { label: 'CamS3', value: camarilla.s3 },
    { label: 'CamR3', value: camarilla.r3 },
    { label: 'CamS4', value: camarilla.s4 },
    { label: 'CamR4', value: camarilla.r4 },
  ];

  const closest = levels.reduce((a, b) =>
    Math.abs(b.value - currentPrice) < Math.abs(a.value - currentPrice) ? b : a
  );

  const distancePct = closest.value > 0
    ? Math.abs((currentPrice - closest.value) / closest.value) * 100
    : 999;

  return {
    standard,
    fibonacci,
    camarilla,
    nearestLevel: closest.value,
    distancePct,
    nearPivot: distancePct < PROXIMITY_PCT,
    nearestLabel: closest.label,
  };
}

/**
 * Score 0-1 based on pivot alignment with trade side.
 * - Price near SUPPORT and going LONG = high score.
 * - Price near RESISTANCE and going SHORT = high score.
 * - Far from all pivots = neutral (0.5).
 */
export function pivotSignalScore(side: 'LONG' | 'SHORT', pivot: PivotResult): number {
  if (!pivot.nearPivot) return 0.5; // neutral — not near any pivot

  const label = pivot.nearestLabel;
  const isSupport = label.includes('S') || label === 'PP';
  const isResistance = label.includes('R') && !label.includes('PP');

  if (side === 'LONG' && isSupport) return 0.9;
  if (side === 'SHORT' && isResistance) return 0.9;
  if (side === 'LONG' && isResistance) return 0.2; // hitting resistance on LONG = bad
  if (side === 'SHORT' && isSupport) return 0.2;   // hitting support on SHORT = bad
  return 0.5;
}
