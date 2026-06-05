import { log } from './logger.js';
import { getRiskConfig } from './risk.js';
import { applySizeMultiplier, getStrategyConfig } from './strategy-config.js';
import { recordTrade } from './trade-journal.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal, OpenPosition, ClosedTrade, BotStats, EquityPoint } from './types.js';

const DEFAULT_BALANCE = Number(process.env.INITIAL_BALANCE ?? 100000);

/**
 * Balance-aware paper trader with Trailing Stop + Partial TP L1/L2.
 *
 * Position lifecycle after entry:
 *   L1 hit (1R)  -> close L1% of qty, SL -> breakeven+buffer
 *   L2 hit (2R)  -> close L2% of qty, activate chandelier trailing
 *   Trailing     -> SL follows price by trailingAtrMult x ATR (never retreats)
 *   Full TP      -> close remaining qty at takeProfit
 *   SL hit       -> close all remaining qty AT stop level (caps loss)
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

  setBalance(balance: number): void {
    if (this.positions.size > 0 || !Number.isFinite(balance) || balance <= 0) return;
    this.startingBalance = balance; this.balance = balance;
    this.dayStartEquity = balance; this.peakEquity = balance;
    this.equityCurve = [{ ts: Date.now(), balance }];
    log.info(`[trader] balance baseline set to $${balance.toLocaleString()}`);
  }

  pause(reason = 'manual'): void { this.paused = true; this.pausedReason = reason; }
  resume(): void { this.paused = false; this.pausedReason = ''; }
  isPaused(): boolean { return this.paused; }
  getPausedReason(): string { return this.pausedReason; }
  getOpenPositions(): OpenPosition[] { return Array.from(this.positions.values()); }
  getHistory(limit = 100): ClosedTrade[] { return this.history.slice(-limit).reverse(); }
  getEquityCurve(): EquityPoint[] { return this.equityCurve.slice(-500); }
  getBalance(): number { return this.balance; }

  private totalExposure(): number {
    let sum = 0;
    for (const p of this.positions.values()) sum += Math.abs(p.markPrice * p.qty);
    return sum;
  }

  async openFromSignal(signal: Signal, riskMultiplier = 1.0): Promise<OpenPosition | null> {
    if (this.paused) return null;
    if (signal.side === 'NEUTRAL') return null;
    if (this.positions.has(signal.symbol)) return null;
    const r = this.risk.get();
    if (this.checkDailyStop(r.dailyMaxLossPct)) return null;
    if (this.checkDrawdownStop(r.maxDrawdownStopPct)) return null;
    if (signal.confidence < r.minConfidence) return null;
    if (this.positions.size >= r.maxOpenTrades) return null;
    const equity = this.getEquity();
    const riskAmount = equity * r.riskPerTradePct;
    const slDist = Math.abs(signal.entry - signal.stopLoss);
    if (slDist <= 0) return null;
    let qty = (riskAmount * Math.max(0.1, Math.min(1, riskMultiplier))) / slDist;
    qty = applySizeMultiplier(qty, signal.symbol);
    const maxNotional = equity * r.maxNotionalPct;
    if (qty * signal.entry > maxNotional) qty = maxNotional / signal.entry;
    const remainingExposure = equity * r.maxTotalExposurePct - this.totalExposure();
    if (remainingExposure <= 0) { log.warn(`[risk] ${signal.symbol} blocked — exposure cap`); return null; }
    if (qty * signal.entry > remainingExposure) qty = remainingExposure / signal.entry;
    if (qty <= 0) return null;
    const cfg = getStrategyConfig();
    const atrValue = signal.indicators?.atr ?? slDist / cfg.atrSlMult;
    const pos: OpenPosition = {
      id: `P${this.idSeq++}`,
      symbol: signal.symbol, side: signal.side,
      entryPrice: signal.entry, markPrice: signal.entry,
      qty, qtyRemaining: qty,
      notional: qty * signal.entry,
      stopLoss: signal.stopLoss, initialStopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      trailingActive: false, trailingStop: signal.stopLoss,
      atrValue, l1Hit: false, l2Hit: false,
      unrealizedPnl: 0, pnlPercent: 0,
      openedAt: Date.now(), confidence: signal.confidence,
      context: {
        qualityScore: signal.qualityScore ?? signal.confidence,
        marketRegime: signal.marketRegime ?? 'UNKNOWN',
        btcState: signal.btcState, trend1h: signal.trend1h,
        entryReasons: signal.reasons ?? [], qualityFactors: signal.qualityFactors,
      },
    };
    this.positions.set(signal.symbol, pos);
    this.client.placeMarketOrder(signal.symbol, signal.side === 'LONG' ? 'buy' : 'sell', Number(qty.toFixed(6)))
      .catch((e) => log.warn(`[trader] mirror order ${signal.symbol}: ${(e as Error).message}`));
    log.info(`OPEN ${pos.side} ${pos.symbol} @ ${pos.entryPrice.toFixed(2)} SL=${pos.stopLoss.toFixed(2)} TP=${pos.takeProfit.toFixed(2)} qty=${qty.toFixed(4)} atr=${atrValue.toFixed(4)}`);
    return pos;
  }

  async tick(priceFor: (symbol: string) => Promise<number>): Promise<ClosedTrade[]> {
    const cfg = getStrategyConfig();
    const closed: ClosedTrade[] = [];
    for (const pos of this.positions.values()) {
      let price = pos.markPrice;
      try { price = await priceFor(pos.symbol); } catch { /* keep last mark */ }
      pos.markPrice = price;
      const isLong = pos.side === 'LONG';
      const dir = isLong ? 1 : -1;
      const slDist = Math.abs(pos.entryPrice - pos.initialStopLoss);
      pos.unrealizedPnl = (price - pos.entryPrice) * pos.qtyRemaining * dir;
      pos.pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir;

      // L1 Partial TP
      if (cfg.partialTpEnabled && !pos.l1Hit && slDist > 0) {
        const l1px = pos.entryPrice + dir * slDist * cfg.partialTpL1R;
        if (isLong ? price >= l1px : price <= l1px) {
          this.bookPartialClose(pos, l1px, pos.qtyRemaining * (cfg.partialTpL1ClosePct / 100), 'TP_PARTIAL_L1');
          const beBuffer = slDist * cfg.breakevenBufferR;
          pos.stopLoss = pos.entryPrice + dir * beBuffer;
          pos.l1Hit = true;
          log.info(`L1 TP ${pos.symbol} @ ${l1px.toFixed(2)} SL->BE ${pos.stopLoss.toFixed(2)}`);
        }
      }
      // L2 Partial TP + activate trailing
      if (cfg.partialTpEnabled && pos.l1Hit && !pos.l2Hit && slDist > 0) {
        const l2px = pos.entryPrice + dir * slDist * cfg.partialTpL2R;
        if (isLong ? price >= l2px : price <= l2px) {
          this.bookPartialClose(pos, l2px, pos.qtyRemaining * (cfg.partialTpL2ClosePct / 100), 'TP_PARTIAL_L2');
          pos.trailingActive = true;
          pos.trailingStop = isLong ? price - pos.atrValue * cfg.trailingAtrMult : price + pos.atrValue * cfg.trailingAtrMult;
          pos.l2Hit = true;
          log.info(`L2 TP ${pos.symbol} @ ${l2px.toFixed(2)} trailing ACTIVE @ ${pos.trailingStop.toFixed(2)}`);
        }
      }
      // Advance chandelier trailing
      if (pos.trailingActive && pos.qtyRemaining > 0) {
        const newTrail = isLong ? price - pos.atrValue * cfg.trailingAtrMult : price + pos.atrValue * cfg.trailingAtrMult;
        if (isLong && newTrail > pos.trailingStop) pos.trailingStop = newTrail;
        if (!isLong && newTrail < pos.trailingStop) pos.trailingStop = newTrail;
        if (isLong && pos.trailingStop > pos.stopLoss) pos.stopLoss = pos.trailingStop;
        if (!isLong && pos.trailingStop < pos.stopLoss) pos.stopLoss = pos.trailingStop;
      }
      // Position fully closed by partials
      if (pos.qtyRemaining <= 0) { this.positions.delete(pos.symbol); continue; }
      // Final exit
      const hitSl = isLong ? price <= pos.stopLoss : price >= pos.stopLoss;
      const hitTp = isLong ? price >= pos.takeProfit : price <= pos.takeProfit;
      if (hitTp || hitSl) {
        const fill = hitTp ? pos.takeProfit : pos.stopLoss;
        const reason = hitTp ? 'TP' : (pos.trailingActive ? 'TRAILING' : 'SL');
        closed.push(this.closeAt(pos, fill, reason));
      }
    }
    const equity = this.getEquity();
    if (equity > this.peakEquity) this.peakEquity = equity;
    if (closed.length > 0) this.equityCurve.push({ ts: Date.now(), balance: equity });
    const r = this.risk.get();
    this.checkDailyStop(r.dailyMaxLossPct);
    this.checkDrawdownStop(r.maxDrawdownStopPct);
    return closed;
  }

  private bookPartialClose(pos: OpenPosition, fillPx: number, qtyToClose: number, tag: string): void {
    const dir = pos.side === 'LONG' ? 1 : -1;
    this.balance += (fillPx - pos.entryPrice) * qtyToClose * dir;
    pos.qtyRemaining -= qtyToClose;
    pos.notional = pos.qtyRemaining * pos.markPrice;
    this.client.placeMarketOrder(pos.symbol, pos.side === 'LONG' ? 'sell' : 'buy', Number(qtyToClose.toFixed(6)))
      .catch((e) => log.warn(`[trader] partial mirror ${pos.symbol} ${tag}: ${(e as Error).message}`));
  }

  private checkDailyStop(limitPct: number): boolean {
    const pct = (this.getEquity() - this.dayStartEquity) / this.dayStartEquity;
    if (pct <= -limitPct) {
      if (!this.paused) { this.pause('daily loss limit reached'); log.error(`DAILY STOP ${(pct * 100).toFixed(2)}%`); }
      return true;
    }
    return false;
  }

  private checkDrawdownStop(limitPct: number): boolean {
    if (this.peakEquity <= 0) return false;
    const dd = (this.peakEquity - this.getEquity()) / this.peakEquity;
    if (dd >= limitPct) {
      if (!this.paused) { this.pause('max drawdown reached'); log.error(`DRAWDOWN STOP ${(dd * 100).toFixed(2)}%`); }
      return true;
    }
    return false;
  }

  async closePosition(symbol: string): Promise<ClosedTrade | null> {
    const pos = this.positions.get(symbol);
    if (!pos) return null;
    return this.closeAt(pos, pos.markPrice, 'MANUAL');
  }

  async closeAll(): Promise<ClosedTrade[]> {
    const closed: ClosedTrade[] = [];
    for (const pos of this.positions.values()) closed.push(this.closeAt(pos, pos.markPrice, 'PANIC'));
    return closed;
  }

  private closeAt(pos: OpenPosition, price: number, reason: ClosedTrade['reason']): ClosedTrade {
    const dir = pos.side === 'LONG' ? 1 : -1;
    const qtyToClose = pos.qtyRemaining > 0 ? pos.qtyRemaining : pos.qty;
    const realizedPnl = (price - pos.entryPrice) * qtyToClose * dir;
    this.balance += realizedPnl;
    pos.qtyRemaining = 0;
    this.client.placeMarketOrder(pos.symbol, pos.side === 'LONG' ? 'sell' : 'buy', Number(qtyToClose.toFixed(6)))
      .catch((e) => log.warn(`[trader] mirror close ${pos.symbol}: ${(e as Error).message}`));
    const trade: ClosedTrade = {
      id: pos.id, symbol: pos.symbol, side: pos.side,
      entryPrice: pos.entryPrice, closePrice: price,
      qty: pos.qty, realizedPnl,
      pnlPercent: ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir,
      reason, openedAt: pos.openedAt, closedAt: Date.now(), context: pos.context,
    };
    this.history.push(trade);
    this.positions.delete(pos.symbol);
    recordTrade({
      id: trade.id, symbol: trade.symbol, side: trade.side,
      entryPrice: trade.entryPrice, closePrice: trade.closePrice, qty: trade.qty,
      realizedPnl: trade.realizedPnl, pnlPercent: trade.pnlPercent, reason: trade.reason,
      openedAt: trade.openedAt, closedAt: trade.closedAt,
      holdMinutes: (trade.closedAt - trade.openedAt) / 60_000, won: realizedPnl > 0,
      qualityScore: pos.context?.qualityScore ?? pos.confidence,
      marketRegime: pos.context?.marketRegime ?? 'UNKNOWN',
      btcState: pos.context?.btcState, trend1h: pos.context?.trend1h,
      entryReasons: pos.context?.entryReasons ?? [], qualityFactors: pos.context?.qualityFactors,
    });
    const emoji = realizedPnl >= 0 ? 'WIN' : 'LOSS';
    log.info(`${emoji === 'WIN' ? '' : ''} CLOSE ${reason} ${pos.symbol} @ ${price.toFixed(2)} PnL=${realizedPnl.toFixed(2)} (L1=${pos.l1Hit} L2=${pos.l2Hit} trail=${pos.trailingActive})`);
    return trade;
  }

  getEquity(): number {
    let unreal = 0;
    for (const p of this.positions.values()) unreal += p.unrealizedPnl;
    return this.balance + unreal;
  }

  getStats(): BotStats {
    const wins = this.history.filter((t) => t.realizedPnl > 0);
    const losses = this.history.filter((t) => t.realizedPnl <= 0);
    const grossWin = wins.reduce((a, t) => a + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0));
    const equity = this.getEquity();
    const totalPnl = equity - this.startingBalance;
    const returns = this.history.map((t) => t.pnlPercent);
    const meanRet = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length ? returns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / returns.length : 0;
    const sharpe = Math.sqrt(variance) > 0 ? (meanRet / Math.sqrt(variance)) * Math.sqrt(returns.length || 1) : 0;
    let peak = this.startingBalance, maxDd = 0;
    for (const p of this.equityCurve) {
      if (p.balance > peak) peak = p.balance;
      const dd = ((peak - p.balance) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
    return {
      balance: this.balance, startingBalance: this.startingBalance, equity, totalPnl,
      totalPnlPct: this.startingBalance ? (totalPnl / this.startingBalance) * 100 : 0,
      dailyPnl: equity - this.dayStartEquity,
      dailyPnlPct: this.dayStartEquity ? ((equity - this.dayStartEquity) / this.dayStartEquity) * 100 : 0,
      winRate: this.history.length ? (wins.length / this.history.length) * 100 : 0,
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? null : 0) : grossWin / grossLoss,
      sharpeRatio: sharpe, maxDrawdownPct: maxDd,
      totalTrades: this.history.length, wins: wins.length, losses: losses.length,
      openPositions: this.positions.size,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      expectancy: this.history.length ? totalPnl / this.history.length : 0,
      availableUSDT: this.balance, paused: this.paused,
    };
  }
}
