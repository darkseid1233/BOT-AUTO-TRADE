import { log } from './logger.js';
import { getRiskConfig } from './risk.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal, OpenPosition, ClosedTrade, BotStats, EquityPoint } from './types.js';

/** Fallback starting balance when no Alpaca account is connected. */
const DEFAULT_BALANCE = Number(process.env.INITIAL_BALANCE ?? 100000);

/**
 * Balance-aware paper trader.
 *
 * Every position is sized as a PERCENTAGE of the current account balance, never
 * a fixed dollar amount — so a $1,000 account behaves exactly like a $100,000
 * one, just scaled down. A single trade can only ever risk `riskPerTradePct`
 * of the balance (the stop-loss distance), and three independent safety stops
 * protect the account from being wiped:
 *
 *   1. Per-trade risk cap     — max loss per trade = balance × riskPerTradePct.
 *   2. Total-exposure cap     — sum of open notionals ≤ balance × maxTotalExposurePct.
 *   3. Daily loss limit       — auto-pause when the day's loss ≥ dailyMaxLossPct.
 *   4. Drawdown stop          — auto-pause when equity falls maxDrawdownStopPct below peak.
 */
export class PaperTrader {
  private startingBalance: number;
  private balance: number;
  private positions = new Map<string, OpenPosition>();
  private history: ClosedTrade[] = [];
  private equityCurve: EquityPoint[];
  private paused = false;
  private pausedReason = '';
  private idSeq = 1;
  private dayStartEquity: number;
  private peakEquity: number;
  private risk = getRiskConfig();

  constructor(private client: AlpacaClient, startingBalance = DEFAULT_BALANCE) {
    this.startingBalance = startingBalance;
    this.balance = startingBalance;
    this.dayStartEquity = startingBalance;
    this.peakEquity = startingBalance;
    this.equityCurve = [{ ts: Date.now(), balance: startingBalance }];
  }

  /**
   * Reset the account to a known balance (e.g. synced from the real Alpaca
   * account on connect). Only allowed while no positions are open.
   * @param balance the balance to set as the new baseline
   */
  setBalance(balance: number): void {
    if (this.positions.size > 0 || !Number.isFinite(balance) || balance <= 0) return;
    this.startingBalance = balance;
    this.balance = balance;
    this.dayStartEquity = balance;
    this.peakEquity = balance;
    this.equityCurve = [{ ts: Date.now(), balance }];
    log.info(`[trader] balance baseline set to $${balance.toLocaleString()}`);
  }

  /** Pause opening new trades. @param reason optional human reason */
  pause(reason = 'manual'): void {
    this.paused = true;
    this.pausedReason = reason;
  }

  /** Resume opening new trades and clear any safety stop. */
  resume(): void {
    this.paused = false;
    this.pausedReason = '';
  }

  /** @returns whether the trader is paused. */
  isPaused(): boolean { return this.paused; }

  /** @returns the reason the trader is paused, if any. */
  getPausedReason(): string { return this.pausedReason; }

  /** @returns the list of currently open positions. */
  getOpenPositions(): OpenPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * @param limit max trades to return (newest first)
   * @returns closed trade history
   */
  getHistory(limit = 100): ClosedTrade[] {
    return this.history.slice(-limit).reverse();
  }

  /** @returns the equity curve points. */
  getEquityCurve(): EquityPoint[] {
    return this.equityCurve.slice(-500);
  }

  /** @returns total notional currently committed across all open positions. */
  private totalExposure(): number {
    let sum = 0;
    for (const p of this.positions.values()) sum += Math.abs(p.markPrice * p.qty);
    return sum;
  }

  /**
   * Open a position from a signal if ALL risk rules allow.
   * @param signal the trading signal
   * @returns the opened position, or null if blocked by a risk rule
   */
  async openFromSignal(signal: Signal): Promise<OpenPosition | null> {
    if (this.paused) return null;
    if (signal.side === 'NEUTRAL') return null;
    if (this.positions.has(signal.symbol)) return null;

    const r = this.risk.get();

    // ── Safety stops checked before any new trade ──────────────────────────
    if (this.checkDailyStop(r.dailyMaxLossPct)) return null;
    if (this.checkDrawdownStop(r.maxDrawdownStopPct)) return null;
    if (signal.confidence < r.minConfidence) return null;
    if (this.positions.size >= r.maxOpenTrades) return null;

    const equity = this.getEquity();

    // ── Position sizing — % of balance at risk via stop-loss distance ──────
    const riskAmount = equity * r.riskPerTradePct;
    const slDist = Math.abs(signal.entry - signal.stopLoss);
    if (slDist <= 0) return null;
    let qty = riskAmount / slDist;

    // Cap notional per trade.
    const maxNotional = equity * r.maxNotionalPct;
    if (qty * signal.entry > maxNotional) qty = maxNotional / signal.entry;

    // Cap TOTAL exposure across all open positions.
    const remainingExposure = equity * r.maxTotalExposurePct - this.totalExposure();
    if (remainingExposure <= 0) {
      log.warn(`[risk] ${signal.symbol} blocked — total exposure cap reached`);
      return null;
    }
    if (qty * signal.entry > remainingExposure) qty = remainingExposure / signal.entry;

    if (qty <= 0) return null;
    const maxLoss = qty * slDist;

    const pos: OpenPosition = {
      id: `P${this.idSeq++}`,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: signal.entry,
      markPrice: signal.entry,
      qty,
      notional: qty * signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      unrealizedPnl: 0,
      pnlPercent: 0,
      openedAt: Date.now(),
      confidence: signal.confidence,
    };
    this.positions.set(signal.symbol, pos);

    // Mirror to Alpaca paper account (no-op in demo mode).
    try {
      await this.client.placeMarketOrder(
        signal.symbol,
        signal.side === 'LONG' ? 'buy' : 'sell',
        Number(qty.toFixed(6)),
      );
    } catch (e) {
      log.warn(`[trader] mirror order failed ${signal.symbol}: ${(e as Error).message}`);
    }

    log.info(
      `OPEN ${pos.side} ${pos.symbol} @ ${pos.entryPrice.toFixed(2)} ` +
      `SL=${pos.stopLoss.toFixed(2)} TP=${pos.takeProfit.toFixed(2)} ` +
      `qty=${qty.toFixed(4)} risk=$${maxLoss.toFixed(2)} (${(r.riskPerTradePct * 100).toFixed(1)}%) conf=${pos.confidence}`,
    );
    return pos;
  }

  /**
   * Mark positions to market, close any that hit SL/TP, and enforce safety stops.
   * @param priceFor function returning the current price for a symbol
   * @returns the trades closed during this tick
   */
  async tick(priceFor: (symbol: string) => Promise<number>): Promise<ClosedTrade[]> {
    const closed: ClosedTrade[] = [];
    for (const pos of this.positions.values()) {
      let price = pos.markPrice;
      try {
        price = await priceFor(pos.symbol);
      } catch {
        /* keep last mark */
      }
      pos.markPrice = price;
      const dir = pos.side === 'LONG' ? 1 : -1;
      pos.unrealizedPnl = (price - pos.entryPrice) * pos.qty * dir;
      pos.pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir;

      const hitTp = pos.side === 'LONG' ? price >= pos.takeProfit : price <= pos.takeProfit;
      const hitSl = pos.side === 'LONG' ? price <= pos.stopLoss : price >= pos.stopLoss;
      if (hitTp || hitSl) {
        closed.push(this.closeAt(pos, price, hitTp ? 'TP' : 'SL'));
      }
    }

    const equity = this.getEquity();
    if (equity > this.peakEquity) this.peakEquity = equity;
    if (closed.length > 0) {
      this.equityCurve.push({ ts: Date.now(), balance: equity });
    }

    // Re-check safety stops after marking — auto-pause if a limit is breached.
    const r = this.risk.get();
    this.checkDailyStop(r.dailyMaxLossPct);
    this.checkDrawdownStop(r.maxDrawdownStopPct);

    return closed;
  }

  /**
   * Auto-pause when the day's loss exceeds the configured limit.
   * @param limitPct daily max loss fraction
   * @returns true if the daily stop is active
   */
  private checkDailyStop(limitPct: number): boolean {
    const dailyPnlPct = (this.getEquity() - this.dayStartEquity) / this.dayStartEquity;
    if (dailyPnlPct <= -limitPct) {
      if (!this.paused) {
        this.pause(`daily loss limit ${(limitPct * 100).toFixed(1)}% reached`);
        log.error(`🛑 DAILY STOP — loss ${(dailyPnlPct * 100).toFixed(2)}% ≥ ${(limitPct * 100).toFixed(1)}% limit. Trading paused.`);
      }
      return true;
    }
    return false;
  }

  /**
   * Auto-pause when equity falls too far below its peak.
   * @param limitPct max drawdown fraction
   * @returns true if the drawdown stop is active
   */
  private checkDrawdownStop(limitPct: number): boolean {
    if (this.peakEquity <= 0) return false;
    const dd = (this.peakEquity - this.getEquity()) / this.peakEquity;
    if (dd >= limitPct) {
      if (!this.paused) {
        this.pause(`max drawdown ${(limitPct * 100).toFixed(1)}% reached`);
        log.error(`🛑 DRAWDOWN STOP — ${(dd * 100).toFixed(2)}% ≥ ${(limitPct * 100).toFixed(1)}% limit. Trading paused.`);
      }
      return true;
    }
    return false;
  }

  /**
   * Manually close a single symbol's position at its current mark.
   * @param symbol symbol to close
   * @returns the closed trade, or null if none open
   */
  async closePosition(symbol: string): Promise<ClosedTrade | null> {
    const pos = this.positions.get(symbol);
    if (!pos) return null;
    return this.closeAt(pos, pos.markPrice, 'MANUAL');
  }

  /**
   * Close ALL open positions (panic).
   * @returns the list of closed trades
   */
  async closeAll(): Promise<ClosedTrade[]> {
    const closed: ClosedTrade[] = [];
    for (const pos of this.positions.values()) {
      closed.push(this.closeAt(pos, pos.markPrice, 'PANIC'));
    }
    return closed;
  }

  private closeAt(pos: OpenPosition, price: number, reason: ClosedTrade['reason']): ClosedTrade {
    const dir = pos.side === 'LONG' ? 1 : -1;
    const realizedPnl = (price - pos.entryPrice) * pos.qty * dir;
    this.balance += realizedPnl;

    // Mirror the closing order to Alpaca (reverse side). No-op in demo mode.
    this.client
      .placeMarketOrder(pos.symbol, pos.side === 'LONG' ? 'sell' : 'buy', Number(pos.qty.toFixed(6)))
      .catch((e) => log.warn(`[trader] mirror close failed ${pos.symbol}: ${(e as Error).message}`));

    const trade: ClosedTrade = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      closePrice: price,
      qty: pos.qty,
      realizedPnl,
      pnlPercent: ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir,
      reason,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
    };
    this.history.push(trade);
    this.positions.delete(pos.symbol);
    const emoji = realizedPnl >= 0 ? '✅' : '❌';
    log.info(`${emoji} CLOSE ${reason} ${pos.symbol} @ ${price.toFixed(2)} PnL=${realizedPnl.toFixed(2)}`);
    return trade;
  }

  /** @returns current equity = balance + unrealized PnL of open positions. */
  getEquity(): number {
    let unreal = 0;
    for (const p of this.positions.values()) unreal += p.unrealizedPnl;
    return this.balance + unreal;
  }

  /** @returns aggregate stats for the dashboard. */
  getStats(): BotStats {
    const wins = this.history.filter((t) => t.realizedPnl > 0);
    const losses = this.history.filter((t) => t.realizedPnl <= 0);
    const grossWin = wins.reduce((a, t) => a + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0));
    const equity = this.getEquity();
    const totalPnl = equity - this.startingBalance;
    const returns = this.history.map((t) => t.pnlPercent);
    const meanRet = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length
      ? returns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / returns.length
      : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (meanRet / std) * Math.sqrt(returns.length || 1) : 0;

    // Max drawdown from the equity curve.
    let peak = this.startingBalance;
    let maxDd = 0;
    for (const p of this.equityCurve) {
      if (p.balance > peak) peak = p.balance;
      const dd = ((peak - p.balance) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      balance: this.balance,
      startingBalance: this.startingBalance,
      equity,
      totalPnl,
      totalPnlPct: this.startingBalance ? (totalPnl / this.startingBalance) * 100 : 0,
      dailyPnl: equity - this.dayStartEquity,
      dailyPnlPct: this.dayStartEquity ? ((equity - this.dayStartEquity) / this.dayStartEquity) * 100 : 0,
      winRate: this.history.length ? (wins.length / this.history.length) * 100 : 0,
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? null : 0) : grossWin / grossLoss,
      sharpeRatio: sharpe,
      maxDrawdownPct: maxDd,
      totalTrades: this.history.length,
      wins: wins.length,
      losses: losses.length,
      openPositions: this.positions.size,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      expectancy: this.history.length ? totalPnl / this.history.length : 0,
      availableUSDT: this.balance,
      paused: this.paused,
    };
  }
}
