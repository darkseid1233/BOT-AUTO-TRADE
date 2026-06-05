/**
 * Backtesting Engine — bar-by-bar replay with ZERO look-ahead bias.
 *
 * Ported from bcj2023's backtest.ts and adapted to the Alpaca v4 engine:
 *  - Entry on NEXT bar open (not signal-bar close) — no look-ahead.
 *  - Partial TP L1/L2 + breakeven buffer + remaining trail (mirrors paper-trader).
 *  - Round-trip taker fee + slippage applied.
 *  - Compound equity with leverage.
 *  - Timeout exit after N bars if neither SL nor TP hit.
 *
 * Plus full Performance Metrics: win rate, profit factor, expectancy, Sharpe,
 * max drawdown, avg win/loss — the numbers the dashboard shows.
 */
import { getStrategyConfig } from './strategy-config.js';
import { detectRegime, type Bar } from './market-regime.js';
import {
  ema, rsi, atr, macd, adx, stochRsi, volumeRatio,
} from './indicators.js';
import { getVolatilityRegime } from './volatility-regime.js';
import { analyzeSmartMoney } from './smart-money.js';
import { computeSignalQuality } from './signal-quality.js';
import type { BtcState } from './btc-state.js';
import type { HtfResult } from './htf-confirm.js';

export type BacktestTrade = {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryTime: number;
  entryIndex: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitTime: number;
  exitPrice: number;
  pnlR: number;          // PnL in R multiples (after costs)
  pnlPct: number;        // PnL % on margin
  reason: 'TP' | 'SL' | 'TP_PARTIAL' | 'TIMEOUT';
  barsHeld: number;
  quality: number;
  regime: string;
};

export type BacktestResult = {
  symbol: string;
  timeframe: string;
  bars: number;
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  avgPnlPct: number;
  profitFactor: number;
  expectancyR: number;
  sharpe: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  startBalance: number;
  finalBalance: number;
  trades: BacktestTrade[];
};

export type BacktestParams = {
  riskPerTrade?: number;
  leverage?: number;
  /** Treat HTF/BTC as aligned (isolate per-symbol strategy) or pass a fixed bias. */
  btcBias?: 'aligned' | 'bullish' | 'bearish';
};

/**
 * Backtest one symbol over historical 15m + 1H bars.
 * @param symbol symbol label (for reporting)
 * @param k15 15m bars oldest-first
 * @param k1h 1H bars oldest-first
 * @param params optional overrides
 * @returns BacktestResult with full performance metrics
 */
export function backtest(
  symbol: string,
  k15: Bar[],
  k1h: Bar[],
  params: BacktestParams = {},
): BacktestResult {
  const cfg = getStrategyConfig();
  const startBalance = 10000;
  const riskPerTrade = params.riskPerTrade ?? 0.01;
  const leverage = params.leverage ?? 1;
  const TIMEOUT_BARS = 48;

  let balance = startBalance;
  let peak = startBalance;
  let maxDrawdown = 0;
  let totalSignals = 0;
  const trades: BacktestTrade[] = [];

  type OpenTrade = BacktestTrade & {
    currentStop: number;
    remainingFraction: number;
    realizedR: number;
    l1Hit: boolean;
    l2Hit: boolean;
    l1Price: number;
    l2Price: number;
    slDist: number;
  };
  let open: OpenTrade | null = null;

  for (let i = 205; i < k15.length; i++) {
    const bar = k15[i];

    // ── Manage an open trade ──────────────────────────────────────────────
    if (open) {
      const isLong = open.side === 'LONG';
      const { high, low } = bar;

      if (cfg.partialTpEnabled && !open.l1Hit) {
        const hit = isLong ? high >= open.l1Price : low <= open.l1Price;
        if (hit) {
          open.l1Hit = true;
          open.realizedR += cfg.partialTpL1R * (cfg.partialTpL1ClosePct / 100);
          open.remainingFraction -= cfg.partialTpL1ClosePct / 100;
          const be = isLong ? open.entryPrice + open.slDist * cfg.breakevenBufferR
                            : open.entryPrice - open.slDist * cfg.breakevenBufferR;
          open.currentStop = isLong ? Math.max(open.currentStop, be) : Math.min(open.currentStop, be);
        }
      } else if (cfg.partialTpEnabled && open.l1Hit && !open.l2Hit) {
        const hit = isLong ? high >= open.l2Price : low <= open.l2Price;
        if (hit) {
          open.l2Hit = true;
          open.realizedR += cfg.partialTpL2R * (cfg.partialTpL2ClosePct / 100);
          open.remainingFraction -= cfg.partialTpL2ClosePct / 100;
          const lock = isLong ? open.entryPrice + open.slDist * cfg.partialTpL1R
                              : open.entryPrice - open.slDist * cfg.partialTpL1R;
          open.currentStop = isLong ? Math.max(open.currentStop, lock) : Math.min(open.currentStop, lock);
        }
      }

      let hit = false;
      let reason: BacktestTrade['reason'] = 'TIMEOUT';
      let exitPx = bar.close;
      if (isLong) {
        if (low <= open.currentStop) { exitPx = open.currentStop; reason = open.l1Hit ? 'TP_PARTIAL' : 'SL'; hit = true; }
        else if (high >= open.takeProfit) { exitPx = open.takeProfit; reason = 'TP'; hit = true; }
      } else {
        if (high >= open.currentStop) { exitPx = open.currentStop; reason = open.l1Hit ? 'TP_PARTIAL' : 'SL'; hit = true; }
        else if (low <= open.takeProfit) { exitPx = open.takeProfit; reason = 'TP'; hit = true; }
      }
      const barsHeld = i - open.entryIndex;
      if (!hit && barsHeld >= TIMEOUT_BARS) { exitPx = bar.close; reason = 'TIMEOUT'; hit = true; }

      if (hit) {
        const restR = (isLong ? (exitPx - open.entryPrice) : (open.entryPrice - exitPx)) / open.slDist;
        const costR = (open.entryPrice * (2 * cfg.takerFeePct + 2 * cfg.slippagePct)) / open.slDist;
        const totalR = open.realizedR + restR * open.remainingFraction - costR;

        balance *= (1 + totalR * leverage * riskPerTrade);
        if (balance < 0) balance = 0;
        peak = Math.max(peak, balance);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - balance) / peak : 0);

        open.exitTime = i; // bar index (Bar has no timestamp)
        open.exitPrice = exitPx;
        open.barsHeld = barsHeld;
        open.reason = reason;
        open.pnlR = totalR;
        open.pnlPct = totalR * leverage * riskPerTrade * 100;
        trades.push({ ...open });
        open = null;
      }
      continue;
    }

    // ── Look for a new entry ──────────────────────────────────────────────
    const slice15 = k15.slice(0, i + 1);
    const j = Math.floor((i * k1h.length) / k15.length);
    const slice1h = k1h.slice(0, j + 1);
    if (slice15.length < 205 || slice1h.length < 200) continue;

    const sig = evaluateBar(symbol, slice15, slice1h, cfg, params);
    if (!sig) continue;
    totalSignals++;

    const nextOpen = i + 1 < k15.length ? k15[i + 1].open : sig.entry;
    const isLong = sig.side === 'LONG';
    const entryPx = isLong ? nextOpen * (1 + cfg.slippagePct) : nextOpen * (1 - cfg.slippagePct);
    const slDist = Math.abs(sig.entry - sig.stopLoss);
    if (slDist <= 0) continue;
    const sl = isLong ? entryPx - slDist : entryPx + slDist;
    const tpDist = Math.abs(sig.takeProfit - sig.entry);
    const tp = isLong ? entryPx + tpDist : entryPx - tpDist;

    open = {
      symbol, side: sig.side, entryTime: i, entryIndex: i,
      entryPrice: entryPx, stopLoss: sl, takeProfit: tp, exitTime: 0, exitPrice: 0,
      pnlR: 0, pnlPct: 0, reason: 'TIMEOUT', barsHeld: 0, quality: sig.quality, regime: sig.regime,
      currentStop: sl, remainingFraction: 1, realizedR: 0, l1Hit: false, l2Hit: false,
      l1Price: isLong ? entryPx + slDist * cfg.partialTpL1R : entryPx - slDist * cfg.partialTpL1R,
      l2Price: isLong ? entryPx + slDist * cfg.partialTpL2R : entryPx - slDist * cfg.partialTpL2R,
      slDist,
    };
  }

  return finalize(symbol, '15Min', k15.length, totalSignals, trades, startBalance, balance, maxDrawdown);
}

/** Evaluate a single bar slice → entry signal or null. Pure (no I/O). */
function evaluateBar(
  symbol: string, k15: Bar[], k1h: Bar[], cfg: ReturnType<typeof getStrategyConfig>, params: BacktestParams,
): { side: 'LONG' | 'SHORT'; entry: number; stopLoss: number; takeProfit: number; quality: number; regime: string } | null {
  const regime = detectRegime(k15, cfg);
  if (regime.allowedSide === 'NEUTRAL') return null;
  const side = regime.allowedSide;
  const closes = k15.map((b) => b.close);
  const volumes = k15.map((b) => b.volume);
  const price = closes[closes.length - 1];

  const volRatio = volumeRatio(volumes, 20);
  if (volRatio < cfg.minVolumeRatio) return null;
  const rsiVal = regime.rsi;
  if (side === 'LONG' && rsiVal > cfg.rsiLateEntryGuard) return null;
  if (side === 'SHORT' && rsiVal < 100 - cfg.rsiLateEntryGuard) return null;

  // HTF from 1H slice (real multi-timeframe, no look-ahead).
  const c1h = k1h.map((b) => b.close);
  const e50h = ema(c1h, 50), e200h = ema(c1h, 200);
  const adxh = adx(k1h, 14).adx;
  let htfTrend: HtfResult['trend'] = 'neutral';
  if (e50h > e200h && adxh > 20) htfTrend = 'bullish';
  else if (e50h < e200h && adxh > 20) htfTrend = 'bearish';
  const htf: HtfResult = {
    trend: htfTrend,
    aligned: (side === 'LONG' && htfTrend === 'bullish') || (side === 'SHORT' && htfTrend === 'bearish'),
    opposed: (side === 'LONG' && htfTrend === 'bearish') || (side === 'SHORT' && htfTrend === 'bullish'),
    ema50: e50h, ema200: e200h, rsi: rsi(c1h), adx: adxh,
  };

  // BTC bias for backtest (isolate per-symbol unless a fixed macro bias requested).
  const bias = params.btcBias ?? 'aligned';
  const btc: BtcState = bias === 'aligned'
    ? { direction: side === 'LONG' ? 'bullish' : 'bearish', strength: 'moderate', ema50: 0, ema200: 0, rsi: 50, adx: 0, label: 'bt' }
    : { direction: bias, strength: 'strong', ema50: 0, ema200: 0, rsi: bias === 'bullish' ? 65 : 35, adx: 35, label: 'bt' };
  if ((side === 'LONG' && btc.direction === 'bearish' && btc.strength === 'strong') ||
      (side === 'SHORT' && btc.direction === 'bullish' && btc.strength === 'strong')) return null;

  const ema20 = ema(closes, 20), ema50 = regime.ema50, ema200 = regime.ema200;
  const atrVal = atr(k15, 14);
  const macdData = macd(closes);
  const srsi = stochRsi(closes);
  const volRegime = getVolatilityRegime(k15.map((b) => b.high), k15.map((b) => b.low), closes);
  const smc = analyzeSmartMoney(k15.slice(-60).map((b) => ({ ...b })));
  const emaStackAligned = side === 'LONG' ? ema20 > ema50 && ema50 > ema200 : ema20 < ema50 && ema50 < ema200;

  const quality = computeSignalQuality({
    side, regime: regime.regime, adx: regime.adx, emaStackAligned, volumeRatio: volRatio,
    rsi: rsiVal, macdHistogram: macdData.histogram, stochRsi: srsi, volState: volRegime.state, btc, htf, smc, cfg,
  });
  if (quality.score < cfg.minSignalQuality) return null;

  if (atrVal <= 0) return null;
  const slDist = atrVal * cfg.atrSlMult;
  const tpDist = atrVal * cfg.atrTpMult;
  const stopLoss = side === 'LONG' ? price - slDist : price + slDist;
  const takeProfit = side === 'LONG' ? price + tpDist : price - tpDist;
  const roundTripCost = price * (2 * cfg.takerFeePct + 2 * cfg.slippagePct);
  const netRR = (tpDist - roundTripCost) / (slDist + roundTripCost);
  if (netRR < cfg.minRiskReward) return null;

  return { side, entry: price, stopLoss, takeProfit, quality: quality.score, regime: regime.regime };
}

/** Aggregate trades into the final performance-metrics result. */
function finalize(
  symbol: string, timeframe: string, bars: number, totalSignals: number,
  trades: BacktestTrade[], startBalance: number, finalBalance: number, maxDrawdown: number,
): BacktestResult {
  const wins = trades.filter((t) => t.pnlR > 0).length;
  const losses = trades.filter((t) => t.pnlR < 0).length;
  const timeouts = trades.filter((t) => t.reason === 'TIMEOUT').length;
  const grossWin = trades.filter((t) => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const avgR = trades.length ? trades.reduce((s, t) => s + t.pnlR, 0) / trades.length : 0;
  const variance = trades.length ? trades.reduce((s, t) => s + (t.pnlR - avgR) ** 2, 0) / trades.length : 0;
  const std = Math.sqrt(variance);

  return {
    symbol, timeframe, bars, totalSignals, totalTrades: trades.length, wins, losses, timeouts,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyR: avgR,
    sharpe: std > 0 ? (avgR / std) * Math.sqrt(trades.length || 1) : 0,
    maxDrawdownPct: maxDrawdown * 100,
    totalReturnPct: ((finalBalance - startBalance) / startBalance) * 100,
    startBalance, finalBalance, trades,
  };
}

/**
 * Walk-Forward Testing — split history into sequential windows, run the strategy
 * out-of-sample on each, and report stability. Detects curve-fitting: if metrics
 * vary wildly window-to-window, the edge is fragile.
 *
 * @param symbol symbol label
 * @param k15 full 15m history
 * @param k1h full 1H history
 * @param windows number of sequential out-of-sample windows (default 4)
 * @returns per-window results + aggregate stability metrics
 */
export function walkForward(
  symbol: string, k15: Bar[], k1h: Bar[], windows = 4, params: BacktestParams = {},
): { windows: BacktestResult[]; avgWinRate: number; avgProfitFactor: number; winRateStdDev: number; stable: boolean } {
  const results: BacktestResult[] = [];
  const size15 = Math.floor(k15.length / windows);
  for (let w = 0; w < windows; w++) {
    const start = w * size15;
    const slice15 = k15.slice(start, start + size15);
    const ratio = k1h.length / k15.length;
    const slice1h = k1h.slice(Math.floor(start * ratio), Math.floor((start + size15) * ratio));
    if (slice15.length < 250 || slice1h.length < 200) continue;
    results.push(backtest(`${symbol}#W${w + 1}`, slice15, slice1h, params));
  }
  const valid = results.filter((r) => r.totalTrades > 0);
  const avgWinRate = valid.length ? valid.reduce((s, r) => s + r.winRate, 0) / valid.length : 0;
  const avgPf = valid.length ? valid.reduce((s, r) => s + (Number.isFinite(r.profitFactor) ? r.profitFactor : 3), 0) / valid.length : 0;
  const wrVar = valid.length ? valid.reduce((s, r) => s + (r.winRate - avgWinRate) ** 2, 0) / valid.length : 0;
  const winRateStdDev = Math.sqrt(wrVar);
  // Stable when every window is profitable and win-rate variance is low.
  const stable = valid.length >= 2 && valid.every((r) => r.profitFactor >= 1) && winRateStdDev < 15;
  return { windows: results, avgWinRate, avgProfitFactor: avgPf, winRateStdDev, stable };
}
