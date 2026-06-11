/**
 * Performance Metrics — institutional-grade analytics.
 *
 * Implements the metrics used by professional quant funds and top open-source
 * bots (Jesse, Nautilus Trader, QuantConnect, Freqtrade):
 *
 *  • Sharpe Ratio    — risk-adjusted return (annualised). Standard in all funds.
 *  • Sortino Ratio   — like Sharpe but only penalises DOWNSIDE volatility.
 *                      Better for strategies with asymmetric payoffs.
 *  • Profit Factor   — gross profit / gross loss. PF > 1.5 = good, > 2.0 = great.
 *  • Calmar Ratio    — CAGR / max drawdown. Used by CTA funds.
 *  • Recovery Factor — total net profit / max drawdown.
 *  • Expectancy      — average $ earned per trade (E = WR×avgWin − LR×avgLoss).
 *  • Win/Loss rate, avg hold time, best/worst trade.
 *
 * All calculations are pure functions (no side effects) operating on the
 * closed-trade history array that already exists in paper-trader.ts.
 */

import type { ClosedTrade } from './types.js';

/** Annualisation constant for 15-min bars (Freqtrade uses same approach). */
const BARS_PER_YEAR = 365 * 24 * 4; // 15-min bars in a year

export type PerformanceReport = {
  /** Total closed trades in the window. */
  totalTrades: number;
  /** Win rate as a fraction [0, 1]. */
  winRate: number;
  /** Loss rate as a fraction [0, 1]. */
  lossRate: number;
  /** Average profit on winning trades (as %). */
  avgWinPct: number;
  /** Average loss on losing trades (as %, positive number). */
  avgLossPct: number;
  /** Gross profit / gross loss. > 1 = system makes money. */
  profitFactor: number;
  /**
   * Expected return per trade as a % of capital.
   * Positive = edge. Formula: WR × avgWin − LR × avgLoss.
   */
  expectancyPct: number;
  /** Annualised Sharpe ratio (risk-free rate = 0, conservative). */
  sharpeRatio: number;
  /** Annualised Sortino ratio (penalises only downside volatility). */
  sortinoRatio: number;
  /** Calmar ratio: CAGR / max drawdown. */
  calmarRatio: number;
  /** Recovery factor: net profit / max drawdown. */
  recoveryFactor: number;
  /** Maximum peak-to-trough drawdown (%). */
  maxDrawdownPct: number;
  /** Average hold time in hours. */
  avgHoldHours: number;
  /** Best single trade PnL (%). */
  bestTradePct: number;
  /** Worst single trade PnL (%). */
  worstTradePct: number;
  /** Consecutive wins peak. */
  maxConsecWins: number;
  /** Consecutive losses peak. */
  maxConsecLosses: number;
  /** Total net PnL ($). */
  netPnl: number;
};

/**
 * Compute the full performance report from a closed-trade history.
 * Returns null when there are fewer than 5 trades (not statistically meaningful).
 * @param trades the closed-trade history (all time, or a window)
 * @param startingBalance the account's starting balance (for drawdown %)
 * @returns performance report or null
 */
export function computePerformance(
  trades: ClosedTrade[],
  startingBalance: number,
): PerformanceReport | null {
  // Filter only fully-closed trades (exclude partial closes which have no definitive outcome).
  const full = trades.filter((t) => t.reason !== 'TP_PARTIAL_L1' && t.reason !== 'TP_PARTIAL_L2');
  if (full.length < 5) return null;

  // ── Basic win/loss breakdown ──────────────────────────────────────────────
  const wins = full.filter((t) => t.realizedPnl > 0);
  const losses = full.filter((t) => t.realizedPnl <= 0);
  const winRate = wins.length / full.length;
  const lossRate = losses.length / full.length;

  const avgWinPct = wins.length > 0
    ? wins.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / wins.length
    : 0;
  const avgLossPct = losses.length > 0
    ? losses.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / losses.length
    : 0;

  // ── Profit Factor ─────────────────────────────────────────────────────────
  const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // ── Expectancy ───────────────────────────────────────────────────────────
  const expectancyPct = winRate * avgWinPct - lossRate * avgLossPct;

  // ── Per-trade returns (% of capital) for Sharpe/Sortino ──────────────────
  const returns = full.map((t) => t.pnlPercent / 100);
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;

  // Sharpe: mean / stddev (annualised). We assume one trade ≈ one 15-min bar
  // for annualisation purposes (conservative — actually spreads risk).
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
  const stddev = Math.sqrt(variance);
  const sharpeRatio = stddev > 0 ? (meanReturn / stddev) * Math.sqrt(BARS_PER_YEAR) : 0;

  // Sortino: only penalise negative returns.
  const downside = returns.filter((r) => r < 0);
  const downVariance = downside.reduce((s, r) => s + r ** 2, 0) / Math.max(returns.length, 1);
  const downStddev = Math.sqrt(downVariance);
  const sortinoRatio = downStddev > 0 ? (meanReturn / downStddev) * Math.sqrt(BARS_PER_YEAR) : 0;

  // ── Max Drawdown (on equity curve reconstructed from trades) ──────────────
  let equity = startingBalance;
  let peak = startingBalance;
  let maxDd = 0;
  for (const t of full) {
    equity += t.realizedPnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const maxDrawdownPct = maxDd * 100;

  // ── Calmar Ratio ─────────────────────────────────────────────────────────
  const netPnl = full.reduce((s, t) => s + t.realizedPnl, 0);
  const holdMs = full.reduce((s, t) => s + (t.closedAt - t.openedAt), 0);
  const totalYears = holdMs / (365 * 24 * 3_600_000) || 1 / 12; // at least 1 month
  const cagr = (Math.pow((startingBalance + netPnl) / startingBalance, 1 / totalYears) - 1) * 100;
  const calmarRatio = maxDd > 0 ? cagr / (maxDd * 100) : 0;

  // ── Recovery Factor ───────────────────────────────────────────────────────
  const recoveryFactor = maxDd > 0 ? (netPnl / startingBalance * 100) / (maxDd * 100) : 0;

  // ── Avg hold time ─────────────────────────────────────────────────────────
  const avgHoldMs = full.reduce((s, t) => s + (t.closedAt - t.openedAt), 0) / full.length;
  const avgHoldHours = avgHoldMs / 3_600_000;

  // ── Best / worst trade ───────────────────────────────────────────────────
  const bestTradePct = Math.max(...full.map((t) => t.pnlPercent));
  const worstTradePct = Math.min(...full.map((t) => t.pnlPercent));

  // ── Consecutive wins/losses ───────────────────────────────────────────────
  let maxConsecWins = 0; let maxConsecLosses = 0;
  let curW = 0; let curL = 0;
  for (const t of full) {
    if (t.realizedPnl > 0) { curW++; curL = 0; maxConsecWins = Math.max(maxConsecWins, curW); }
    else { curL++; curW = 0; maxConsecLosses = Math.max(maxConsecLosses, curL); }
  }

  return {
    totalTrades: full.length,
    winRate,
    lossRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    expectancyPct,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    recoveryFactor,
    maxDrawdownPct,
    avgHoldHours,
    bestTradePct,
    worstTradePct,
    maxConsecWins,
    maxConsecLosses,
    netPnl,
  };
}

/**
 * Kelly Criterion position sizing.
 *
 * Kelly fraction = WR - (LR / R) where R = avgWin / avgLoss.
 * We use HALF-Kelly (conservative, used by most professional quants) to account
 * for estimation error. The result is clamped to [minPct, maxPct] of equity.
 *
 * When insufficient trade history exists, falls back to the configured fixed
 * riskPerTradePct — so the bot trades sensibly from the first trade.
 *
 * @param history closed-trade history (min 20 trades for meaningful Kelly)
 * @param fallbackPct the configured fixed risk % (e.g. 0.02 = 2%)
 * @returns risk fraction [0.005, 0.05] to use for THIS trade
 */
export function kellyRiskPct(history: ClosedTrade[], fallbackPct: number): number {
  const MIN_PCT = 0.005;  // never risk less than 0.5%
  const MAX_PCT = 0.05;   // never risk more than 5% (half-Kelly cap)

  const full = history.filter((t) => t.reason !== 'TP_PARTIAL_L1' && t.reason !== 'TP_PARTIAL_L2');
  if (full.length < 20) return fallbackPct;  // not enough data

  const wins = full.filter((t) => t.realizedPnl > 0);
  const losses = full.filter((t) => t.realizedPnl <= 0);
  if (wins.length === 0 || losses.length === 0) return fallbackPct;

  const winRate = wins.length / full.length;
  const avgWin = wins.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / wins.length;
  const avgLoss = losses.reduce((s, t) => s + Math.abs(t.pnlPercent), 0) / losses.length;
  if (avgLoss === 0) return fallbackPct;

  const R = avgWin / avgLoss;
  const kelly = winRate - (1 - winRate) / R;
  // Half-Kelly (standard conservative application)
  const halfKelly = kelly / 2;

  const result = Math.max(MIN_PCT, Math.min(MAX_PCT, halfKelly / 100));
  return result;
}
