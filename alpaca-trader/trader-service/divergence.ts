/**
 * RSI & MACD Divergence Detector.
 *
 * Divergence is one of the HIGHEST-value signals in technical analysis.
 * Top bots (Freqtrade NostalgiaForInfinity, Jesse-AI advanced strategies) all
 * detect divergence as a primary entry/exit condition.
 *
 * Types:
 *  Regular Bullish  — price makes lower low, RSI makes higher low  → reversal up
 *  Regular Bearish  — price makes higher high, RSI makes lower high → reversal down
 *  Hidden Bullish   — price makes higher low,  RSI makes lower low  → trend continuation up
 *  Hidden Bearish   — price makes lower high,  RSI makes higher high → trend continuation down
 *
 * MACD histogram divergence is also computed (more leading than RSI divergence).
 *
 * Zero look-ahead: we only compare the LAST swing to the PREVIOUS swing,
 * both of which must be fully confirmed (left-right pivot confirmed).
 */

export type DivergenceType = 'regular_bullish' | 'regular_bearish' | 'hidden_bullish' | 'hidden_bearish';

export type DivergenceResult = {
  rsi: {
    type: DivergenceType | null;
    strength: number; // 0-1: how clear the divergence is
    priceSwingPct: number;
    indicatorSwingPct: number;
  };
  macd: {
    type: DivergenceType | null;
    strength: number;
  };
  /** Combined divergence score 0-1 for signal quality */
  score: number;
};

import { rsi as calcRsi, macd as calcMacd } from './indicators.js';

type Bar = { close: number; high: number; low: number };

/**
 * Find the last N pivot highs/lows using a simple left-right confirmation window.
 * @param values price series (oldest first)
 * @param window bars to look left + right for confirmation (default 3)
 */
function findPivots(
  values: number[],
  window = 3,
  type: 'high' | 'low',
): Array<{ index: number; value: number }> {
  const pivots: Array<{ index: number; value: number }> = [];
  for (let i = window; i < values.length - window; i++) {
    const slice = values.slice(i - window, i + window + 1);
    const val = values[i];
    const isExtreme = type === 'high'
      ? slice.every((v) => v <= val)
      : slice.every((v) => v >= val);
    if (isExtreme) pivots.push({ index: i, value: val });
  }
  return pivots;
}

/**
 * Detect RSI and MACD divergence on the last N bars.
 * @param bars OHLC bars (oldest first)
 * @param lookback bars to search for pivots (default 50)
 * @returns DivergenceResult
 */
export function detectDivergence(bars: Bar[], lookback = 50): DivergenceResult {
  const neutral: DivergenceResult = {
    rsi: { type: null, strength: 0, priceSwingPct: 0, indicatorSwingPct: 0 },
    macd: { type: null, strength: 0 },
    score: 0,
  };

  if (bars.length < 60) return neutral;

  const slice = bars.slice(-lookback);
  const closes = slice.map((b) => b.close);
  const highs = slice.map((b) => b.high);
  const lows = slice.map((b) => b.low);

  // ── Compute RSI series for the slice ─────────────────────────────────────
  const rsiSeries: number[] = [];
  for (let i = 14; i <= closes.length; i++) {
    rsiSeries.push(calcRsi(closes.slice(0, i)));
  }
  const rsiPad = Array(14).fill(50);
  const rsiAligned = [...rsiPad, ...rsiSeries].slice(-lookback);

  // ── Compute MACD histogram series ────────────────────────────────────────
  const macdHistSeries: number[] = [];
  for (let i = 35; i <= closes.length; i++) {
    macdHistSeries.push(calcMacd(closes.slice(0, i)).histogram);
  }
  const macdPad = Array(35).fill(0);
  const macdAligned = [...macdPad, ...macdHistSeries].slice(-lookback);

  // ── Find price pivots ────────────────────────────────────────────────────
  const priceHighs = findPivots(highs, 3, 'high').slice(-3);
  const priceLows = findPivots(lows, 3, 'low').slice(-3);

  // ── RSI Divergence: compare last 2 price pivots to last 2 RSI pivots ────
  let rsiType: DivergenceType | null = null;
  let rsiStrength = 0;
  let priceSwingPct = 0;
  let rsiSwingPct = 0;

  if (priceLows.length >= 2) {
    const [prev, last] = priceLows.slice(-2);
    const prevRsi = rsiAligned[prev.index] ?? 50;
    const lastRsi = rsiAligned[last.index] ?? 50;
    // Regular bullish: price LL + RSI HL
    if (last.value < prev.value && lastRsi > prevRsi) {
      priceSwingPct = Math.abs((last.value - prev.value) / prev.value) * 100;
      rsiSwingPct = Math.abs(lastRsi - prevRsi);
      rsiType = 'regular_bullish';
      rsiStrength = Math.min(1, (priceSwingPct / 2) * (rsiSwingPct / 10));
    }
    // Hidden bullish: price HL + RSI LL
    else if (last.value > prev.value && lastRsi < prevRsi) {
      rsiType = 'hidden_bullish';
      rsiStrength = 0.6;
    }
  }

  if (priceHighs.length >= 2) {
    const [prev, last] = priceHighs.slice(-2);
    const prevRsi = rsiAligned[prev.index] ?? 50;
    const lastRsi = rsiAligned[last.index] ?? 50;
    // Regular bearish: price HH + RSI LH
    if (last.value > prev.value && lastRsi < prevRsi) {
      priceSwingPct = Math.abs((last.value - prev.value) / prev.value) * 100;
      rsiSwingPct = Math.abs(prevRsi - lastRsi);
      rsiType = 'regular_bearish';
      rsiStrength = Math.min(1, (priceSwingPct / 2) * (rsiSwingPct / 10));
    }
    // Hidden bearish: price LH + RSI HH
    else if (last.value < prev.value && lastRsi > prevRsi) {
      rsiType = 'hidden_bearish';
      rsiStrength = 0.6;
    }
  }

  // ── MACD Divergence (simpler — just last 20 bars) ─────────────────────
  let macdType: DivergenceType | null = null;
  let macdStrength = 0;
  const recentMacd = macdAligned.slice(-20);
  const recentClose = closes.slice(-20);
  const macdHighs = findPivots(recentMacd, 2, 'high');
  const macdLows = findPivots(recentMacd, 2, 'low');

  if (macdLows.length >= 2) {
    const [pm, lm] = macdLows.slice(-2);
    const pc = recentClose[pm.index] ?? 0;
    const lc = recentClose[lm.index] ?? 0;
    if (lc < pc && lm.value > pm.value) { macdType = 'regular_bullish'; macdStrength = 0.7; }
  }
  if (macdHighs.length >= 2) {
    const [pm, lm] = macdHighs.slice(-2);
    const pc = recentClose[pm.index] ?? 0;
    const lc = recentClose[lm.index] ?? 0;
    if (lc > pc && lm.value < pm.value) { macdType = 'regular_bearish'; macdStrength = 0.7; }
  }

  const score = Math.min(1, rsiStrength * 0.6 + macdStrength * 0.4);

  return {
    rsi: { type: rsiType, strength: rsiStrength, priceSwingPct, indicatorSwingPct: rsiSwingPct },
    macd: { type: macdType, strength: macdStrength },
    score,
  };
}

/**
 * Returns true when the detected divergence CONFIRMS the trade side.
 * Regular bullish → confirms LONG; Regular bearish → confirms SHORT.
 * Hidden divergence also confirms trend continuation.
 */
export function divergenceConfirms(side: 'LONG' | 'SHORT', div: DivergenceResult): boolean {
  const bullishTypes: DivergenceType[] = ['regular_bullish', 'hidden_bullish'];
  const bearishTypes: DivergenceType[] = ['regular_bearish', 'hidden_bearish'];
  if (side === 'LONG') {
    return bullishTypes.includes(div.rsi.type as DivergenceType) ||
           bullishTypes.includes(div.macd.type as DivergenceType);
  }
  return bearishTypes.includes(div.rsi.type as DivergenceType) ||
         bearishTypes.includes(div.macd.type as DivergenceType);
}
