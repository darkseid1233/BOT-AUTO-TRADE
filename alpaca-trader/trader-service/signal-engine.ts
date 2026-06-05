import { sma, ema, rsi, atr, momentum } from './indicators.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal } from './types.js';

/** Minimum confidence (0-100) required to act on a signal. */
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 60);
/** ATR multipliers for stop-loss / take-profit placement. */
const ATR_SL = Number(process.env.ATR_SL_MULTIPLIER ?? 1.5);
const ATR_TP = Number(process.env.ATR_TP_MULTIPLIER ?? 3.0);

/**
 * Signal engine — a compact, quality-first trend/momentum strategy inspired by
 * the multi-gate engine in the reference repo, adapted for Alpaca crypto data.
 *
 * Gates: trend (EMA20 vs EMA50), momentum, RSI band, volatility (ATR sanity).
 * A composite confidence score 0-100 decides whether to trade.
 */
export class SignalEngine {
  constructor(private client: AlpacaClient) {}

  /**
   * Analyze one symbol and produce a signal.
   * @param symbol Alpaca crypto symbol, e.g. "BTC/USD"
   * @returns a Signal (side NEUTRAL when no setup)
   */
  async analyze(symbol: string): Promise<Signal> {
    const bars = await this.client.getCryptoBars(symbol, '15Min', 120);
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const price = closes[closes.length - 1] ?? 0;

    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const sma20 = sma(closes, 20);
    const rsiVal = rsi(closes, 14);
    const atrVal = atr(highs, lows, closes, 14);
    const mom = momentum(closes, 10);

    const reasons: string[] = [];
    const blocked: string[] = [];
    let side: Signal['side'] = 'NEUTRAL';

    // ── Gate 1: Trend direction (EMA20 vs EMA50) ──────────────────────────
    const bull = ema20 > ema50 * 1.0005;
    const bear = ema20 < ema50 * 0.9995;
    if (bull) {
      side = 'LONG';
      reasons.push(`Trend up (EMA20 ${ema20.toFixed(2)} > EMA50 ${ema50.toFixed(2)})`);
    } else if (bear) {
      side = 'SHORT';
      reasons.push(`Trend down (EMA20 ${ema20.toFixed(2)} < EMA50 ${ema50.toFixed(2)})`);
    } else {
      blocked.push('No clear trend (EMA20 ≈ EMA50)');
    }

    // ── Gate 2: Momentum confirmation ─────────────────────────────────────
    if (side === 'LONG' && mom <= 0) {
      blocked.push(`Momentum negative (${mom.toFixed(2)}%) against LONG`);
      side = 'NEUTRAL';
    } else if (side === 'SHORT' && mom >= 0) {
      blocked.push(`Momentum positive (${mom.toFixed(2)}%) against SHORT`);
      side = 'NEUTRAL';
    } else if (side !== 'NEUTRAL') {
      reasons.push(`Momentum ${mom.toFixed(2)}% confirms`);
    }

    // ── Gate 3: Avoid overbought / oversold late entries ──────────────────
    if (side === 'LONG' && rsiVal > 72) {
      blocked.push(`RSI ${rsiVal.toFixed(1)} overbought — late LONG`);
      side = 'NEUTRAL';
    }
    if (side === 'SHORT' && rsiVal < 28) {
      blocked.push(`RSI ${rsiVal.toFixed(1)} oversold — late SHORT`);
      side = 'NEUTRAL';
    }

    // ── Gate 4: Volatility sanity (ATR must be positive & reasonable) ──────
    if (side !== 'NEUTRAL' && (atrVal <= 0 || atrVal > price * 0.1)) {
      blocked.push('ATR out of range — skipping');
      side = 'NEUTRAL';
    }

    // ── Confidence score (0-100) ──────────────────────────────────────────
    let confidence = 0;
    if (side !== 'NEUTRAL') {
      const trendStrength = Math.min(40, (Math.abs(ema20 - ema50) / ema50) * 4000);
      const momScore = Math.min(30, Math.abs(mom) * 6);
      const rsiScore = side === 'LONG'
        ? Math.max(0, 30 - Math.abs(rsiVal - 45))
        : Math.max(0, 30 - Math.abs(rsiVal - 55));
      confidence = Math.round(Math.min(100, trendStrength + momScore + rsiScore));
      reasons.push(`Confidence ${confidence}/100`);
    }

    // ── Entry / SL / TP ───────────────────────────────────────────────────
    const slDist = atrVal * ATR_SL;
    const tpDist = atrVal * ATR_TP;
    const stopLoss = side === 'LONG' ? price - slDist : price + slDist;
    const takeProfit = side === 'LONG' ? price + tpDist : price - tpDist;
    const riskReward = slDist > 0 ? tpDist / slDist : 0;

    if (side !== 'NEUTRAL' && confidence < MIN_CONFIDENCE) {
      blocked.push(`Confidence ${confidence} < ${MIN_CONFIDENCE} minimum`);
      side = 'NEUTRAL';
    }

    return {
      symbol,
      side,
      confidence,
      price,
      entry: price,
      stopLoss,
      takeProfit,
      riskReward,
      reasons,
      blocked,
      indicators: { rsi: rsiVal, ema20, ema50, sma: sma20, atr: atrVal, momentum: mom },
      timestamp: Date.now(),
    };
  }
}
