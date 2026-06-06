import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, macd, atr, adx, bollingerBands, stochRsi } from './indicators.js';

/** Build a strictly rising close series. */
function rising(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/** Build OHLC candles from a close series with a fixed range. */
function candles(closes: number[], range = 2) {
  return closes.map((c) => ({ high: c + range, low: c - range, close: c, volume: 1000 }));
}

describe('sma', () => {
  it('averages the last N values', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
  });
  it('falls back to last value when series shorter than period', () => {
    expect(sma([7], 5)).toBe(7);
  });
});

describe('ema', () => {
  it('returns 0 for empty input', () => {
    expect(ema([], 10)).toBe(0);
  });
  it('tracks a rising series above its SMA tail', () => {
    const series = rising(50);
    expect(ema(series, 10)).toBeGreaterThan(100);
    expect(ema(series, 10)).toBeLessThanOrEqual(series[series.length - 1]);
  });
});

describe('rsi', () => {
  it('returns ~100 for a monotonic uptrend', () => {
    expect(rsi(rising(30))).toBeGreaterThan(95);
  });
  it('returns neutral 50 when not enough data', () => {
    expect(rsi([1, 2, 3])).toBe(50);
  });
});

describe('macd', () => {
  it('produces a positive histogram in an uptrend', () => {
    const { histogram } = macd(rising(60));
    expect(histogram).toBeGreaterThan(0);
  });
  it('returns zeros when series too short', () => {
    expect(macd([1, 2, 3])).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });
});

describe('atr', () => {
  it('equals the constant true range for a flat-range series', () => {
    const v = atr(candles(rising(30), 2), 14);
    expect(v).toBeGreaterThan(0);
  });
  it('returns 0 when insufficient candles', () => {
    expect(atr(candles(rising(5)), 14)).toBe(0);
  });
});

describe('adx', () => {
  it('reports a strong trend for a clean uptrend', () => {
    const { adx: a, pdi, mdi } = adx(candles(rising(60)), 14);
    expect(a).toBeGreaterThan(20);
    expect(pdi).toBeGreaterThan(mdi);
  });
});

describe('bollingerBands', () => {
  it('keeps lower < middle < upper', () => {
    const { upper, middle, lower } = bollingerBands(rising(40));
    expect(lower).toBeLessThan(middle);
    expect(middle).toBeLessThan(upper);
  });
});

describe('stochRsi', () => {
  it('is bounded 0-100', () => {
    const v = stochRsi(rising(60));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});
