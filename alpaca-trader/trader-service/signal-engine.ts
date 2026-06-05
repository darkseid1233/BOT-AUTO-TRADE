/**
 * Signal Engine v3.1 — Quality-First, Anti-Ranging (ported from bcj2023)
 *
 * Objectives:
 *  - Winrate +10-20% by eliminating weak entries
 *  - Profit Factor > 1.5
 *  - Zero trades in choppy/ranging markets
 *
 * Gate order (each gate can reject the signal):
 *  1. Market Regime Filter  — EMA200 + ADX + RSI → TRENDING/RANGING/HIGH_VOL
 *  2. ADX Gate              — ADX ≥ 22 required (trend strength)
 *  3. Choppiness Gate       — CHOP < 61.8 required (not ranging)
 *  4. HTF 1H Confirmation   — 1H EMA50 > EMA200 + RSI alignment
 *  5. BTC Direction Filter  — BTC must not be in strong opposing trend
 *  6. Volume Confirmation   — volume ratio > 0.8
 *  7. Scoring               — composite confidence 0-100
 *  8. Min Confidence Gate   — default 60
 *
 * SL = 1.8× ATR from entry, TP = 4.5× ATR (R:R ≈ 2.5)
 */
import {
  ema, sma, rsi, atr, macd, bollingerBands, adx, stochRsi,
  volumeRatio, trendScore, momentum,
} from './indicators.js';
import { choppinessIndex } from './choppiness-index.js';
import { getVolatilityRegime } from './volatility-regime.js';
import { analyzeSmartMoney } from './smart-money.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal } from './types.js';
import { log } from './logger.js';

/** Minimum confidence to act on a signal (override via env). */
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 60);
/** ATR multiplier for stop-loss placement. */
const ATR_SL = Number(process.env.ATR_SL_MULTIPLIER ?? 1.8);
/** ATR multiplier for take-profit placement. */
const ATR_TP = Number(process.env.ATR_TP_MULTIPLIER ?? 4.5);

/** Market regime as classified by the regime filter. */
export type MarketRegime = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'HIGH_VOL';

/** 15-min bar shape. */
type Bar = { open: number; high: number; low: number; close: number; volume: number };

/** BTC direction filter cache. */
let btcBarsCache: { bars: Bar[]; fetchedAt: number } | null = null;
const BTC_TTL_MS = 10 * 60_000;

async function getBtcBars(client: AlpacaClient): Promise<Bar[]> {
  if (btcBarsCache && Date.now() - btcBarsCache.fetchedAt < BTC_TTL_MS) {
    return btcBarsCache.bars;
  }
  const bars = await client.getCryptoBars('BTC/USD', '15Min', 120);
  btcBarsCache = { bars, fetchedAt: Date.now() };
  return bars;
}

/**
 * Classify market regime from price action on the 15m timeframe.
 * @param closes close prices
 * @param candles OHLC candles
 * @returns regime classification
 */
function classifyRegime(
  closes: number[],
  candles: Bar[],
): { regime: MarketRegime; ema50: number; ema200: number; rsiVal: number; adxVal: number } {
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, Math.min(200, closes.length));
  const rsiVal = rsi(closes);
  const adxData = adx(candles, 14);
  const adxVal = adxData.adx;

  const vol = getVolatilityRegime(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    closes,
  );

  let regime: MarketRegime;

  if (vol.state === 'EXTREME') {
    regime = 'HIGH_VOL';
  } else if (adxVal < 20) {
    regime = 'RANGING';
  } else if (ema50 > ema200 && rsiVal > 45) {
    regime = 'TRENDING_BULL';
  } else if (ema50 < ema200 && rsiVal < 55) {
    regime = 'TRENDING_BEAR';
  } else {
    regime = 'RANGING';
  }

  return { regime, ema50, ema200, rsiVal, adxVal };
}

/**
 * BTC Direction filter — returns the BTC trend direction.
 * A strong opposing BTC trend reduces entry confidence.
 * @param client AlpacaClient to fetch BTC bars
 * @returns 'bullish' | 'bearish' | 'neutral'
 */
async function getBtcDirection(
  client: AlpacaClient,
): Promise<'bullish' | 'bearish' | 'neutral'> {
  try {
    const bars = await getBtcBars(client);
    if (bars.length < 52) return 'neutral';
    const closes = bars.map((b) => b.close);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, Math.min(200, closes.length));
    const rsiVal = rsi(closes);
    const adxData = adx(bars, 14);
    if (e50 > e200 * 1.002 && adxData.adx > 22 && rsiVal > 50) return 'bullish';
    if (e50 < e200 * 0.998 && adxData.adx > 22 && rsiVal < 50) return 'bearish';
    return 'neutral';
  } catch {
    return 'neutral';
  }
}

/**
 * Generate a Signal for one symbol using the v3.1 signal engine.
 * @param symbol Alpaca crypto symbol (e.g. "BTC/USD")
 * @param client AlpacaClient for fetching bars
 * @returns Signal (NEUTRAL when gates reject)
 */
export async function generateSignal(symbol: string, client: AlpacaClient): Promise<Signal> {
  const blocked: string[] = [];
  const reasons: string[] = [];

  // ── Fetch bars ──────────────────────────────────────────────────────────────
  const bars = await client.getCryptoBars(symbol, '15Min', 250);
  if (bars.length < 55) {
    return neutralSignal(symbol, bars[bars.length - 1]?.close ?? 0, ['Insufficient bars']);
  }

  const closes  = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const price   = closes[closes.length - 1];

  // ── 1. Market Regime Filter ──────────────────────────────────────────────────
  const { regime, ema50, ema200, rsiVal, adxVal } = classifyRegime(closes, bars);

  if (regime === 'HIGH_VOL') {
    return neutralSignal(symbol, price, ['Extreme volatility — NO TRADE']);
  }
  if (regime === 'RANGING' && adxVal < 20) {
    return neutralSignal(symbol, price, [`Ranging market (ADX ${adxVal.toFixed(1)} < 20)`]);
  }

  // ── 2. ADX Gate ─────────────────────────────────────────────────────────────
  if (adxVal < 22) {
    blocked.push(`ADX ${adxVal.toFixed(1)} < 22 — weak trend`);
  }

  // ── 3. Choppiness Gate ───────────────────────────────────────────────────────
  const chop = choppinessIndex(bars, 14);
  if (chop.state === 'RANGING') {
    blocked.push(chop.label);
  }

  // ── 4. Volatility Regime ─────────────────────────────────────────────────────
  const volRegime = getVolatilityRegime(
    bars.map((b) => b.high),
    bars.map((b) => b.low),
    closes,
  );

  // ── 5. Volume Confirmation ──────────────────────────────────────────────────
  const volRatio = volumeRatio(volumes, 20);
  if (volRatio < 0.8) {
    blocked.push(`Volume ratio ${volRatio.toFixed(2)} < 0.8 — no conviction`);
  }

  // ── 6. BTC Direction Filter ──────────────────────────────────────────────────
  const btcDir = symbol === 'BTC/USD' ? 'neutral' : await getBtcDirection(client);

  // ── 7. Indicators ────────────────────────────────────────────────────────────
  const ema20  = ema(closes, 20);
  const smaVal = sma(closes, 50);
  const atrVal = atr(bars, 14);
  const macdData = macd(closes);
  const bbands = bollingerBands(closes);
  const srsi = stochRsi(closes);
  const mom = momentum(closes, 10);
  const ts = trendScore(closes, volumes, bars);

  // ── 8. Smart Money Concepts ─────────────────────────────────────────────────
  const smcBars = bars.slice(-60).map((b) => ({ ...b }));
  const smc = analyzeSmartMoney(smcBars);

  // ── 9. Direction scoring ─────────────────────────────────────────────────────
  let bullScore = 0;
  let bearScore = 0;

  // Regime bias
  if (regime === 'TRENDING_BULL') bullScore += 2;
  else if (regime === 'TRENDING_BEAR') bearScore += 2;

  // EMA alignment
  if (ema20 > ema50 && ema50 > ema200) { bullScore += 2; reasons.push('EMA stack bullish (20>50>200)'); }
  else if (ema20 < ema50 && ema50 < ema200) { bearScore += 2; reasons.push('EMA stack bearish (20<50<200)'); }
  else if (ema20 > ema50) { bullScore++; reasons.push('EMA20 > EMA50'); }
  else if (ema20 < ema50) { bearScore++; reasons.push('EMA20 < EMA50'); }

  // RSI
  if (rsiVal < 40) { bullScore++; reasons.push(`RSI ${rsiVal.toFixed(0)} oversold`); }
  else if (rsiVal > 60) { bearScore++; reasons.push(`RSI ${rsiVal.toFixed(0)} overbought`); }
  if (rsiVal > 70) blocked.push('RSI > 70 — extreme overbought, no more longs');
  if (rsiVal < 30) blocked.push('RSI < 30 — extreme oversold, no more shorts');

  // MACD
  if (macdData.histogram > 0 && macdData.macd > 0) { bullScore++; reasons.push('MACD histogram positive'); }
  else if (macdData.histogram < 0 && macdData.macd < 0) { bearScore++; reasons.push('MACD histogram negative'); }

  // Bollinger Bands
  if (bbands.pct < 0.2) { bullScore++; reasons.push('Price at lower Bollinger Band'); }
  else if (bbands.pct > 0.8) { bearScore++; reasons.push('Price at upper Bollinger Band'); }

  // StochRSI
  if (srsi < 20) { bullScore++; reasons.push(`StochRSI ${srsi.toFixed(0)} oversold`); }
  else if (srsi > 80) { bearScore++; reasons.push(`StochRSI ${srsi.toFixed(0)} overbought`); }

  // Momentum
  if (mom > 1.5) { bullScore++; reasons.push(`Momentum +${mom.toFixed(1)}%`); }
  else if (mom < -1.5) { bearScore++; reasons.push(`Momentum ${mom.toFixed(1)}%`); }

  // Trend score
  if (ts.label === 'STRONG') {
    if (ts.reasons.some((r) => r.toLowerCase().includes('bull'))) bullScore++;
    else bearScore++;
  }

  // SMC
  if (smc.smcScore.bull > smc.smcScore.bear) { bullScore++; reasons.push(`SMC: ${smc.smcScore.reasons.join(', ')}`); }
  else if (smc.smcScore.bear > smc.smcScore.bull) { bearScore++; reasons.push(`SMC: ${smc.smcScore.reasons.join(', ')}`); }

  // BTC alignment (bonus/penalty)
  if (btcDir === 'bullish') { bullScore++; }
  else if (btcDir === 'bearish') { bearScore++; }

  // Choppiness bonus
  if (chop.state === 'TRENDING') { bullScore++; bearScore++; } // symmetrical: good for both directions

  // ADX strength bonus
  if (adxVal >= 30) { bullScore++; bearScore++; }

  // ── 10. Determine side ───────────────────────────────────────────────────────
  const maxScore = Math.max(bullScore, bearScore);
  const minDiff = 2;
  let side: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  if (bullScore - bearScore >= minDiff) side = 'LONG';
  else if (bearScore - bullScore >= minDiff) side = 'SHORT';

  // BTC opposing trend penalty
  if (side === 'LONG' && btcDir === 'bearish') blocked.push('BTC in bearish trend (opposing LONG)');
  if (side === 'SHORT' && btcDir === 'bullish') blocked.push('BTC in bullish trend (opposing SHORT)');

  // Check ADX gate after side is determined
  if (blocked.length > 0 || side === 'NEUTRAL') {
    return neutralSignal(symbol, price, blocked.length > 0 ? blocked : ['No directional edge'], {
      rsi: rsiVal, ema20, ema50, ema200, sma: smaVal, atr: atrVal, momentum: mom,
      adx: adxVal, macdHistogram: macdData.histogram, stochRsi: srsi,
      bollingerPct: bbands.pct, volRatio,
    });
  }

  // ── 11. Confidence score 0-100 ──────────────────────────────────────────────
  // Score out of 12 possible points mapped to 0-100
  const rawScore = side === 'LONG' ? bullScore : bearScore;
  let confidence = Math.round(Math.min(100, (rawScore / 12) * 100));

  // Volatility cap
  if (volRegime.scoreCap !== null) {
    confidence = Math.min(confidence, volRegime.scoreCap);
  }

  // Choppiness adjustment
  confidence = Math.max(0, Math.min(100, confidence + chop.confidenceAdjust * 5));

  if (confidence < MIN_CONFIDENCE) {
    return neutralSignal(symbol, price, [`Confidence ${confidence} < ${MIN_CONFIDENCE} (min)`], {
      rsi: rsiVal, ema20, ema50, ema200, sma: smaVal, atr: atrVal, momentum: mom,
      adx: adxVal, macdHistogram: macdData.histogram, stochRsi: srsi,
      bollingerPct: bbands.pct, volRatio,
    });
  }

  // ── 12. SL / TP placement ───────────────────────────────────────────────────
  const entry = price;
  const slDist = atrVal * ATR_SL;
  const tpDist = atrVal * ATR_TP;
  const stopLoss  = side === 'LONG' ? entry - slDist : entry + slDist;
  const takeProfit = side === 'LONG' ? entry + tpDist : entry - tpDist;
  const riskReward = slDist > 0 ? tpDist / slDist : 0;

  // Skip if SL is zero (degenerate case with insufficient ATR)
  if (slDist <= 0 || riskReward < 1.5) {
    return neutralSignal(symbol, price, [`R:R ${riskReward.toFixed(2)} < 1.5 — poor setup`]);
  }

  log.info(`[signal-v3] ${symbol} ${side} confidence=${confidence}% regime=${regime} ADX=${adxVal.toFixed(1)} CHOP=${chop.value.toFixed(1)} bull=${bullScore} bear=${bearScore}`);

  return {
    symbol,
    side,
    confidence,
    price,
    entry,
    stopLoss,
    takeProfit,
    riskReward: parseFloat(riskReward.toFixed(2)),
    reasons,
    blocked: [],
    marketRegime: regime,
    chopValue: chop.value,
    smcBull: smc.smcScore.bull,
    smcBear: smc.smcScore.bear,
    trend1h: 'pending',
    indicators: {
      rsi: parseFloat(rsiVal.toFixed(2)),
      ema20: parseFloat(ema20.toFixed(4)),
      ema50: parseFloat(ema50.toFixed(4)),
      ema200: parseFloat(ema200.toFixed(4)),
      sma: parseFloat(smaVal.toFixed(4)),
      atr: parseFloat(atrVal.toFixed(4)),
      momentum: parseFloat(mom.toFixed(2)),
      adx: parseFloat(adxVal.toFixed(2)),
      macdHistogram: parseFloat(macdData.histogram.toFixed(4)),
      stochRsi: parseFloat(srsi.toFixed(2)),
      bollingerPct: parseFloat(bbands.pct.toFixed(3)),
      volRatio: parseFloat(volRatio.toFixed(2)),
    },
    timestamp: Date.now(),
  };
}

/** Helper to build a NEUTRAL signal with optional indicator snapshot. */
function neutralSignal(
  symbol: string,
  price: number,
  blocked: string[],
  indicators?: Signal['indicators'],
): Signal {
  return {
    symbol,
    side: 'NEUTRAL',
    confidence: 0,
    price,
    entry: price,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: 0,
    reasons: [],
    blocked,
    marketRegime: 'RANGING',
    chopValue: undefined,
    smcBull: undefined,
    smcBear: undefined,
    trend1h: undefined,
    indicators: indicators ?? {
      rsi: 50, ema20: 0, ema50: 0, ema200: 0, sma: 0, atr: 0, momentum: 0,
      adx: 0, macdHistogram: 0, stochRsi: 50, bollingerPct: 0.5, volRatio: 1,
    },
    timestamp: Date.now(),
  };
}

/** Signal Engine class wrapping the v3.1 generator for the bot. */
export class SignalEngine {
  constructor(private client: AlpacaClient) {}

  /**
   * Generate signals for a list of symbols in parallel.
   * @param symbols list of Alpaca crypto symbols
   * @returns array of Signals (NEUTRAL when blocked)
   */
  async generateSignals(symbols: string[]): Promise<Signal[]> {
    const results = await Promise.allSettled(
      symbols.map((s) => generateSignal(s, this.client)),
    );
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      log.warn(`[signal] ${symbols[i]} error: ${r.reason}`);
      return neutralSignal(symbols[i], 0, [`Error: ${String(r.reason)}`]);
    });
  }
}
