/**
 * Supertrend Indicator — used by Freqtrade top strategies and Jesse-AI.
 *
 * Supertrend is an ATR-based trailing stop that also acts as a trend filter.
 * It produces a single line that sits BELOW price in uptrends and ABOVE in downtrends.
 * A cross of price through the supertrend line = trend reversal signal.
 *
 * Formula:
 *   Basic Upper = (high + low) / 2 + multiplier × ATR
 *   Basic Lower = (high + low) / 2 - multiplier × ATR
 *   Final Upper = min(Basic Upper, prev Final Upper) when close > prev Final Upper, else Basic Upper
 *   Final Lower = max(Basic Lower, prev Final Lower) when close < prev Final Lower, else Basic Lower
 *   Supertrend = Final Lower when uptrend (close > prev Supertrend), else Final Upper
 *
 * Why it matters vs our current trailing stop:
 *   - Our trailing stop is purely ATR-based from entry. Supertrend is computed from
 *     ALL candles, so it adapts to the full price structure, not just the entry bar.
 *   - It's a LEADING signal for regime change (confirms TRENDING_BEAR exits early).
 *   - Freqtrade's most profitable community strategies almost all use Supertrend.
 *
 * @see https://github.com/freqtrade/freqtrade-strategies (top downloaded strategies)
 */

export type Bar = { open: number; high: number; low: number; close: number };

export type SupertrendResult = {
  /** Current supertrend value */
  value: number;
  /** 'up' when price is above supertrend (uptrend), 'down' when below */
  direction: 'up' | 'down';
  /** True on this bar if direction changed (crossover = entry/exit signal) */
  crossed: boolean;
  /** ATR used for this bar */
  atr: number;
};

/**
 * Calculate Supertrend for a bar series.
 * Returns the result for the LAST bar only (live-trading use case).
 *
 * @param candles OHLC bar array (oldest first)
 * @param period ATR period (default 10, popular in crypto)
 * @param multiplier ATR multiplier (default 3.0, Freqtrade default)
 * @returns SupertrendResult for the last bar
 */
export function supertrend(
  candles: Bar[],
  period = 10,
  multiplier = 3.0,
): SupertrendResult {
  const n = candles.length;
  if (n < period + 2) {
    const last = candles[n - 1] ?? { close: 0, high: 0, low: 0, open: 0 };
    return { value: last.close, direction: 'up', crossed: false, atr: 0 };
  }

  // ── Step 1: compute ATR series (Wilder smoothing) ─────────────────────────
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrSeries: number[] = [atrVal];
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
    atrSeries.push(atrVal);
  }

  // ── Step 2: compute Supertrend series ─────────────────────────────────────
  // atrSeries[0] corresponds to candles[period] (first full ATR period)
  const startIdx = period;
  let prevUpperBand = 0;
  let prevLowerBand = 0;
  let prevSt = 0;
  let prevDir: 'up' | 'down' = 'up';
  let crossed = false;

  for (let i = 0; i < atrSeries.length; i++) {
    const bar = candles[startIdx + i];
    const hl2 = (bar.high + bar.low) / 2;
    const a = atrSeries[i];

    const rawUpper = hl2 + multiplier * a;
    const rawLower = hl2 - multiplier * a;

    const finalUpper = (i === 0 || rawUpper < prevUpperBand || candles[startIdx + i - 1].close > prevUpperBand)
      ? rawUpper
      : prevUpperBand;

    const finalLower = (i === 0 || rawLower > prevLowerBand || candles[startIdx + i - 1].close < prevLowerBand)
      ? rawLower
      : prevLowerBand;

    let st: number;
    let dir: 'up' | 'down';

    if (i === 0) {
      st = bar.close >= hl2 ? finalLower : finalUpper;
      dir = bar.close >= finalLower ? 'up' : 'down';
    } else {
      if (prevDir === 'up') {
        st = bar.close < finalLower ? finalUpper : finalLower;
        dir = bar.close < finalLower ? 'down' : 'up';
      } else {
        st = bar.close > finalUpper ? finalLower : finalUpper;
        dir = bar.close > finalUpper ? 'up' : 'down';
      }
    }

    crossed = dir !== prevDir && i > 0;
    prevUpperBand = finalUpper;
    prevLowerBand = finalLower;
    prevSt = st;
    prevDir = dir;
  }

  return {
    value: prevSt,
    direction: prevDir,
    crossed,
    atr: atrSeries[atrSeries.length - 1] ?? 0,
  };
}

/**
 * Full Supertrend series for backtesting (returns value + direction per bar).
 * @param candles OHLC bar array (oldest first)
 * @param period ATR period
 * @param multiplier ATR multiplier
 * @returns array aligned to candles (first `period` entries are null)
 */
export function supertrendSeries(
  candles: Bar[],
  period = 10,
  multiplier = 3.0,
): Array<{ value: number; direction: 'up' | 'down' } | null> {
  const result: Array<{ value: number; direction: 'up' | 'down' } | null> = Array(period).fill(null);
  const n = candles.length;
  if (n < period + 2) return Array(n).fill(null);

  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrSeries: number[] = [atrVal];
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
    atrSeries.push(atrVal);
  }

  let prevUpperBand = 0, prevLowerBand = 0, prevDir: 'up' | 'down' = 'up';

  for (let i = 0; i < atrSeries.length; i++) {
    const bar = candles[period + i];
    const hl2 = (bar.high + bar.low) / 2;
    const a = atrSeries[i];

    const rawUpper = hl2 + multiplier * a;
    const rawLower = hl2 - multiplier * a;

    const finalUpper = (i === 0 || rawUpper < prevUpperBand || candles[period + i - 1].close > prevUpperBand)
      ? rawUpper : prevUpperBand;
    const finalLower = (i === 0 || rawLower > prevLowerBand || candles[period + i - 1].close < prevLowerBand)
      ? rawLower : prevLowerBand;

    let st: number;
    let dir: 'up' | 'down';
    if (i === 0) {
      st = bar.close >= finalLower ? finalLower : finalUpper;
      dir = bar.close >= finalLower ? 'up' : 'down';
    } else if (prevDir === 'up') {
      st = bar.close < finalLower ? finalUpper : finalLower;
      dir = bar.close < finalLower ? 'down' : 'up';
    } else {
      st = bar.close > finalUpper ? finalLower : finalUpper;
      dir = bar.close > finalUpper ? 'up' : 'down';
    }

    result.push({ value: st, direction: dir });
    prevUpperBand = finalUpper;
    prevLowerBand = finalLower;
    prevDir = dir;
  }

  return result;
}
