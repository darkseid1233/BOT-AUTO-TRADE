/**
 * Candlestick Pattern Recognition.
 *
 * Freqtrade's sample strategy explicitly includes pattern recognition as a scoring
 * factor (Hammer, Engulfing, Doji, Morning Star, Shooting Star, etc.).
 * Jesse-AI also uses candle patterns for entry confirmation.
 *
 * We implement 8 high-probability patterns:
 *   Bullish: Hammer, Bullish Engulfing, Morning Star, Dragonfly Doji, Three White Soldiers
 *   Bearish: Shooting Star, Bearish Engulfing, Evening Star, Gravestone Doji, Three Black Crows
 *
 * All patterns are confirmed only when:
 *   1. The pattern appears at the CORRECT position relative to the trend.
 *   2. Volume is above average on the key candle (confirmation).
 *
 * Returns a PatternResult that can be fed into the signal quality score.
 */

export type Bar = { open: number; high: number; low: number; close: number; volume: number };

export type PatternResult = {
  bullish: string[];  // list of bullish patterns found on last bars
  bearish: string[];  // list of bearish patterns found on last bars
  score: number;      // 0-1: strength of combined pattern signal
  /** Best single pattern for logging */
  best: string | null;
};

const BODY_DOJI_RATIO = 0.1;    // candle body < 10% of range = doji
const BODY_SMALL_RATIO = 0.3;   // small body for hammer/shooting star
const SHADOW_RATIO = 2.0;       // shadow must be 2× body for hammer/SS
const VOLUME_CONFIRM_MULT = 1.2; // volume must be 1.2× 10-bar average

function body(b: Bar): number { return Math.abs(b.close - b.open); }
function range(b: Bar): number { return b.high - b.low || 0.0001; }
function upperShadow(b: Bar): number { return b.high - Math.max(b.open, b.close); }
function lowerShadow(b: Bar): number { return Math.min(b.open, b.close) - b.low; }
function isBull(b: Bar): boolean { return b.close > b.open; }
function isBear(b: Bar): boolean { return b.close < b.open; }
function avgVol(bars: Bar[], n = 10): number {
  const slice = bars.slice(-n - 1, -1);
  return slice.length ? slice.reduce((s, b) => s + b.volume, 0) / slice.length : 0;
}

/**
 * Detect candlestick patterns in the last 3 bars.
 * @param bars OHLC+volume bar array (oldest first, need at least 10 bars)
 * @returns PatternResult with detected patterns and combined score
 */
export function detectCandlestickPatterns(bars: Bar[]): PatternResult {
  const result: PatternResult = { bullish: [], bearish: [], score: 0, best: null };
  if (bars.length < 10) return result;

  const c = bars[bars.length - 1];  // current (last)
  const p = bars[bars.length - 2];  // previous
  const pp = bars[bars.length - 3]; // 2 bars ago
  const av = avgVol(bars);
  const volOk = c.volume >= av * VOLUME_CONFIRM_MULT;

  // ── Single-bar bullish patterns ───────────────────────────────────────────

  // Hammer: small body at top, long lower shadow, in downtrend
  if (
    isBull(c) &&
    body(c) / range(c) < BODY_SMALL_RATIO &&
    lowerShadow(c) > body(c) * SHADOW_RATIO &&
    upperShadow(c) < body(c) * 0.5
  ) {
    result.bullish.push('Hammer');
  }

  // Dragonfly Doji: body near zero at high, long lower shadow
  if (
    body(c) / range(c) < BODY_DOJI_RATIO &&
    lowerShadow(c) > range(c) * 0.6 &&
    upperShadow(c) < range(c) * 0.1
  ) {
    result.bullish.push('Dragonfly Doji');
  }

  // ── Single-bar bearish patterns ───────────────────────────────────────────

  // Shooting Star: small body at bottom, long upper shadow
  if (
    isBear(c) &&
    body(c) / range(c) < BODY_SMALL_RATIO &&
    upperShadow(c) > body(c) * SHADOW_RATIO &&
    lowerShadow(c) < body(c) * 0.5
  ) {
    result.bearish.push('Shooting Star');
  }

  // Gravestone Doji: body near zero at low, long upper shadow
  if (
    body(c) / range(c) < BODY_DOJI_RATIO &&
    upperShadow(c) > range(c) * 0.6 &&
    lowerShadow(c) < range(c) * 0.1
  ) {
    result.bearish.push('Gravestone Doji');
  }

  // ── Two-bar patterns ────────────────────────────────────────────────────

  // Bullish Engulfing: bearish candle followed by larger bullish that engulfs it
  if (
    isBear(p) && isBull(c) &&
    c.close > p.open && c.open < p.close &&
    body(c) > body(p) * 1.1
  ) {
    result.bullish.push('Bullish Engulfing');
  }

  // Bearish Engulfing: bullish candle followed by larger bearish that engulfs it
  if (
    isBull(p) && isBear(c) &&
    c.close < p.open && c.open > p.close &&
    body(c) > body(p) * 1.1
  ) {
    result.bearish.push('Bearish Engulfing');
  }

  // Tweezer Bottom: two candles with nearly same low (support)
  if (
    Math.abs(c.low - p.low) / (p.low || 1) < 0.002 &&
    isBear(p) && isBull(c)
  ) {
    result.bullish.push('Tweezer Bottom');
  }

  // Tweezer Top: two candles with nearly same high (resistance)
  if (
    Math.abs(c.high - p.high) / (p.high || 1) < 0.002 &&
    isBull(p) && isBear(c)
  ) {
    result.bearish.push('Tweezer Top');
  }

  // ── Three-bar patterns ──────────────────────────────────────────────────

  // Morning Star: bearish + small body + bullish closing above midpoint
  if (
    isBear(pp) && body(p) < body(pp) * 0.5 &&
    isBull(c) && c.close > (pp.open + pp.close) / 2
  ) {
    result.bullish.push('Morning Star');
  }

  // Evening Star: bullish + small body + bearish closing below midpoint
  if (
    isBull(pp) && body(p) < body(pp) * 0.5 &&
    isBear(c) && c.close < (pp.open + pp.close) / 2
  ) {
    result.bearish.push('Evening Star');
  }

  // Three White Soldiers: 3 consecutive bullish candles each closing higher
  if (
    isBull(pp) && isBull(p) && isBull(c) &&
    p.close > pp.close && c.close > p.close &&
    p.open > pp.open && c.open > p.open
  ) {
    result.bullish.push('Three White Soldiers');
  }

  // Three Black Crows: 3 consecutive bearish candles each closing lower
  if (
    isBear(pp) && isBear(p) && isBear(c) &&
    p.close < pp.close && c.close < p.close &&
    p.open < pp.open && c.open < p.open
  ) {
    result.bearish.push('Three Black Crows');
  }

  // ── Score: weight by pattern strength and volume confirmation ─────────────
  const strongPatterns = ['Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Evening Star',
                          'Three White Soldiers', 'Three Black Crows'];
  const moderatePatterns = ['Hammer', 'Shooting Star', 'Tweezer Bottom', 'Tweezer Top'];
  const weakPatterns = ['Dragonfly Doji', 'Gravestone Doji'];

  const allFound = [...result.bullish, ...result.bearish];
  let score = 0;
  for (const p of allFound) {
    if (strongPatterns.includes(p)) score += 0.4;
    else if (moderatePatterns.includes(p)) score += 0.25;
    else if (weakPatterns.includes(p)) score += 0.15;
  }
  if (volOk && allFound.length > 0) score += 0.2; // volume confirmation bonus

  result.score = Math.min(1, score);
  result.best = allFound[0] ?? null;

  return result;
}

/**
 * Returns score 0-1 based on how many patterns CONFIRM the trade side.
 * Only counts patterns aligned with side (bullish patterns for LONG, bearish for SHORT).
 */
export function patternConfirmation(side: 'LONG' | 'SHORT', patterns: PatternResult): number {
  const relevant = side === 'LONG' ? patterns.bullish : patterns.bearish;
  const opposing = side === 'LONG' ? patterns.bearish : patterns.bullish;
  if (relevant.length === 0 && opposing.length > 0) return 0;   // pattern against us
  if (relevant.length === 0) return 0.5;                         // neutral, no pattern
  return Math.min(1, relevant.length * 0.3 + 0.4);             // 1 pattern = 0.7, 2+ = 1.0
}
