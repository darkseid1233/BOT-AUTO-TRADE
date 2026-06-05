/**
 * Pure technical-indicator helpers used by the signal engine.
 * All functions are side-effect free and operate on plain number arrays.
 */

/**
 * Simple Moving Average of the last `period` values.
 * @param values price series (oldest first)
 * @param period lookback window
 * @returns the SMA, or the last value if not enough data
 */
export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Exponential Moving Average.
 * @param values price series (oldest first)
 * @param period lookback window
 * @returns the EMA of the series
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Relative Strength Index (Wilder).
 * @param values close price series (oldest first)
 * @param period lookback window (default 14)
 * @returns RSI value 0-100
 */
export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range — a volatility measure.
 * @param highs high price series
 * @param lows low price series
 * @param closes close price series
 * @param period lookback window (default 14)
 * @returns the ATR value
 */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): number {
  const n = closes.length;
  if (n < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  return sma(trs, period);
}

/**
 * Percent momentum over the last `lookback` bars.
 * @param values close price series
 * @param lookback number of bars to compare against (default 10)
 * @returns percentage change
 */
export function momentum(values: number[], lookback = 10): number {
  if (values.length < lookback + 1) return 0;
  const past = values[values.length - 1 - lookback];
  const now = values[values.length - 1];
  if (past === 0) return 0;
  return ((now - past) / past) * 100;
}
