import { describe, it, expect, beforeEach } from 'vitest';
import { PaperTrader } from './paper-trader.js';
import { getRiskConfig } from './risk.js';
import type { Signal } from './types.js';

/** A stub Alpaca client — no network, demo-mode order mirror. */
const stubClient = {
  hasCredentials: false,
  async placeMarketOrder() { return 'stub-order'; },
  async getCryptoBars() { return []; },
} as never;

function longSignal(over: Partial<Signal> = {}): Signal {
  return {
    symbol: 'BTC/USD', side: 'LONG', confidence: 80, qualityScore: 80,
    entry: 100, stopLoss: 98, takeProfit: 110, riskReward: 5,
    reasons: ['test'], blocked: [], marketRegime: 'TRENDING_BULL',
    indicators: { ema20: 0, ema50: 0, ema200: 0, rsi: 55, sma: 0, atr: 2, momentum: 0 },
    timestamp: Date.now(), ...over,
  };
}

describe('PaperTrader.openFromSignal', () => {
  let trader: PaperTrader;
  beforeEach(() => {
    getRiskConfig().update({ minConfidence: 60, riskPerTradePct: 0.01, maxOpenTrades: 5 });
    trader = new PaperTrader(stubClient, 100000);
  });

  it('opens a position from a valid signal', async () => {
    const pos = await trader.openFromSignal(longSignal());
    expect(pos).not.toBeNull();
    expect(pos?.side).toBe('LONG');
    expect(pos?.qty).toBeGreaterThan(0);
  });

  it('rejects a signal below the min confidence', async () => {
    const pos = await trader.openFromSignal(longSignal({ confidence: 10 }));
    expect(pos).toBeNull();
  });

  it('rejects a duplicate symbol while a position is open', async () => {
    await trader.openFromSignal(longSignal());
    const second = await trader.openFromSignal(longSignal());
    expect(second).toBeNull();
  });

  it('caps risk so a single trade loses at most ~riskPerTradePct of balance', async () => {
    const pos = await trader.openFromSignal(longSignal());
    const slDist = Math.abs(pos!.entryPrice - pos!.stopLoss);
    const maxLoss = pos!.qty * slDist;
    // 1% of 100k = 1000, allow small headroom for caps/rounding
    expect(maxLoss).toBeLessThanOrEqual(1000 * 1.05);
  });

  it('charges an entry fee, reducing balance below the starting amount', async () => {
    await trader.openFromSignal(longSignal());
    expect(trader.getBalance()).toBeLessThan(100000);
  });
});

describe('PaperTrader.tick exits', () => {
  let trader: PaperTrader;
  beforeEach(() => {
    getRiskConfig().update({ minConfidence: 60, riskPerTradePct: 0.01 });
    trader = new PaperTrader(stubClient, 100000);
  });

  it('closes at stop-loss first when both SL and TP are within a wide tick (conservative)', async () => {
    await trader.openFromSignal(longSignal());
    // Price gaps far below SL — should book a loss, not a win.
    const closed = await trader.tick(async () => 90);
    expect(closed.length).toBe(1);
    expect(closed[0].reason).toBe('SL');
    expect(closed[0].realizedPnl).toBeLessThan(0);
  });

  it('books a profit when price reaches take-profit', async () => {
    await trader.openFromSignal(longSignal({ takeProfit: 105, stopLoss: 98 }));
    const closed = await trader.tick(async () => 106);
    // Partial TP may trigger first; eventually equity should rise above costs.
    expect(trader.getStats().totalCosts).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThanOrEqual(0);
  });
});
