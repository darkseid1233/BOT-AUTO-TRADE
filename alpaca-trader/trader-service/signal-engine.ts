/**
 * Signal Engine v4 — Regime-First, Weighted-Quality, Multi-Timeframe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED vs v3 (and WHY)
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 problems fixed here (requirement #6):
 *  - RSI/BB/StochRSI were scored as CONTRARIAN signals regardless of trend → it
 *    bought "oversold" in downtrends and sold "overbought" in uptrends. v4 picks
 *    the side from the REGIME first, then only counts momentum that CONFIRMS it.
 *  - Scoring was "count points / 12" — flat and unweighted. v4 uses a Weighted
 *    Scoring System producing a Signal Quality Score 0-100 (requirement #7/#8).
 *  - HTF was "pending" — never truly confirmed in the score. v4 confirms 1H.
 *  - No real BTC market-state gate. v4 hard-blocks strong opposing BTC + scores it.
 *  - Everything tunable lives in strategy-config.ts (requirement #9).
 *
 * FLOW (each gate can reject → NEUTRAL):
 *   1. Regime Filter   → decides the ONLY allowed side (or NEUTRAL)
 *   2. Volume Gate     → min relative volume
 *   3. RSI late-entry  → don't chase exhausted moves
 *   4. BTC State       → strong opposing BTC blocks the trade
 *   5. HTF 1H          → confirm / penalise
 *   6. Quality Score   → weighted 0-100, must clear min-quality gate
 *   7. Net R:R         → after fees + slippage
 */
import {
  ema, sma, rsi, atr, macd, bollingerBands, stochRsi, volumeRatio,
} from './indicators.js';
import { getVolatilityRegime } from './volatility-regime.js';
import { analyzeSmartMoney } from './smart-money.js';
import { detectRegime, type Bar } from './market-regime.js';
import { analyzeBtcState, type BtcState } from './btc-state.js';
import { confirmHtf } from './htf-confirm.js';
import { computeSignalQuality } from './signal-quality.js';
import { getStrategyConfig, getTuning } from './strategy-config.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal } from './types.js';
import { log } from './logger.js';
import { recordGate, gateFromReason } from './scan-stats.js';

/**
 * Generate a Signal for one symbol using the v4 regime-first engine.
 * @param symbol Alpaca crypto symbol (e.g. "BTC/USD")
 * @param client AlpacaClient for fetching bars
 * @param btcStateOverride pre-fetched BTC state (avoids one fetch per symbol)
 * @returns Signal (NEUTRAL when any gate rejects)
 */
export async function generateSignal(
  symbol: string,
  client: AlpacaClient,
  btcStateOverride?: BtcState,
): Promise<Signal> {
  const cfg = getStrategyConfig();
  const tuning = getTuning(symbol);
  const minQuality = Math.max(cfg.minSignalQuality, tuning.minSignalQuality ?? 0);

  // Respect per-coin skip flag (e.g. delisted symbols) so we never trade on
  // synthetic fallback data without the operator knowing.
  if (tuning.skip) {
    return neutralSignal(symbol, 0, [`${symbol} skipped — ${tuning.note ?? 'disabled in coin tuning'}`]);
  }

  const bars = (await client.getCryptoBars(symbol, '15Min', 250)) as Bar[];
  if (bars.length < 205) {
    recordGate('insufficientBars');
    return neutralSignal(symbol, bars[bars.length - 1]?.close ?? 0, ['Insufficient bars']);
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const price = closes[closes.length - 1];

  // ── 1. Market Regime → allowed side ────────────────────────────────────────
  const regime = detectRegime(bars, cfg);
  if (regime.allowedSide === 'NEUTRAL') {
    recordGate('regime');
    return neutralSignal(symbol, price, [regime.reason], snapshot(bars, regime.adx));
  }
  const side = regime.allowedSide;

  // ── 2. Volume Gate ─────────────────────────────────────────────────────────
  const volRatio = volumeRatio(volumes, 20);
  if (volRatio < cfg.minVolumeRatio) {
    recordGate('volume');
    return neutralSignal(symbol, price, [`Volume ${volRatio.toFixed(2)}x < ${cfg.minVolumeRatio}`], snapshot(bars, regime.adx));
  }

  // ── 3. RSI late-entry guard ────────────────────────────────────────────────
  const rsiVal = regime.rsi;
  if (side === 'LONG' && rsiVal > cfg.rsiLateEntryGuard) {
    recordGate('rsiLateEntry');
    return neutralSignal(symbol, price, [`RSI ${rsiVal.toFixed(0)} > ${cfg.rsiLateEntryGuard} — late LONG`], snapshot(bars, regime.adx));
  }
  if (side === 'SHORT' && rsiVal < 100 - cfg.rsiLateEntryGuard) {
    recordGate('rsiLateEntry');
    return neutralSignal(symbol, price, [`RSI ${rsiVal.toFixed(0)} < ${100 - cfg.rsiLateEntryGuard} — late SHORT`], snapshot(bars, regime.adx));
  }

  // ── 4. BTC Market State ────────────────────────────────────────────────────
  const btc = symbol === 'BTC/USD'
    ? ({ direction: side === 'LONG' ? 'bullish' : 'bearish', strength: 'moderate', ema50: 0, ema200: 0, rsi: 50, adx: 0, label: 'BTC self' } as BtcState)
    : (btcStateOverride ?? await analyzeBtcState(client));
  const btcOpposesStrong =
    (side === 'LONG' && btc.direction === 'bearish' && btc.strength === 'strong') ||
    (side === 'SHORT' && btc.direction === 'bullish' && btc.strength === 'strong');
  if (btcOpposesStrong) {
    recordGate('btcOpposing');
    return neutralSignal(symbol, price, [`${btc.label} — strong opposing macro, ${side} blocked`], snapshot(bars, regime.adx));
  }

  // ── 5. HTF 1H confirmation ─────────────────────────────────────────────────
  const htf = symbol === 'BTC/USD'
    ? { trend: side === 'LONG' ? 'bullish' as const : 'bearish' as const, aligned: true, opposed: false, ema50: 0, ema200: 0, rsi: 50, adx: 0 }
    : await confirmHtf(symbol, side, client);

  // ── Indicators for scoring + SL/TP ─────────────────────────────────────────
  const ema20 = ema(closes, 20);
  const ema50 = regime.ema50;
  const ema200 = regime.ema200;
  const smaVal = sma(closes, 50);
  const atrVal = atr(bars, 14);
  const macdData = macd(closes);
  const bbands = bollingerBands(closes);
  const srsi = stochRsi(closes);
  const volRegime = getVolatilityRegime(bars.map((b) => b.high), bars.map((b) => b.low), closes);
  const smc = analyzeSmartMoney(bars.slice(-60).map((b) => ({ ...b })));

  const emaStackAligned =
    side === 'LONG' ? ema20 > ema50 && ema50 > ema200 : ema20 < ema50 && ema50 < ema200;

  // ── 6. Weighted Signal Quality Score (0-100) ───────────────────────────────
  const quality = computeSignalQuality({
    side, regime: regime.regime, adx: regime.adx, emaStackAligned,
    volumeRatio: volRatio, rsi: rsiVal, macdHistogram: macdData.histogram, stochRsi: srsi,
    volState: volRegime.state, btc, htf, smc, cfg,
  });

  if (quality.score < minQuality) {
    recordGate('quality');
    return neutralSignal(symbol, price,
      [`Signal Quality ${quality.score} < ${minQuality}${tuning.minSignalQuality ? ' (coin override)' : ''}`],
      snapshot(bars, regime.adx, { rsiVal, ema20, ema50, ema200, smaVal, atrVal, mom: 0, macdData, srsi, bbands, volRatio }));
  }

  // ── 7. SL / TP + net R:R ───────────────────────────────────────────────────
  const atrSl = tuning.atrSlMult ?? cfg.atrSlMult;
  const atrTp = tuning.atrTpMult ?? cfg.atrTpMult;
  const slDist = atrVal * atrSl;
  const tpDist = atrVal * atrTp;
  if (slDist <= 0) {
    return neutralSignal(symbol, price, ['ATR=0 — invalid setup']);
  }
  const entry = price;
  const stopLoss = side === 'LONG' ? entry - slDist : entry + slDist;
  const takeProfit = side === 'LONG' ? entry + tpDist : entry - tpDist;

  // Net R:R after round-trip fees + slippage (the gate that actually matters).
  const roundTripCost = entry * (2 * cfg.takerFeePct + 2 * cfg.slippagePct);
  const netReward = Math.max(0, tpDist - roundTripCost);
  const netRisk = slDist + roundTripCost;
  const netRR = netRisk > 0 ? netReward / netRisk : 0;
  if (netRR < cfg.minRiskReward) {
    recordGate('riskReward');
    return neutralSignal(symbol, price, [`Net R:R ${netRR.toFixed(2)} < ${cfg.minRiskReward} (ATR too small)`]);
  }

  log.info(`[signal-v4] ${symbol} ${side} quality=${quality.score} regime=${regime.regime} ADX=${regime.adx.toFixed(1)} CHOP=${regime.chop.toFixed(1)} vol=${volRatio.toFixed(1)}x BTC=${btc.direction} HTF=${htf.trend} netRR=${netRR.toFixed(2)}`);

  return {
    symbol,
    side,
    confidence: quality.score,
    qualityScore: quality.score,
    qualityFactors: quality.factors,
    price,
    entry,
    stopLoss,
    takeProfit,
    riskReward: parseFloat(netRR.toFixed(2)),
    reasons: [regime.reason, ...quality.reasons],
    blocked: [],
    marketRegime: regime.regime,
    chopValue: regime.chop,
    smcBull: smc.smcScore.bull,
    smcBear: smc.smcScore.bear,
    btcState: btc.direction,
    trend1h: htf.trend,
    indicators: {
      rsi: round(rsiVal), ema20: round(ema20, 4), ema50: round(ema50, 4), ema200: round(ema200, 4),
      sma: round(smaVal, 4), atr: round(atrVal, 4), momentum: 0, adx: round(regime.adx),
      macdHistogram: round(macdData.histogram, 4), stochRsi: round(srsi),
      bollingerPct: round(bbands.pct, 3), volRatio: round(volRatio),
    },
    timestamp: Date.now(),
  };
}

function round(n: number, d = 2): number { return parseFloat(n.toFixed(d)); }

/** Minimal indicator snapshot for NEUTRAL signals. */
function snapshot(bars: Bar[], adxVal: number, extra?: {
  rsiVal: number; ema20: number; ema50: number; ema200: number; smaVal: number;
  atrVal: number; mom: number; macdData: { histogram: number }; srsi: number;
  bbands: { pct: number }; volRatio: number;
}): Signal['indicators'] {
  if (extra) {
    return {
      rsi: round(extra.rsiVal), ema20: round(extra.ema20, 4), ema50: round(extra.ema50, 4),
      ema200: round(extra.ema200, 4), sma: round(extra.smaVal, 4), atr: round(extra.atrVal, 4),
      momentum: 0, adx: round(adxVal), macdHistogram: round(extra.macdData.histogram, 4),
      stochRsi: round(extra.srsi), bollingerPct: round(extra.bbands.pct, 3), volRatio: round(extra.volRatio),
    };
  }
  const closes = bars.map((b) => b.close);
  return {
    rsi: round(rsi(closes)), ema20: round(ema(closes, 20), 4), ema50: round(ema(closes, 50), 4),
    ema200: round(ema(closes, Math.min(200, closes.length)), 4), sma: round(sma(closes, 50), 4),
    atr: round(atr(bars, 14), 4), momentum: 0, adx: round(adxVal),
    macdHistogram: round(macd(closes).histogram, 4), stochRsi: round(stochRsi(closes)),
    bollingerPct: round(bollingerBands(closes).pct, 3), volRatio: round(volumeRatio(bars.map((b) => b.volume), 20)),
  };
}

/** Build a NEUTRAL signal with an optional indicator snapshot. */
function neutralSignal(symbol: string, price: number, blocked: string[], indicators?: Signal['indicators']): Signal {
  return {
    symbol, side: 'NEUTRAL', confidence: 0, qualityScore: 0, price, entry: price,
    stopLoss: 0, takeProfit: 0, riskReward: 0, reasons: [], blocked,
    marketRegime: 'RANGING', chopValue: undefined, smcBull: undefined, smcBear: undefined,
    btcState: undefined, trend1h: undefined,
    indicators: indicators ?? {
      rsi: 50, ema20: 0, ema50: 0, ema200: 0, sma: 0, atr: 0, momentum: 0,
      adx: 0, macdHistogram: 0, stochRsi: 50, bollingerPct: 0.5, volRatio: 1,
    },
    timestamp: Date.now(),
  };
}

/** Signal Engine class wrapping the v4 generator for the bot. */
export class SignalEngine {
  constructor(private client: AlpacaClient) {}

  /**
   * Generate signals for a list of symbols. BTC state is fetched ONCE and shared,
   * avoiding one redundant 1H fetch per symbol.
   * @param symbols list of Alpaca crypto symbols
   * @returns array of Signals (NEUTRAL when blocked)
   */
  async generateSignals(symbols: string[]): Promise<Signal[]> {
    const btc = await analyzeBtcState(this.client).catch(() => undefined);
    const results = await Promise.allSettled(
      symbols.map((s) => generateSignal(s, this.client, btc)),
    );
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      log.warn(`[signal] ${symbols[i]} error: ${r.reason}`);
      return neutralSignal(symbols[i], 0, [`Error: ${String(r.reason)}`]);
    });
  }
}
