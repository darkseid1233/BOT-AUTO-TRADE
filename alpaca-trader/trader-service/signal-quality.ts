/**
 * Signal Quality Score (0-100) — the Weighted Scoring System.
 *
 * Replaces the old naive "count points out of 12" scoring. Each of the 7 factors
 * returns a normalised 0..1 sub-score, multiplied by its configurable weight. The
 * sum is bounded 0-100 and is the single number used to rank and gate trades.
 *
 * Factors (requirement #8):
 *   1. Trend Strength       — ADX + EMA stack alignment with the side
 *   2. Market Structure     — Smart Money (BOS + structure) for the side
 *   3. Volume Confirmation  — relative volume vs 20-bar average
 *   4. Momentum             — RSI + MACD + StochRSI aligned WITH the side
 *   5. Volatility           — ATR regime quality (NORMAL ideal)
 *   6. BTC Correlation      — BTC macro state supporting the side
 *   7. HTF Alignment        — 1H trend confirming the side
 *
 * CRITICAL FIX vs old code: every momentum/structure factor is scored ONLY in the
 * trade direction dictated by the regime. RSI oversold adds to quality for a LONG
 * (pullback in an uptrend) but is IGNORED — never used to fade — against the trend.
 */
import type { ScoreWeights, StrategyConfig } from './strategy-config.js';
import type { MarketRegime } from './market-regime.js';
import type { BtcState } from './btc-state.js';
import type { HtfResult } from './htf-confirm.js';
import type { SmartMoneyAnalysis } from './smart-money.js';

export type QualityInputs = {
  side: 'LONG' | 'SHORT';
  regime: MarketRegime;
  adx: number;
  emaStackAligned: boolean;      // 20>50>200 (LONG) or 20<50<200 (SHORT)
  volumeRatio: number;
  rsi: number;
  macdHistogram: number;
  stochRsi: number;
  volState: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  btc: BtcState;
  htf: HtfResult;
  smc: SmartMoneyAnalysis;
  cfg: StrategyConfig;
};

export type QualityBreakdown = {
  /** Final 0-100 score. */
  score: number;
  /** Per-factor 0..1 contributions (before weighting) for transparency/journaling. */
  factors: Record<keyof ScoreWeights, number>;
  /** Per-factor weighted points. */
  points: Record<keyof ScoreWeights, number>;
  reasons: string[];
};

/** Clamp helper. */
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Compute the Signal Quality Score 0-100 from the weighted factors.
 * @param i all signal inputs + config
 * @returns the score and a full breakdown for the trade journal
 */
export function computeSignalQuality(i: QualityInputs): QualityBreakdown {
  const w = i.cfg.weights;
  const reasons: string[] = [];

  // ── 1. Trend Strength (ADX scaled + EMA stack) ─────────────────────────────
  // ADX 22→0.5, 30→0.8, 40+→1.0; +0.2 bonus when EMA stack aligned.
  const adxNorm = clamp01((i.adx - i.cfg.adxTrendThreshold) / (45 - i.cfg.adxTrendThreshold));
  let trendStrength = clamp01(0.5 + adxNorm * 0.5);
  if (i.emaStackAligned) { trendStrength = clamp01(trendStrength + 0.2); reasons.push('EMA stack aligned'); }
  if (i.adx >= i.cfg.adxStrongThreshold) reasons.push(`Strong ADX ${i.adx.toFixed(0)}`);

  // ── 2. Market Structure (Smart Money) ──────────────────────────────────────
  const structAligned = i.side === 'LONG' ? i.smc.structure === 'bullish' : i.smc.structure === 'bearish';
  const sweepAligned = i.side === 'LONG' ? i.smc.liquiditySweep === 'bullish' : i.smc.liquiditySweep === 'bearish';
  let marketStructure = 0;
  if (i.smc.bos && structAligned) { marketStructure = 1.0; reasons.push('BOS + structure aligned'); }
  else if (structAligned) { marketStructure = 0.6; reasons.push('Structure aligned'); }
  else if (i.smc.bos) marketStructure = 0.3;
  if (sweepAligned) { marketStructure = clamp01(marketStructure + 0.2); reasons.push('Liquidity sweep aligned'); }
  if (i.smc.choch) { marketStructure = clamp01(marketStructure - 0.3); reasons.push('CHoCH warning'); }

  // ── 3. Volume Confirmation ─────────────────────────────────────────────────
  // 0.8→0.3, 1.0→0.5, 1.5→0.8, 2.0+→1.0
  let volume = 0;
  if (i.volumeRatio >= 2.0) { volume = 1.0; reasons.push(`Volume ${i.volumeRatio.toFixed(1)}x`); }
  else if (i.volumeRatio >= 1.5) { volume = 0.8; reasons.push(`Volume ${i.volumeRatio.toFixed(1)}x`); }
  else if (i.volumeRatio >= 1.0) volume = 0.5;
  else if (i.volumeRatio >= i.cfg.minVolumeRatio) volume = 0.3;

  // ── 4. Momentum (direction-aware ONLY) ─────────────────────────────────────
  // Each sub-signal counts ONLY when it confirms the side. Never contrarian.
  let mom = 0;
  if (i.side === 'LONG') {
    if (i.macdHistogram > 0) mom += 0.4;
    if (i.rsi > 50 && i.rsi < i.cfg.rsiLateEntryGuard) mom += 0.3;   // momentum up, not yet overbought
    if (i.stochRsi > 20 && i.stochRsi < 80) mom += 0.3;             // turning up, room to run
  } else {
    if (i.macdHistogram < 0) mom += 0.4;
    if (i.rsi < 50 && i.rsi > (100 - i.cfg.rsiLateEntryGuard)) mom += 0.3;
    if (i.stochRsi < 80 && i.stochRsi > 20) mom += 0.3;
  }
  const momentum = clamp01(mom);
  if (momentum >= 0.7) reasons.push('Momentum aligned');

  // ── 5. Volatility quality ──────────────────────────────────────────────────
  const volatility =
    i.volState === 'NORMAL' ? 1.0 :
    i.volState === 'LOW' ? 0.4 :
    i.volState === 'HIGH' ? 0.5 : 0; // EXTREME shouldn't reach here (gated), 0 anyway

  // ── 6. BTC Correlation ─────────────────────────────────────────────────────
  let btcCorrelation = 0.5; // neutral baseline = partial credit
  const btcSupports = (i.side === 'LONG' && i.btc.direction === 'bullish') ||
                      (i.side === 'SHORT' && i.btc.direction === 'bearish');
  const btcOpposes = (i.side === 'LONG' && i.btc.direction === 'bearish') ||
                     (i.side === 'SHORT' && i.btc.direction === 'bullish');
  if (btcSupports) { btcCorrelation = i.btc.strength === 'strong' ? 1.0 : 0.85; reasons.push('BTC aligned'); }
  else if (btcOpposes) { btcCorrelation = i.btc.strength === 'strong' ? 0.0 : 0.25; reasons.push('BTC opposing'); }

  // ── 7. HTF Alignment ───────────────────────────────────────────────────────
  let htfAlignment = 0.5; // neutral HTF = partial credit (non-blocking)
  if (i.htf.aligned) { htfAlignment = 1.0; reasons.push('HTF 1H aligned'); }
  else if (i.htf.opposed) { htfAlignment = 0.1; reasons.push('HTF 1H opposed'); }

  const factors: Record<keyof ScoreWeights, number> = {
    trendStrength, marketStructure, volume, momentum, volatility, btcCorrelation, htfAlignment,
  };
  const points: Record<keyof ScoreWeights, number> = {
    trendStrength:   factors.trendStrength * w.trendStrength,
    marketStructure: factors.marketStructure * w.marketStructure,
    volume:          factors.volume * w.volume,
    momentum:        factors.momentum * w.momentum,
    volatility:      factors.volatility * w.volatility,
    btcCorrelation:  factors.btcCorrelation * w.btcCorrelation,
    htfAlignment:    factors.htfAlignment * w.htfAlignment,
  };

  const score = Math.round(
    Math.max(0, Math.min(100, Object.values(points).reduce((a, b) => a + b, 0))),
  );

  return { score, factors, points, reasons };
}
