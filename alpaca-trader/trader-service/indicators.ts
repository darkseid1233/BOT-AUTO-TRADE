/**
 * Technical indicators — all pure functions, no side effects.
 * Upgraded v2: fixed MACD seeding, direction-aware trendScore,
 * optimised StochRSI, proper ADX Wilder smoothing, added volRatio.
 * All take oldest-first arrays.
 */

/** Candle shape used by ATR / ADX. */
export type OhlcCandle = { high: number; low: number; close: number; volume?: number };

/**
 * Simple Moving Average.
 * @param values price series (oldest first)
 * @param period lookback window
 */
export function sma(values: number[], period: number): number {
  if (values.length < period) return values.length > 0 ? values[values.length - 1] : 0;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average.
 * BUG FIX: seeds from partial slice when length < period; returns 0 on empty.
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (period <= 0) return values[values.length - 1];
  const seedLen = Math.min(period, values.length);
  let val = values.slice(0, seedLen).reduce((a, b) => a + b, 0) / seedLen;
  if (values.length < period) return val;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) val = values[i] * k + val * (1 - k);
  return val;
}

/**
 * Relative Strength Index (Wilder, 14-period default).
 * @param values close price series (oldest first)
 * @param period lookback (default 14)
 * @returns RSI 0-100
 */
export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

/**
 * MACD — BUG FIX: fast EMA seeded from fast-period SMA (not slow-period).
 * @returns { macd, signal, histogram }
 */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  sig = 9,
): { macd: number; signal: number; histogram: number } {
  if (values.length < slow + sig) return { macd: 0, signal: 0, histogram: 0 };
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  let emaFast = values.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  for (let i = fast; i < slow; i++) emaFast = values[i] * kFast + emaFast * (1 - kFast);
  let emaSlow = values.slice(0, slow).reduce((a, b) => a + b, 0) / slow;
  const macdSeries: number[] = [];
  for (let i = slow; i < values.length; i++) {
    emaFast = values[i] * kFast + emaFast * (1 - kFast);
    emaSlow = values[i] * kSlow + emaSlow * (1 - kSlow);
    macdSeries.push(emaFast - emaSlow);
  }
  const macdLine = macdSeries[macdSeries.length - 1] ?? 0;
  const signalLine = ema(macdSeries, sig);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

/** Bollinger Bands. @returns { upper, middle, lower, pct } */
export function bollingerBands(
  values: number[],
  period = 20,
  stdDevMult = 2,
): { upper: number; middle: number; lower: number; pct: number } {
  if (values.length < period) {
    const last = values[values.length - 1] ?? 0;
    return { upper: last, middle: last, lower: last, pct: 0.5 };
  }
  const slice = values.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period);
  const upper = middle + stdDevMult * sd;
  const lower = middle - stdDevMult * sd;
  const pct = (values[values.length - 1] - lower) / (upper - lower || 1);
  return { upper, middle, lower, pct };
}

/**
 * ATR — Wilder smoothing. Accepts candle objects { high, low, close }.
 * @param candles OHLC candles (oldest first)
 * @param period lookback (default 14)
 */
export function atr(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) val = (val * (period - 1) + trs[i]) / period;
  return val;
}

/** ATR overload accepting separate high/low/close arrays (legacy API). */
export function atrArrays(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  return atr(
    closes.map((c, i) => ({ high: highs[i] ?? c, low: lows[i] ?? c, close: c })),
    period,
  );
}

/**
 * ADX — Average Directional Index (trend strength 0-100, NOT direction).
 * > 25 trending, < 20 ranging. Also returns +DI / -DI.
 */
export function adx(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): { adx: number; pdi: number; mdi: number } {
  if (candles.length < period * 2) return { adx: 0, pdi: 0, mdi: 0 };
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const up = curr.high - prev.high;
    const dn = prev.low - curr.low;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    trs.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    ));
  }
  const smooth = (arr: number[]): number[] => {
    const out: number[] = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
    for (let i = period; i < arr.length; i++) {
      out.push(out[out.length - 1] - out[out.length - 1] / period + arr[i]);
    }
    return out;
  };
  const sTR = smooth(trs);
  const sPDM = smooth(plusDM);
  const sMDM = smooth(minusDM);
  const pdiArr = sPDM.map((v, i) => sTR[i] ? (v / sTR[i]) * 100 : 0);
  const mdiArr = sMDM.map((v, i) => sTR[i] ? (v / sTR[i]) * 100 : 0);
  const dxArr = pdiArr.map((p, i) => {
    const s = p + mdiArr[i];
    return s ? Math.abs(p - mdiArr[i]) / s * 100 : 0;
  });
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
  return { adx: adxVal, pdi: pdiArr[pdiArr.length - 1] ?? 0, mdi: mdiArr[mdiArr.length - 1] ?? 0 };
}

/**
 * Stochastic RSI — O(n) incremental.
 * @returns 0-100; > 80 overbought, < 20 oversold
 */
export function stochRsi(values: number[], period = 14): number {
  if (values.length < period * 2) return 50;
  const rsiVals: number[] = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  rsiVals.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    rsiVals.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  const slice = rsiVals.slice(-period);
  let min = slice[0], max = slice[0];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] < min) min = slice[i];
    if (slice[i] > max) max = slice[i];
  }
  if (max === min) return 50;
  return ((rsiVals[rsiVals.length - 1] - min) / (max - min)) * 100;
}

/** Volume spike: true when current bar > lookback avg × threshold. */
export function volumeSpike(volumes: number[], lookback = 20, threshold = 1.5): boolean {
  if (volumes.length < lookback + 1) return false;
  const avg = volumes.slice(-lookback - 1, -1).reduce((a, b) => a + b, 0) / lookback;
  return volumes[volumes.length - 1] > avg * threshold;
}

/** Volume ratio: current / lookback avg. */
export function volumeRatio(volumes: number[], lookback = 20): number {
  if (volumes.length < lookback + 1) return 1;
  const avg = volumes.slice(-lookback - 1, -1).reduce((a, b) => a + b, 0) / lookback;
  return avg === 0 ? 1 : volumes[volumes.length - 1] / avg;
}

/**
 * Trend Score (0-4) — direction-aware.
 * Bull & bear scored independently so SHORT setups also score STRONG.
 * @returns { score, label: 'STRONG'|'WEAK'|'RANGE', reasons }
 */
export function trendScore(
  closes: number[],
  volumes: number[],
  candles: { high: number; low: number; close: number }[],
): { score: number; label: 'STRONG' | 'WEAK' | 'RANGE'; reasons: string[] } {
  const reasons: string[] = [];
  const price = closes[closes.length - 1];
  const e50 = ema(closes, 50);
  const e200 = ema(closes, Math.max(2, Math.min(200, closes.length)));
  let bull = 0, bear = 0;
  const eps = Math.abs(e200) * 1e-6;
  if (price > e200 + eps) bull++;
  else if (price < e200 - eps) bear++;
  if (e50 > e200 + eps) bull++;
  else if (e50 < e200 - eps) bear++;
  if (candles.length >= 5) {
    const last5 = candles.slice(-5);
    const hs = last5.map((c) => c.high);
    const ls = last5.map((c) => c.low);
    const hhhl = hs[4] > hs[2] && hs[2] > hs[0] && ls[4] > ls[2] && ls[2] > ls[0];
    const llhl = hs[4] < hs[2] && hs[2] < hs[0] && ls[4] < ls[2] && ls[2] < ls[0];
    if (hhhl) bull++;
    else if (llhl) bear++;
  }
  const dominant = Math.max(bull, bear);
  const isBull = bull > bear;
  const isBear = bear > bull;
  let score = bull === bear ? 0 : dominant;
  const volConf = volumeSpike(volumes, 10, 1.2);
  if (volConf && score > 0) { score++; reasons.push('Volume spike confirms'); }
  if (isBull) {
    if (price > e200) reasons.unshift('Price > EMA200');
    if (e50 > e200) reasons.push('EMA50 > EMA200');
    reasons.push('Bullish structure');
  } else if (isBear) {
    if (price < e200) reasons.unshift('Price < EMA200');
    if (e50 < e200) reasons.push('EMA50 < EMA200');
    reasons.push('Bearish structure');
  }
  const label: 'STRONG' | 'WEAK' | 'RANGE' = score >= 3 ? 'STRONG' : score === 2 ? 'WEAK' : 'RANGE';
  return { score, label, reasons };
}

/**
 * Percent momentum over the last `lookback` bars.
 * @param values close price series
 * @param lookback number of bars
 * @returns percentage change
 */
export function momentum(values: number[], lookback = 10): number {
  if (values.length < lookback + 1) return 0;
  const past = values[values.length - 1 - lookback];
  const now = values[values.length - 1];
  if (!past) return 0;
  return ((now - past) / past) * 100;
}
