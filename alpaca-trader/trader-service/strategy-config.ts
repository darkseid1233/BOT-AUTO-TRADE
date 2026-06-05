/**
 * Strategy Config — single source of truth for ALL thresholds and scoring weights.
 *
 * Inspired by bcj2023 (env.ts + coin-tuning.ts) and adapted to the Alpaca bot.
 * EVERY tunable lives here, overridable via environment variables, so the strategy
 * can be re-tuned WITHOUT touching code (requirement #9).
 *
 * Three layers:
 *   1. GATES      — hard filters that reject a signal (regime, ADX, chop, volume, R:R…)
 *   2. WEIGHTS    — the Weighted Scoring System (7 factors → Signal Quality 0-100)
 *   3. PER-COIN   — per-symbol overrides (size, SL/TP, min-quality) like coin-tuning.ts
 */

/** Read a numeric env var; falls back when empty/invalid (Number('') === 0 trap fixed). */
export function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** Read a boolean env var ('true'/'false'). */
export function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Weighted Scoring System weights — the 7 factors of Signal Quality (0-100).
 * Sum of all weights should equal 100. Each factor returns 0..1 internally and
 * is multiplied by its weight, so the final Signal Quality Score is bounded 0-100.
 */
export type ScoreWeights = {
  /** Trend Strength — ADX + EMA stack alignment. */
  trendStrength: number;
  /** Market Structure — Smart Money (BOS / HH-HL / LH-LL). */
  marketStructure: number;
  /** Volume Confirmation — relative volume vs 20-bar average. */
  volume: number;
  /** Momentum — RSI / MACD / StochRSI aligned WITH the trade direction. */
  momentum: number;
  /** Volatility — ATR regime quality (NORMAL ideal, penalised when LOW/HIGH). */
  volatility: number;
  /** BTC Correlation — does BTC's direction support the trade. */
  btcCorrelation: number;
  /** Higher Timeframe Alignment — 1H EMA/RSI/ADX confirming the 15m side. */
  htfAlignment: number;
};

export type StrategyConfig = {
  // ── GATES ────────────────────────────────────────────────────────────────
  /** Minimum Signal Quality (0-100) required to open a trade. */
  minSignalQuality: number;
  /** ADX below this = no tradeable trend (RANGING). */
  adxTrendThreshold: number;
  /** ADX considered a strong trend (bonus). */
  adxStrongThreshold: number;
  /** EMA50 vs EMA200 minimum spread (%) to call a clear trend (avoids whipsaw). */
  emaTrendSpreadPct: number;
  /** Choppiness Index above this = RANGING (block). */
  chopRangingThreshold: number;
  /** Minimum relative volume (current/avg20) to confirm conviction. */
  minVolumeRatio: number;
  /** Minimum net Risk:Reward (after fees+slippage) to accept a setup. */
  minRiskReward: number;
  /** RSI above this blocks late LONGs; (100-x) blocks late SHORTs. */
  rsiLateEntryGuard: number;
  /** ATR volatility ratio above this = EXTREME → no trade. */
  extremeVolRatio: number;

  // ── RISK / EXITS ──────────────────────────────────────────────────────────
  atrSlMult: number;
  atrTpMult: number;
  /** Partial TP level 1 — close X% at 1R. */
  partialTpEnabled: boolean;
  partialTpL1R: number;
  partialTpL1ClosePct: number;
  partialTpL2R: number;
  partialTpL2ClosePct: number;
  /** Breakeven buffer (in R) applied to SL after L1 hit. */
  breakevenBufferR: number;
  /** Trailing-stop ATR multiplier (chandelier). */
  trailingAtrMult: number;
  /** Fee + slippage assumptions for net R:R and backtests. */
  takerFeePct: number;
  slippagePct: number;

  // ── WEIGHTS ───────────────────────────────────────────────────────────────
  weights: ScoreWeights;
};

/** Default config — quality-first, anti-ranging. Mirrors bcj2023 strict pillar. */
export function getStrategyConfig(): StrategyConfig {
  return {
    minSignalQuality:   readNumberEnv('MIN_SIGNAL_QUALITY', 70),
    adxTrendThreshold:  readNumberEnv('ADX_TREND_THRESHOLD', 22),
    adxStrongThreshold: readNumberEnv('ADX_STRONG_THRESHOLD', 30),
    emaTrendSpreadPct:  readNumberEnv('EMA_TREND_SPREAD_PCT', 0.1),
    chopRangingThreshold: readNumberEnv('CHOP_RANGING_THRESHOLD', 61.8),
    minVolumeRatio:     readNumberEnv('MIN_VOLUME_RATIO', 0.8),
    minRiskReward:      readNumberEnv('MIN_RR_NET', 1.8),
    rsiLateEntryGuard:  readNumberEnv('RSI_LATE_ENTRY_GUARD', 72),
    extremeVolRatio:    readNumberEnv('EXTREME_VOL_RATIO', 2.5),

    atrSlMult:          readNumberEnv('ATR_SL_MULTIPLIER', 1.8),
    atrTpMult:          readNumberEnv('ATR_TP_MULTIPLIER', 4.5),
    partialTpEnabled:   readBoolEnv('PARTIAL_TP_ENABLED', true),
    partialTpL1R:       readNumberEnv('PARTIAL_TP_L1_R', 1.0),
    partialTpL1ClosePct:readNumberEnv('PARTIAL_TP_L1_CLOSE', 30),
    partialTpL2R:       readNumberEnv('PARTIAL_TP_L2_R', 2.0),
    partialTpL2ClosePct:readNumberEnv('PARTIAL_TP_L2_CLOSE', 30),
    breakevenBufferR:   readNumberEnv('BREAKEVEN_BUFFER_R', 0.2),
    trailingAtrMult:    readNumberEnv('TRAILING_ATR_MULT', 2.0),
    takerFeePct:        readNumberEnv('TAKER_FEE_PCT', 0.0004),
    slippagePct:        readNumberEnv('SIMULATED_SLIPPAGE_PCT', 0.0005),

    weights: {
      trendStrength:   readNumberEnv('W_TREND_STRENGTH', 25),
      marketStructure: readNumberEnv('W_MARKET_STRUCTURE', 15),
      volume:          readNumberEnv('W_VOLUME', 15),
      momentum:        readNumberEnv('W_MOMENTUM', 10),
      volatility:      readNumberEnv('W_VOLATILITY', 5),
      btcCorrelation:  readNumberEnv('W_BTC_CORRELATION', 10),
      htfAlignment:    readNumberEnv('W_HTF_ALIGNMENT', 20),
    },
  };
}

/** Per-coin tuning (ported from bcj2023 coin-tuning.ts, mapped to Alpaca symbols). */
export type CoinTuning = {
  sizeMultiplier?: number;
  atrSlMult?: number;
  atrTpMult?: number;
  minSignalQuality?: number;
  skip?: boolean;
  note?: string;
};

export const COIN_TUNING: Record<string, CoinTuning> = {
  'BTC/USD':   { minSignalQuality: 72, note: 'mega cap — quality > quantity' },
  'ETH/USD':   { minSignalQuality: 72, note: 'mega cap — quality > quantity' },
  'SOL/USD':   { note: 'standard params' },
  'LINK/USD':  { note: 'standard params' },
  'LTC/USD':   { note: 'standard params' },
  'AVAX/USD':  { sizeMultiplier: 0.8, note: 'L1 moderate vol' },
  'DOGE/USD':  { sizeMultiplier: 0.5, minSignalQuality: 75, note: 'meme — half size' },
  'MATIC/USD': { sizeMultiplier: 0.8, note: 'L2 moderate vol' },
};

/** Effective tuning for a symbol (empty object if none). */
export function getTuning(symbol: string): CoinTuning {
  return COIN_TUNING[symbol] ?? {};
}

/** Apply per-coin size multiplier (clamped 0.05–1.0). */
export function applySizeMultiplier(baseSize: number, symbol: string): number {
  const t = getTuning(symbol);
  if (t.sizeMultiplier === undefined) return baseSize;
  return baseSize * Math.max(0.05, Math.min(1.0, t.sizeMultiplier));
}
