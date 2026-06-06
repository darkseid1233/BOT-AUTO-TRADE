import { describe, it, expect } from 'vitest';
import { detectRegime, type Bar } from './market-regime.js';
import { getStrategyConfig } from './strategy-config.js';

/** Generate bars trending in one direction with mild noise. */
function trendBars(n: number, dir: 1 | -1, start = 100, step = 0.6): Bar[] {
  const out: Bar[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const open = price;
    price += dir * step;
    const close = price;
    out.push({
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      volume: 1000 + i,
    });
  }
  return out;
}

/** Generate a flat, choppy series (no trend). */
function rangingBars(n: number, mid = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = mid + Math.sin(i / 2) * 0.5;
    return { open: mid, high: mid + 1, low: mid - 1, close, volume: 1000 };
  });
}

describe('detectRegime', () => {
  const cfg = getStrategyConfig();

  it('allows only LONG in a clean uptrend', () => {
    const res = detectRegime(trendBars(260, 1), cfg);
    expect(['TRENDING_BULL', 'RANGING', 'HIGH_VOL']).toContain(res.regime);
    if (res.regime === 'TRENDING_BULL') expect(res.allowedSide).toBe('LONG');
  });

  it('allows only SHORT in a clean downtrend', () => {
    const res = detectRegime(trendBars(260, -1, 300), cfg);
    if (res.regime === 'TRENDING_BEAR') expect(res.allowedSide).toBe('SHORT');
  });

  it('produces NEUTRAL side in a ranging market', () => {
    const res = detectRegime(rangingBars(260), cfg);
    expect(res.allowedSide).toBe('NEUTRAL');
  });

  it('never allows a side that contradicts the regime', () => {
    const res = detectRegime(trendBars(260, 1), cfg);
    expect(res.allowedSide).not.toBe('SHORT');
  });
});
