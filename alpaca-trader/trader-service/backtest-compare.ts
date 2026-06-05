/**
 * Backtest A/B Comparison — v3 (naive confidence) vs v4 (regime-first, weighted quality).
 *
 * Runs BOTH engines on the same historical bars for a fair comparison.
 * Same ATR-based SL/TP, same fee/slippage model, same risk per trade (1%),
 * same compound equity — the only difference is the signal selection logic.
 */

import { backtest, walkForward, type BacktestResult, type BacktestParams, type BacktestTrade } from './backtest.js';
import type { Bar } from './market-regime.js';
import { ema, rsi, atr, macd, adx, stochRsi, volumeRatio } from './indicators.js';
import { getStrategyConfig } from './strategy-config.js';

type V3Signal = { side: 'LONG' | 'SHORT'; entry: number; stopLoss: number; takeProfit: number; confidence: number; };

/** V3 naive scoring: integer point counting, no regime gate, no HTF, no quality score. */
function v3EvaluateBar(k15: Bar[]): V3Signal | null {
  if (k15.length < 205) return null;
  const closes = k15.map((b) => b.close);
  const volumes = k15.map((b) => b.volume);
  const price = closes[closes.length - 1];
  const ema20 = ema(closes, 20);
  const ema50v = ema(closes, 50);
  const ema200v = ema(closes, 200);
  const rsiVal = rsi(closes);
  const macdData = macd(closes);
  const srsi = stochRsi(closes);
  const volR = volumeRatio(volumes, 20);
  const adxData = adx(k15, 14);
  let longPts = 0, shortPts = 0;
  if (ema20 > ema50v) longPts++; else shortPts++;
  if (ema50v > ema200v) longPts++; else shortPts++;
  if (rsiVal > 50 && rsiVal < 70) longPts++; else if (rsiVal < 50 && rsiVal > 30) shortPts++;
  if (macdData.histogram > 0) longPts++; else shortPts++;
  if (srsi < 25) longPts++; else if (srsi > 75) shortPts++;
  if (volR > 1.2) { longPts++; shortPts++; }
  if (adxData.adx > 20) { longPts++; shortPts++; }
  if (price > ema50v) longPts++; else shortPts++;
  const minPts = 5;
  const side = longPts >= minPts && longPts > shortPts ? 'LONG'
    : shortPts >= minPts && shortPts > longPts ? 'SHORT'
    : null;
  if (!side) return null;
  const atrVal = atr(k15, 14);
  if (atrVal <= 0) return null;
  const cfg = getStrategyConfig();
  const sl = side === 'LONG' ? price - atrVal * cfg.atrSlMult : price + atrVal * cfg.atrSlMult;
  const tp = side === 'LONG' ? price + atrVal * cfg.atrTpMult : price - atrVal * cfg.atrTpMult;
  return { side, entry: price, stopLoss: sl, takeProfit: tp, confidence: Math.round(Math.max(longPts, shortPts) / 9 * 100) };
}

function backtestV3(symbol: string, k15: Bar[]): BacktestResult {
  const cfg = getStrategyConfig();
  const startBalance = 10000;
  const riskPerTrade = 0.01;
  const TIMEOUT_BARS = 48;
  let balance = startBalance, peak = startBalance, maxDrawdown = 0, totalSignals = 0;
  const trades: BacktestTrade[] = [];
  type OpenT = { side: 'LONG' | 'SHORT'; entryIndex: number; entryTime: number; entryPrice: number; stopLoss: number; takeProfit: number; slDist: number; };
  let open: OpenT | null = null;
  for (let i = 205; i < k15.length; i++) {
    const bar = k15[i];
    if (open) {
      const isLong = open.side === 'LONG';
      let hit = false, reason: BacktestTrade['reason'] = 'TIMEOUT', exitPx = bar.close;
      if (isLong) {
        if (bar.low <= open.stopLoss)  { exitPx = open.stopLoss;  reason = 'SL'; hit = true; }
        else if (bar.high >= open.takeProfit) { exitPx = open.takeProfit; reason = 'TP'; hit = true; }
      } else {
        if (bar.high >= open.stopLoss) { exitPx = open.stopLoss;  reason = 'SL'; hit = true; }
        else if (bar.low <= open.takeProfit)  { exitPx = open.takeProfit; reason = 'TP'; hit = true; }
      }
      if (!hit && (i - open.entryIndex) >= TIMEOUT_BARS) { exitPx = bar.close; reason = 'TIMEOUT'; hit = true; }
      if (hit) {
        const dir = isLong ? 1 : -1;
        const rawR = (exitPx - open.entryPrice) * dir / open.slDist;
        const costR = (open.entryPrice * (2 * cfg.takerFeePct + 2 * cfg.slippagePct)) / open.slDist;
        const totalR = rawR - costR;
        balance *= (1 + totalR * riskPerTrade);
        if (balance < 0) balance = 0;
        peak = Math.max(peak, balance);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - balance) / peak : 0);
        trades.push({
          symbol, side: open.side, entryTime: open.entryTime, entryIndex: open.entryIndex,
          entryPrice: open.entryPrice, stopLoss: open.stopLoss, takeProfit: open.takeProfit,
          exitTime: i, exitPrice: exitPx, pnlR: totalR, pnlPct: totalR * riskPerTrade * 100,
          reason, barsHeld: i - open.entryIndex, quality: 50, regime: 'v3-naive',
        });
        open = null;
      }
      continue;
    }
    const sig = v3EvaluateBar(k15.slice(0, i + 1));
    if (!sig) continue;
    totalSignals++;
    const nextOpen = i + 1 < k15.length ? k15[i + 1].open : sig.entry;
    const isLong = sig.side === 'LONG';
    const slippage = cfg.slippagePct;
    const entryPx = isLong ? nextOpen * (1 + slippage) : nextOpen * (1 - slippage);
    const slDist = Math.abs(sig.entry - sig.stopLoss);
    if (slDist <= 0) continue;
    const sl = isLong ? entryPx - slDist : entryPx + slDist;
    const tp = isLong ? entryPx + Math.abs(sig.takeProfit - sig.entry) : entryPx - Math.abs(sig.takeProfit - sig.entry);
    open = { side: sig.side, entryIndex: i, entryTime: i, entryPrice: entryPx, stopLoss: sl, takeProfit: tp, slDist };
  }
  const wins = trades.filter((t) => t.pnlR > 0).length;
  const losses = trades.filter((t) => t.pnlR < 0).length;
  const grossWin = trades.filter((t) => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const avgR = trades.length ? trades.reduce((s, t) => s + t.pnlR, 0) / trades.length : 0;
  const std = Math.sqrt(trades.length ? trades.reduce((s, t) => s + (t.pnlR - avgR) ** 2, 0) / trades.length : 0);
  return {
    symbol: `${symbol} [v3-naive]`, timeframe: '15Min', bars: k15.length,
    totalSignals, totalTrades: trades.length, wins, losses,
    timeouts: trades.filter((t) => t.reason === 'TIMEOUT').length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyR: avgR, sharpe: std > 0 ? (avgR / std) * Math.sqrt(trades.length || 1) : 0,
    maxDrawdownPct: maxDrawdown * 100,
    totalReturnPct: ((balance - startBalance) / startBalance) * 100,
    startBalance, finalBalance: balance, trades,
  };
}

export type CompareResult = {
  symbol: string; bars: number;
  v3: BacktestResult; v4: BacktestResult;
  v4WalkForward?: ReturnType<typeof walkForward>;
  verdict: {
    winRateDelta: number; profitFactorDelta: number; returnDelta: number;
    maxDdDelta: number; signalFilterRate: number;
    v4Wins: string[]; v4Loses: string[]; summary: string;
  };
};

/**
 * Run v3 vs v4 backtest on the same data and return a comparison.
 * @param symbol symbol label
 * @param k15 15m bars (oldest first, at least 500)
 * @param k1h 1H bars (oldest first, at least 200)
 * @param walk also run v4 walk-forward (4 windows)
 * @param params optional backtest params
 */
export function compareBacktest(
  symbol: string, k15: Bar[], k1h: Bar[], walk = true, params: BacktestParams = {},
): CompareResult {
  const v3 = backtestV3(symbol, k15);
  const v4 = backtest(symbol, k15, k1h, params);
  const v4wf = walk ? walkForward(symbol, k15, k1h, 4, params) : undefined;
  const pfV3 = Number.isFinite(v3.profitFactor) ? v3.profitFactor : 3;
  const pfV4 = Number.isFinite(v4.profitFactor) ? v4.profitFactor : 3;
  const winRateDelta = v4.winRate - v3.winRate;
  const profitFactorDelta = pfV4 - pfV3;
  const returnDelta = v4.totalReturnPct - v3.totalReturnPct;
  const maxDdDelta = v4.maxDrawdownPct - v3.maxDrawdownPct;
  const signalFilterRate = v3.totalSignals > 0
    ? ((v3.totalSignals - v4.totalSignals) / v3.totalSignals) * 100 : 0;
  const v4Wins: string[] = [], v4Loses: string[] = [];
  if (winRateDelta > 0)      v4Wins.push(`Win Rate +${winRateDelta.toFixed(1)}pp`); else if (winRateDelta < -1)  v4Loses.push(`Win Rate ${winRateDelta.toFixed(1)}pp`);
  if (profitFactorDelta > 0) v4Wins.push(`Profit Factor +${profitFactorDelta.toFixed(2)}`); else if (profitFactorDelta < -0.1) v4Loses.push(`Profit Factor ${profitFactorDelta.toFixed(2)}`);
  if (returnDelta > 0)       v4Wins.push(`Total Return +${returnDelta.toFixed(1)}%`); else if (returnDelta < -2) v4Loses.push(`Total Return ${returnDelta.toFixed(1)}%`);
  if (maxDdDelta < -1)       v4Wins.push(`Max Drawdown ${maxDdDelta.toFixed(1)}pp lower`); else if (maxDdDelta > 2) v4Loses.push(`Max Drawdown +${maxDdDelta.toFixed(1)}pp higher`);
  if (signalFilterRate > 0)  v4Wins.push(`Filtered ${signalFilterRate.toFixed(0)}% weak signals`);
  const isV4Better = v4Wins.length > v4Loses.length && pfV4 >= 1;
  const wfStable = v4wf?.stable ?? true;
  const summary = isV4Better
    ? `v4 outperforms v3 on ${v4Wins.length} metrics. ${wfStable ? 'Walk-forward stable.' : 'Walk-forward variance high.'}`
    : `v4 underperforms v3 on ${v4Loses.length} metrics. Consider loosening MIN_SIGNAL_QUALITY.`;
  return { symbol, bars: k15.length, v3, v4, v4WalkForward: v4wf, verdict: { winRateDelta, profitFactorDelta, returnDelta, maxDdDelta, signalFilterRate, v4Wins, v4Loses, summary } };
}
