/**
 * Smart Money Concepts (SMC) analysis.
 *
 * Implements:
 *  - Swing High / Swing Low detection
 *  - Market Structure (HH/HL bullish, LL/LH bearish)
 *  - Break of Structure (BOS) — trend continuation
 *  - Change of Character (CHoCH) — potential reversal
 *  - Order Blocks — last opposing candle before a strong move
 *  - Fair Value Gap (FVG) — 3-candle imbalance
 *  - Liquidity Sweep — wick piercing a prior swing then reversing
 *  - Fibonacci retracement from the most recent swing
 *
 * All functions accept OHLC candles oldest-first.
 * Zero look-ahead bias.
 */

export type SmcCandle = { open: number; high: number; low: number; close: number; volume: number };

export type Swing = { index: number; price: number; type: 'high' | 'low' };

export type OrderBlock = {
  type: 'bullish' | 'bearish';
  index: number;
  high: number;
  low: number;
  mitigated: boolean;
};

export type FairValueGap = {
  type: 'bullish' | 'bearish';
  index: number;
  top: number;
  bottom: number;
  filled: boolean;
};

export type MarketStructure = 'bullish' | 'bearish' | 'ranging';

export type FibonacciLevels = {
  high: number;
  low: number;
  direction: 'up' | 'down';
  levels: {
    '0': number; '0.236': number; '0.382': number;
    '0.5': number; '0.618': number; '0.786': number; '1': number;
  };
  /** 0-1 — where current price sits within the fib range */
  currentLevel: number;
};

export type SmartMoneyAnalysis = {
  structure: MarketStructure;
  bos: boolean;
  choch: boolean;
  liquiditySweep: 'bullish' | 'bearish' | null;
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  swingHigh: Swing | null;
  swingLow: Swing | null;
  fibonacci: FibonacciLevels | null;
  smcScore: { bull: number; bear: number; reasons: string[] };
};

/**
 * Find swing highs and lows using a lookback window.
 * @param candles OHLC candles
 * @param lookback bars each side to confirm a swing
 */
export function findSwings(candles: SmcCandle[], lookback = 5): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ index: i, price: c.high, type: 'high' });
    if (isLow) swings.push({ index: i, price: c.low, type: 'low' });
  }
  return swings;
}

/** Derive market structure and BOS/CHoCH from swings. */
function analyzeStructure(swings: Swing[]): {
  structure: MarketStructure;
  bos: boolean;
  choch: boolean;
} {
  const highs = swings.filter((s) => s.type === 'high').slice(-4);
  const lows = swings.filter((s) => s.type === 'low').slice(-4);

  if (highs.length < 2 || lows.length < 2) {
    return { structure: 'ranging', bos: false, choch: false };
  }

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const hh = lastHigh.price > prevHigh.price;
  const hl = lastLow.price > prevLow.price;
  const ll = lastLow.price < prevLow.price;
  const lh = lastHigh.price < prevHigh.price;

  let structure: MarketStructure = 'ranging';
  let bos = false;
  let choch = false;

  if (hh && hl) {
    structure = 'bullish';
    bos = hh;
  } else if (ll && lh) {
    structure = 'bearish';
    bos = ll;
  } else if ((hh && !hl) || (!hh && hl)) {
    // Mixed — could be CHoCH
    choch = true;
    structure = 'ranging';
  }

  return { structure, bos, choch };
}

/** Detect order blocks (last opposing candle before a strong move). */
function findOrderBlocks(candles: SmcCandle[], lookback = 20): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const recent = candles.slice(-lookback);
  const currentPrice = candles[candles.length - 1].close;

  for (let i = 1; i < recent.length - 1; i++) {
    const curr = recent[i];
    const next = recent[i + 1];
    const isStrongUp = (next.close - next.open) / next.open > 0.003;
    const isStrongDn = (next.open - next.close) / next.open > 0.003;

    if (isStrongUp && curr.close < curr.open) {
      blocks.push({
        type: 'bullish',
        index: i,
        high: curr.high,
        low: curr.low,
        mitigated: currentPrice < curr.low,
      });
    } else if (isStrongDn && curr.close > curr.open) {
      blocks.push({
        type: 'bearish',
        index: i,
        high: curr.high,
        low: curr.low,
        mitigated: currentPrice > curr.high,
      });
    }
  }
  return blocks;
}

/** Detect 3-candle Fair Value Gaps. */
function findFairValueGaps(candles: SmcCandle[], lookback = 20): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const recent = candles.slice(-lookback);
  const currentPrice = candles[candles.length - 1].close;

  for (let i = 0; i < recent.length - 2; i++) {
    const c0 = recent[i];
    const c2 = recent[i + 2];

    if (c2.low > c0.high) {
      gaps.push({
        type: 'bullish',
        index: i + 1,
        top: c2.low,
        bottom: c0.high,
        filled: currentPrice <= c0.high,
      });
    } else if (c2.high < c0.low) {
      gaps.push({
        type: 'bearish',
        index: i + 1,
        top: c0.low,
        bottom: c2.high,
        filled: currentPrice >= c0.low,
      });
    }
  }
  return gaps;
}

/** Detect liquidity sweeps (wick through prior swing then reversal). */
function detectLiquiditySweep(
  candles: SmcCandle[],
  swingHigh: Swing | null,
  swingLow: Swing | null,
): 'bullish' | 'bearish' | null {
  if (candles.length < 3) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (swingHigh && prev.high > swingHigh.price && last.close < swingHigh.price) {
    return 'bearish'; // swept highs then reversed down
  }
  if (swingLow && prev.low < swingLow.price && last.close > swingLow.price) {
    return 'bullish'; // swept lows then reversed up
  }
  return null;
}

/** Calculate Fibonacci retracement levels from the most recent significant swing. */
function calcFibonacci(
  swingHigh: Swing | null,
  swingLow: Swing | null,
  currentPrice: number,
): FibonacciLevels | null {
  if (!swingHigh || !swingLow) return null;
  const direction = swingHigh.index > swingLow.index ? 'down' : 'up';
  const high = swingHigh.price;
  const low = swingLow.price;
  const range = high - low;
  if (range <= 0) return null;

  const l = (r: number) => (direction === 'up' ? low + range * r : high - range * r);
  const currentLevel = direction === 'up'
    ? (currentPrice - low) / range
    : (high - currentPrice) / range;

  return {
    high,
    low,
    direction,
    levels: {
      '0': l(0), '0.236': l(0.236), '0.382': l(0.382),
      '0.5': l(0.5), '0.618': l(0.618), '0.786': l(0.786), '1': l(1),
    },
    currentLevel: Math.max(0, Math.min(1, currentLevel)),
  };
}

/**
 * Run full Smart Money analysis on the provided candles.
 * @param candles OHLC candles oldest-first (min 30 recommended)
 * @param lookback swing lookback (default 5)
 * @returns SmartMoneyAnalysis
 */
export function analyzeSmartMoney(candles: SmcCandle[], lookback = 5): SmartMoneyAnalysis {
  if (candles.length < lookback * 2 + 5) {
    return {
      structure: 'ranging', bos: false, choch: false, liquiditySweep: null,
      orderBlocks: [], fairValueGaps: [], swingHigh: null, swingLow: null,
      fibonacci: null, smcScore: { bull: 0, bear: 0, reasons: [] },
    };
  }

  const swings = findSwings(candles, lookback);
  const highs = swings.filter((s) => s.type === 'high');
  const lows = swings.filter((s) => s.type === 'low');
  const swingHigh = highs.length > 0 ? highs[highs.length - 1] : null;
  const swingLow = lows.length > 0 ? lows[lows.length - 1] : null;

  const { structure, bos, choch } = analyzeStructure(swings);
  const orderBlocks = findOrderBlocks(candles);
  const fairValueGaps = findFairValueGaps(candles);
  const liquiditySweep = detectLiquiditySweep(candles, swingHigh, swingLow);
  const currentPrice = candles[candles.length - 1].close;
  const fibonacci = calcFibonacci(swingHigh, swingLow, currentPrice);

  // SMC Score
  const reasons: string[] = [];
  let bull = 0, bear = 0;

  if (structure === 'bullish') { bull += 2; reasons.push('Bullish market structure'); }
  else if (structure === 'bearish') { bear += 2; reasons.push('Bearish market structure'); }

  if (bos) {
    if (structure === 'bullish') { bull++; reasons.push('BOS bullish'); }
    else { bear++; reasons.push('BOS bearish'); }
  }

  if (liquiditySweep === 'bullish') { bull++; reasons.push('Bullish liquidity sweep'); }
  else if (liquiditySweep === 'bearish') { bear++; reasons.push('Bearish liquidity sweep'); }

  const activeBullOB = orderBlocks.filter((ob) => ob.type === 'bullish' && !ob.mitigated);
  const activeBearOB = orderBlocks.filter((ob) => ob.type === 'bearish' && !ob.mitigated);
  if (activeBullOB.length > 0) { bull++; reasons.push(`${activeBullOB.length} bullish OB(s)`); }
  if (activeBearOB.length > 0) { bear++; reasons.push(`${activeBearOB.length} bearish OB(s)`); }

  const activeFVGs = fairValueGaps.filter((g) => !g.filled);
  const bullFVGs = activeFVGs.filter((g) => g.type === 'bullish');
  const bearFVGs = activeFVGs.filter((g) => g.type === 'bearish');
  if (bullFVGs.length > 0) { bull++; }
  if (bearFVGs.length > 0) { bear++; }

  return {
    structure, bos, choch, liquiditySweep, orderBlocks, fairValueGaps,
    swingHigh, swingLow, fibonacci,
    smcScore: { bull, bear, reasons },
  };
}
