/**
 * VWAP — Volume Weighted Average Price.
 *
 * VWAP is the single most-used reference price by institutional traders.
 * Trading ABOVE VWAP = bullish (institutions buying). BELOW = bearish.
 * Price returning to VWAP after a spike = high-probability entry zone.
 *
 * Why top bots use it:
 *   - Freqtrade community strategies (NostalgiaForInfinity, CLUC, etc.) all use VWAP.
 *   - Jesse-AI's best backtest strategies use VWAP as an entry filter.
 *   - ZenBot has a dedicated VWAP strategy module.
 *
 * Two modes:
 *   1. Session VWAP — resets at start of each trading day (most common).
 *   2. Rolling VWAP — running window of N bars (easier without timestamp data).
 *
 * We implement ROLLING VWAP since Alpaca bar timestamps may not align to a clean
 * "trading day" reset in crypto (24/7 market). The operator can set VWAP_PERIOD
 * env var to control the window (default = 96 bars = 24h on 15m chart).
 */

export type VwapResult = {
  /** Current VWAP value */
  vwap: number;
  /** True when price is above VWAP (institutional buying pressure) */
  priceAbove: boolean;
  /** Distance of current price from VWAP as a percentage */
  distancePct: number;
  /** VWAP deviation bands (like Bollinger Bands but volume-weighted) */
  upperBand: number;
  lowerBand: number;
};

export type OhlcvBar = { high: number; low: number; close: number; volume: number };

/**
 * Calculate rolling VWAP over the last N bars.
 * @param bars OHLC+volume bars (oldest first)
 * @param period number of bars to include (default 96 = 24h on 15m)
 * @param bandMult standard deviation multiplier for bands (default 1.0)
 * @returns VwapResult for the current bar
 */
export function vwap(
  bars: OhlcvBar[],
  period = 96,
  bandMult = 1.0,
): VwapResult {
  if (bars.length === 0) {
    return { vwap: 0, priceAbove: false, distancePct: 0, upperBand: 0, lowerBand: 0 };
  }

  const window = bars.slice(-period);
  let cumTPV = 0;
  let cumVol = 0;
  const tpArr: number[] = [];

  for (const b of window) {
    const tp = (b.high + b.low + b.close) / 3;  // typical price
    const vol = Math.max(b.volume, 0);
    cumTPV += tp * vol;
    cumVol += vol;
    tpArr.push(tp);
  }

  const vwapVal = cumVol > 0 ? cumTPV / cumVol : bars[bars.length - 1].close;
  const currentPrice = bars[bars.length - 1].close;

  // VWAP Standard Deviation bands — like Bollinger but volume-weighted
  let sumSqDiff = 0;
  let volSum = 0;
  for (let i = 0; i < window.length; i++) {
    const tp = tpArr[i];
    const vol = Math.max(window[i].volume, 0);
    sumSqDiff += vol * (tp - vwapVal) ** 2;
    volSum += vol;
  }
  const stdDev = volSum > 0 ? Math.sqrt(sumSqDiff / volSum) : 0;
  const distancePct = vwapVal > 0 ? ((currentPrice - vwapVal) / vwapVal) * 100 : 0;

  return {
    vwap: vwapVal,
    priceAbove: currentPrice > vwapVal,
    distancePct,
    upperBand: vwapVal + bandMult * stdDev,
    lowerBand: vwapVal - bandMult * stdDev,
  };
}

/**
 * VWAP trading signal strength (0-1).
 * - Returns 1.0 when price pulls back to VWAP in the direction of the trend.
 * - Returns 0.5 when price is far from VWAP (momentum entry).
 * - Returns 0.2 when trading against VWAP direction.
 *
 * @param side trade direction
 * @param vwapResult result from vwap()
 * @returns signal strength 0-1
 */
export function vwapSignalStrength(side: 'LONG' | 'SHORT', vwapResult: VwapResult): number {
  const { priceAbove, distancePct } = vwapResult;
  const absDist = Math.abs(distancePct);

  if (side === 'LONG') {
    if (priceAbove && absDist < 0.3) return 1.0;   // near VWAP from above = best LONG entry
    if (priceAbove && absDist < 1.0) return 0.8;   // above VWAP, moderate distance
    if (priceAbove) return 0.5;                     // far above VWAP = extended
    return 0.2;                                      // below VWAP = against institutional pressure
  } else {
    if (!priceAbove && absDist < 0.3) return 1.0;  // near VWAP from below = best SHORT entry
    if (!priceAbove && absDist < 1.0) return 0.8;
    if (!priceAbove) return 0.5;
    return 0.2;                                      // above VWAP = against institutional pressure
  }
}
