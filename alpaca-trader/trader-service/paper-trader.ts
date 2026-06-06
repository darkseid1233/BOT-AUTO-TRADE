import { log } from './logger.js';
import { getRiskConfig } from './risk.js';
import { applySizeMultiplier, getStrategyConfig } from './strategy-config.js';
import { recordTrade } from './trade-journal.js';
import type { AlpacaClient } from './alpaca-client.js';
import type { Signal, OpenPosition, ClosedTrade, BotStats, EquityPoint } from './types.js';

/** Fallback starting balance when no Alpaca account is connected. */
const DEFAULT_BALANCE = Number(process.env.INITIAL_BALANCE ?? 100000);

/**
 * Balance-aware paper trader with Trailing Stop + Partial TP L1/L2.
 *
 * Position lifecycle after entry:
 *   L1 hit (1R)  → close partialTpL1ClosePct% of qty, move SL to breakeven+buffer
 *   L2 hit (2R)  → close another partialTpL2ClosePct% of qty, activate chandelier trailing stop
 *   Trailing     → SL follows price by trailingAtrMult × ATR; never moves against the trade
 *   Full TP      → close remaining qty at takeProfit
 *   SL hit       → close all remaining qty at stop level
 *
 * Risk caps (unchanged):
 *   1. Per-trade risk cap     — max loss = balance × riskPerTradePct
 *   2. Total-exposure cap     — sum open notionals ≤ balance × maxTotalExposurePct
 *   3. Daily loss limit       — auto-pause when day's loss ≥ dailyMaxLossPct
 *   4. Drawdown stop          — auto-pause when equity falls maxDrawdownStopPct below peak
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
  /** Total fees + slippage paid across all closes (for transparency in stats). */
  private totalCosts = 0;

  /**
   * Apply slippage to a fill price so paper execution matches reality.
   * Exits always slip AGAINST the position (worse fill): a LONG sells lower,
   * a SHORT buys higher. This removes the optimistic "perfect fill" bias that
   * inflated win-rate vs the backtest (which already models costs).
   * @param px the ideal fill price (SL/TP level)
   * @param side position side
   * @param exiting true for exits (slip against), false for entries
   */
  private slip(px: number, side: 'LONG' | 'SHORT', exiting: boolean): number {
    const cfg = getStrategyConfig();
    const s = cfg.slippagePct;
    const longLike = exiting ? side === 'LONG' : side === 'SHORT';
    // Exiting a LONG (sell) → worse = lower; exiting a SHORT (buy) → worse = higher.
    return longLike ? px * (1 - s) : px * (1 + s);
  }

  /** Round-trip-aware taker fee on a given notional. */
  private fee(notional: number): number {
    return Math.abs(notional) * getStrategyConfig().takerFeePct;
  }

  constructor(private client: AlpacaClient, startingBalance = DEFAULT_BALANCE) {
    this.startingBalance = startingBalance;
    this.balance = startingBalance;
    this.dayStartEquity = startingBalance;
    this.peakEquity = startingBalance;
    this.equityCurve = [{ ts: Date.now(), balance: startingBalance }];
  }

  /**
   * Sync balance from Alpaca account. Only allowed while no positions are open.
   * @param balance the new baseline balance
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

  /**
   * Open a position from a signal if ALL risk rules allow.
   * @param signal the trading signal
   * @param riskMultiplier size multiplier from circuit breaker / F&G (0-1)
   */
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

    // Hard guard: SL distance must be at least 0.1% of price to prevent absurd qty
    // (raised from 0.05% — 0.05% on MATIC $0.65 = $0.000325 → qty blows up to 30k+)
    const minSlDist = signal.entry * 0.001;
    if (slDist <= 0 || slDist < minSlDist) {
      log.warn(`[risk] ${signal.symbol} rejected — SL distance ${slDist.toFixed(6)} too small (min ${minSlDist.toFixed(6)}, needs 0.1% of price). Signal SL likely miscalculated.`);
      return null;
    }

    let qty = (riskAmount * Math.max(0.1, Math.min(1, riskMultiplier))) / slDist;
    qty = applySizeMultiplier(qty, signal.symbol);

    // Hard cap: single position can never exceed maxNotionalPct of equity
    const maxNotional = equity * r.maxNotionalPct;
    if (qty * signal.entry > maxNotional) qty = maxNotional / signal.entry;

    // Absolute sanity cap: single position notional can NEVER exceed the full balance
    // (using 1x not 2x — on a $1009 account 2x was still $2018 which is reckless)
    const absoluteCap = this.balance;
    if (qty * signal.entry > absoluteCap) {
      log.warn(`[risk] ${signal.symbol} qty=${qty.toFixed(4)} notional=${(qty * signal.entry).toFixed(2)} exceeds absolute cap ${absoluteCap.toFixed(2)} — hard capping to 1× balance`);
      qty = absoluteCap / signal.entry;
    }

    // Final sanity: qty must produce a notional > $1 after all caps
    if (qty * signal.entry < 1) {
      log.warn(`[risk] ${signal.symbol} notional ${(qty * signal.entry).toFixed(4)} < $1 — skip (signal too noisy)`);
      return null;
    }

    const remainingExposure = equity * r.maxTotalExposurePct - this.totalExposure();
    if (remainingExposure <= 0) {
      log.warn(`[risk] ${signal.symbol} blocked — total exposure cap reached`);
      return null;
    }
    if (qty * signal.entry > remainingExposure) qty = remainingExposure / signal.entry;
    if (qty <= 0) return null;

    const cfg = getStrategyConfig();
    // ATR stored on signal for trailing stop calculations
    const atrValue = signal.indicators?.atr ?? slDist / cfg.atrSlMult;

    const pos: OpenPosition = {
      id: `P${this.idSeq++}`,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: signal.entry,
      markPrice: signal.entry,
      qty,
      qtyRemaining: qty,           // tracks partial closes
      notional: qty * signal.entry,
      stopLoss: signal.stopLoss,
      initialStopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      trailingActive: false,
      trailingStop: signal.stopLoss,
      atrValue,
      l1Hit: false,
      l2Hit: false,
      unrealizedPnl: 0,
      pnlPercent: 0,
      openedAt: Date.now(),
      confidence: signal.confidence,
      context: {
        qualityScore: signal.qualityScore ?? signal.confidence,
        marketRegime: signal.marketRegime ?? 'UNKNOWN',
        btcState: signal.btcState,
        trend1h: signal.trend1h,
        entryReasons: signal.reasons ?? [],
        qualityFactors: signal.qualityFactors,
      },
    };
    this.positions.set(signal.symbol, pos);

    // Mirror order to Alpaca only when explicitly enabled (ENABLE_MIRROR=true).
    // By default this is OFF — paper trader manages positions internally.
    // The old code always tried to place real orders which caused 403 spam when
    // the Alpaca paper account has insufficient crypto balance (it always will
    // for crypto-settled orders on a fresh paper account).
    if (process.env.ENABLE_MIRROR === 'true') {
      try {
        await this.client.placeMarketOrder(
          signal.symbol,
          signal.side === 'LONG' ? 'buy' : 'sell',
          Number(qty.toFixed(6)),
        );
        log.info(`[trader] mirror order placed ${signal.symbol} ${signal.side} qty=${qty.toFixed(6)}`);
      } catch (e) {
        log.debug(`[trader] mirror order skipped ${signal.symbol}: ${(e as Error).message}`);
      }
    }

    // Entry taker fee — charged immediately so the cost model matches the backtest.
    const entryFee = this.fee(qty * signal.entry);
    this.balance -= entryFee;
    this.totalCosts += entryFee;

    const maxLoss = qty * slDist;
    const notional = qty * signal.entry;
    log.info(
      `OPEN ${pos.side} ${pos.symbol} @ ${pos.entryPrice.toFixed(2)} ` +
      `SL=${pos.stopLoss.toFixed(2)} TP=${pos.takeProfit.toFixed(2)} ` +
      `qty=${qty.toFixed(4)} notional=${notional.toFixed(2)} risk=${maxLoss.toFixed(2)} (${(r.riskPerTradePct * 100).toFixed(1)}%) ` +
      `slDist=${slDist.toFixed(6)} conf=${pos.confidence} atr=${atrValue.toFixed(4)}`,
    );
    return pos;
  }

  /**
   * Mark positions to market.
   * Runs Partial TP L1/L2 → trailing stop → full SL/TP logic per position.
   * @param priceFor async function returning the current price for a symbol
   * @returns closed trades this tick
   */
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

      // ── Update unrealized PnL on remaining qty ────────────────────────────────────
      pos.unrealizedPnl = (price - pos.entryPrice) * pos.qtyRemaining * dir;
      pos.pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir;

      // ── Partial TP L1 — close first tranche at 1R ────────────────────────────────
      if (cfg.partialTpEnabled && !pos.l1Hit && slDist > 0) {
        const l1Price = pos.entryPrice + dir * slDist * cfg.partialTpL1R;
        const hitL1 = isLong ? price >= l1Price : price <= l1Price;
        if (hitL1) {
          const qtyToClose = pos.qtyRemaining * (cfg.partialTpL1ClosePct / 100);
          const fillPx = l1Price;
          this.bookPartialClose(pos, fillPx, qtyToClose, 'TP_PARTIAL_L1');
          // Move SL to breakeven + buffer
          const beBuffer = slDist * cfg.breakevenBufferR;
          pos.stopLoss = pos.entryPrice + dir * beBuffer;
          pos.l1Hit = true;
          log.info(
            `⚡ L1 PARTIAL TP ${pos.symbol} @ ${fillPx.toFixed(2)} ` +
            `(${cfg.partialTpL1ClosePct}% qty) SL→breakeven ${pos.stopLoss.toFixed(2)}`,
          );
        }
      }

      // ── Partial TP L2 — close second tranche at 2R, activate trailing ──────────
      if (cfg.partialTpEnabled && pos.l1Hit && !pos.l2Hit && slDist > 0) {
        const l2Price = pos.entryPrice + dir * slDist * cfg.partialTpL2R;
        const hitL2 = isLong ? price >= l2Price : price <= l2Price;
        if (hitL2) {
          const qtyToClose = pos.qtyRemaining * (cfg.partialTpL2ClosePct / 100);
          const fillPx = l2Price;
          this.bookPartialClose(pos, fillPx, qtyToClose, 'TP_PARTIAL_L2');
          // Activate trailing stop on remainder
          pos.trailingActive = true;
          pos.trailingStop = isLong
            ? price - pos.atrValue * cfg.trailingAtrMult
            : price + pos.atrValue * cfg.trailingAtrMult;
          pos.l2Hit = true;
          log.info(
            `⚡ L2 PARTIAL TP ${pos.symbol} @ ${fillPx.toFixed(2)} ` +
            `(${cfg.partialTpL2ClosePct}% qty) trailing ACTIVATED @ ${pos.trailingStop.toFixed(2)}`,
          );
        }
      }

      // ── Chandelier trailing stop — advance with price, NEVER retreats ─────────
      if (pos.trailingActive && pos.qtyRemaining > 0) {
        const newTrail = isLong
          ? price - pos.atrValue * cfg.trailingAtrMult
          : price + pos.atrValue * cfg.trailingAtrMult;
        if (isLong && newTrail > pos.trailingStop) pos.trailingStop = newTrail;
        if (!isLong && newTrail < pos.trailingStop) pos.trailingStop = newTrail;
        // Sync the display SL to the trailing level
        if (isLong && pos.trailingStop > pos.stopLoss) pos.stopLoss = pos.trailingStop;
        if (!isLong && pos.trailingStop < pos.stopLoss) pos.stopLoss = pos.trailingStop;
      }

      // ── Exit checks on remaining qty ─────────────────────────────────────────────
      if (pos.qtyRemaining <= 0) {
        // Position fully closed by partial TPs — remove
        this.positions.delete(pos.symbol);
        continue;
      }

      const hitSl = isLong ? price <= pos.stopLoss : price >= pos.stopLoss;
      const hitTp = isLong ? price >= pos.takeProfit : price <= pos.takeProfit;

      // CONSERVATIVE FILL: if both SL and TP appear hit in the same tick (a wide
      // candle / gap), assume the STOP filled first. The old code preferred TP,
      // which optimistically inflated win-rate. Stop-first is the safe assumption.
      if (hitSl) {
        const reason = pos.trailingActive ? 'TRAILING' : 'SL';
        closed.push(this.closeAt(pos, pos.stopLoss, reason));
      } else if (hitTp) {
        closed.push(this.closeAt(pos, pos.takeProfit, 'TP'));
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

  /**
   * Book a partial close without removing the position.
   * Reduces qtyRemaining and updates balance.
   */
  private bookPartialClose(
    pos: OpenPosition,
    fillPx: number,
    qtyToClose: number,
    tag: string,
  ): void {
    const dir = pos.side === 'LONG' ? 1 : -1;
    const realFill = this.slip(fillPx, pos.side, true);
    const cost = this.fee(realFill * qtyToClose);
    const pnl = (realFill - pos.entryPrice) * qtyToClose * dir - cost;
    this.totalCosts += cost;
    this.balance += pnl;
    pos.qtyRemaining -= qtyToClose;
    pos.notional = pos.qtyRemaining * pos.markPrice;
    // Mirror partial close only when explicitly enabled.
    if (process.env.ENABLE_MIRROR === 'true') {
      this.client
        .placeMarketOrder(pos.symbol, pos.side === 'LONG' ? 'sell' : 'buy', Number(qtyToClose.toFixed(6)))
        .catch((e) => log.debug(`[trader] partial mirror ${pos.symbol} ${tag}: ${(e as Error).message}`));
    }
  }

  private checkDailyStop(limitPct: number): boolean {
    const dailyPnlPct = (this.getEquity() - this.dayStartEquity) / this.dayStartEquity;
    if (dailyPnlPct <= -limitPct) {
      if (!this.paused) {
        this.pause(`daily loss limit ${(limitPct * 100).toFixed(1)}% reached`);
        log.error(`🛑 DAILY STOP — loss ${(dailyPnlPct * 100).toFixed(2)}% ≥ ${(limitPct * 100).toFixed(1)}% limit.`);
      }
      return true;
    }
    return false;
  }

  private checkDrawdownStop(limitPct: number): boolean {
    if (this.peakEquity <= 0) return false;
    const dd = (this.peakEquity - this.getEquity()) / this.peakEquity;
    if (dd >= limitPct) {
      if (!this.paused) {
        this.pause(`max drawdown ${(limitPct * 100).toFixed(1)}% reached`);
        log.error(`🛑 DRAWDOWN STOP — ${(dd * 100).toFixed(2)}% ≥ ${(limitPct * 100).toFixed(1)}% limit.`);
      }
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
    for (const pos of this.positions.values()) {
      closed.push(this.closeAt(pos, pos.markPrice, 'PANIC'));
    }
    return closed;
  }

  private closeAt(pos: OpenPosition, price: number, reason: ClosedTrade['reason']): ClosedTrade {
    const dir = pos.side === 'LONG' ? 1 : -1;
    // Only close the REMAINING qty (earlier partial TPs reduced it)
    const qtyToClose = pos.qtyRemaining > 0 ? pos.qtyRemaining : pos.qty;
    // Apply slippage (against the trade) + taker fee so paper matches backtest reality.
    const realFill = this.slip(price, pos.side, true);
    const cost = this.fee(realFill * qtyToClose);
    const realizedPnl = (realFill - pos.entryPrice) * qtyToClose * dir - cost;
    this.totalCosts += cost;
    this.balance += realizedPnl;
    pos.qtyRemaining = 0;

    if (process.env.ENABLE_MIRROR === 'true') {
      this.client
        .placeMarketOrder(pos.symbol, pos.side === 'LONG' ? 'sell' : 'buy', Number(qtyToClose.toFixed(6)))
        .catch((e) => log.debug(`[trader] mirror close ${pos.symbol}: ${(e as Error).message}`));
    }

    const trade: ClosedTrade = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      closePrice: realFill,
      qty: pos.qty,           // original full qty for journaling
      realizedPnl,
      pnlPercent: ((realFill - pos.entryPrice) / pos.entryPrice) * 100 * dir,
      reason,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      context: pos.context,
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
      entryReasons: pos.context?.entryReasons ?? [],
      qualityFactors: pos.context?.qualityFactors,
    });

    const emoji = realizedPnl >= 0 ? '✅' : '❌';
    log.info(`${emoji} CLOSE ${reason} ${pos.symbol} @ ${price.toFixed(2)} PnL=${realizedPnl.toFixed(2)} (${pos.l1Hit ? 'L1' : ''}${pos.l2Hit ? '+L2' : ''} hit, trailing=${pos.trailingActive})`);
    return trade;
  }

  getEquity(): number {
    let unreal = 0;
    for (const p of this.positions.values()) unreal += p.unrealizedPnl;
    return this.balance + unreal;
  }

  /**
   * Per-symbol performance breakdown — used by dashboard analytics panel.
   * Inspired by Freqtrade's `enter_tag_performance` and `exit_reason_performance`.
   */
  getPerSymbolStats(): Record<string, {
    trades: number; wins: number; winRate: number;
    totalPnl: number; avgWin: number; avgLoss: number;
    bestTrade: number; worstTrade: number;
    avgDurationMs: number; reasons: Record<string, number>;
  }> {
    const map: Record<string, { trades: number; wins: number; winRate: number; totalPnl: number; avgWin: number; avgLoss: number; bestTrade: number; worstTrade: number; avgDurationMs: number; reasons: Record<string, number> }> = {};
    for (const t of this.history) {
      if (!map[t.symbol]) {
        map[t.symbol] = { trades: 0, wins: 0, winRate: 0, totalPnl: 0, avgWin: 0, avgLoss: 0,
          bestTrade: -Infinity, worstTrade: Infinity, avgDurationMs: 0, reasons: {} };
      }
      const s = map[t.symbol];
      s.trades++;
      s.totalPnl += t.realizedPnl;
      if (t.realizedPnl > 0) { s.wins++; s.avgWin += t.realizedPnl; }
      else { s.avgLoss += Math.abs(t.realizedPnl); }
      if (t.realizedPnl > s.bestTrade) s.bestTrade = t.realizedPnl;
      if (t.realizedPnl < s.worstTrade) s.worstTrade = t.realizedPnl;
      s.avgDurationMs += (t.closedAt - t.openedAt);
      s.reasons[t.reason] = (s.reasons[t.reason] ?? 0) + 1;
    }
    for (const s of Object.values(map)) {
      const sym = s as any;
      sym.winRate = sym.trades ? (sym.wins / sym.trades) * 100 : 0;
      sym.avgWin = sym.wins ? sym.avgWin / sym.wins : 0;
      sym.avgLoss = (sym.trades - sym.wins) ? sym.avgLoss / (sym.trades - sym.wins) : 0;
      sym.avgDurationMs = sym.trades ? sym.avgDurationMs / sym.trades : 0;
      if (sym.bestTrade === -Infinity) sym.bestTrade = 0;
      if (sym.worstTrade === Infinity) sym.worstTrade = 0;
    }
    return map as any;
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
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (meanRet / std) * Math.sqrt(returns.length || 1) : 0;
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
      totalCosts: this.totalCosts,
    };
  }
}
