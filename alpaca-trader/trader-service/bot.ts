/**
 * Bot Orchestrator v2 — integrates all protection layers from bcj2023.
 *
 * Gate order before opening any trade:
 *  1. Session Filter    — London/NY (or 24/7 when ALLOW_ALL_SESSIONS=true)
 *  2. Circuit Breaker   — daily 3% / weekly 8% / streak cooldown
 *  3. Volatility Regime — EXTREME blocks all trades
 *  4. Fear & Greed      — blocks extreme fear LONGs / extreme greed SHORTs
 *  5. Daily Trend       — reduces risk vs major 1H trend
 *  6. Signal Engine v3  — quality-first confidence scoring
 *  7. Paper Trader      — position sizing + risk rules
 *
 * Notifications: Discord + Telegram on open / close / circuit-breaker alerts.
 */
import { log } from './logger.js';
import { AlpacaClient } from './alpaca-client.js';
import { SignalEngine } from './signal-engine.js';
import { PaperTrader } from './paper-trader.js';
import { checkSession } from './session-filter.js';
import {
  initBreaker, checkBreaker, recordTradeOutcome, getBreakerStatus, manualResume,
  registerNotify as registerBreakerNotify,
} from './circuit-breaker.js';
import { getMarketSentiment } from './fear-greed.js';
import { getVolatilityRegime } from './volatility-regime.js';
import { getDailyTrend, setDailyTrendClient } from './daily-trend.js';
import { startNewsLoop } from './news-engine.js';
import { notifyDiscordOpen, notifyDiscordClose, notifyDiscordAlert } from './discord-notifier.js';
import { telegramNotifyOpen, telegramNotifyClose, telegramAlert, telegramStatus } from './telegram-notifier.js';
import type { Signal, BotHealth } from './types.js';

/** Default crypto watchlist (Alpaca symbols). Override with WATCHLIST env. */
const DEFAULT_WATCHLIST = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'LTC/USD',
  'AVAX/USD', 'LINK/USD', 'DOGE/USD', 'MATIC/USD',
];

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_SEC  ?? 30) * 1000;
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_SEC  ?? 10) * 1000;

function parseWatchlist(): string[] {
  const raw = process.env.WATCHLIST;
  if (!raw) return DEFAULT_WATCHLIST;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Combined multiplier applied to position size before open. */
function combineMultipliers(...vals: number[]): number {
  return vals.reduce((acc, v) => acc * v, 1);
}

/**
 * Bot orchestrator — singleton accessed via {@link getBot}.
 */
export class TradingBot {
  readonly client  = new AlpacaClient();
  readonly engine  = new SignalEngine(this.client);
  readonly trader  = new PaperTrader(this.client);
  readonly watchlist = parseWatchlist();

  private lastSignals = new Map<string, Signal>();
  private scanTimer?: ReturnType<typeof setInterval>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private newsTimer?: ReturnType<typeof setInterval>;
  private startedAt = Date.now();
  private scanCount = 0;
  private lastScanAt = 0;
  private alpacaConnected = false;
  private started = false;

  /** Start the scan + tick + news loops. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Wire the AlpacaClient into daily-trend for 1H bar fetching
    setDailyTrendClient(this.client);

    // Wire circuit-breaker alerts into notification channels
    registerBreakerNotify(async (msg) => {
      await Promise.allSettled([notifyDiscordAlert(msg), telegramAlert(msg)]);
    });

    // Load real balance for circuit-breaker baseline
    const acct = await this.client.getAccount();
    this.alpacaConnected = acct.connected;
    const startingBalance = acct.connected ? (acct.equity || acct.cash) : this.trader.getBalance();
    initBreaker(startingBalance);

    log.info(
      `[bot] v2 starting — Alpaca ${acct.connected ? 'CONNECTED' : 'DEMO'} | ` +
      `balance $${startingBalance.toFixed(2)} | watchlist ${this.watchlist.length} | ` +
      `scan ${SCAN_INTERVAL_MS / 1000}s | Session: ${checkSession().session}`,
    );

    if (acct.connected) {
      await telegramStatus(`🤖 AlpacaBot v2 started — balance $${startingBalance.toFixed(2)} | watching ${this.watchlist.join(', ')}`);
    }

    // Start news background loop
    this.newsTimer = startNewsLoop();

    // Initial scan immediately
    this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));

    this.scanTimer = setInterval(() => {
      this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));
    }, SCAN_INTERVAL_MS);

    this.tickTimer = setInterval(() => {
      this.tick().catch((e) => log.error(`[tick] ${(e as Error).message}`));
    }, TICK_INTERVAL_MS);
  }

  /** Stop all loops. */
  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.newsTimer) clearInterval(this.newsTimer);
    this.started = false;
  }

  /**
   * Connect to the Alpaca account with the given API keys.
   * On success, syncs balance baseline to the real account.
   */
  async connectAlpaca(
    keyId: string,
    secret: string,
    paper = true,
  ): Promise<{ ok: boolean; message: string }> {
    this.client.setCredentials(keyId, secret, paper);
    const test = await this.client.testConnection();
    if (!test.ok) {
      this.client.clearCredentials();
      this.alpacaConnected = false;
      log.error(`[bot] Alpaca connection failed: ${test.message}`);
      return test;
    }
    const acct = await this.client.getAccount();
    this.alpacaConnected = acct.connected;
    const baseline = acct.cash || acct.portfolioValue;
    if (baseline > 0) {
      this.trader.setBalance(baseline);
      initBreaker(baseline);
    }
    log.info(`[bot] ✅ Alpaca connected — balance $${baseline.toLocaleString()}`);
    await telegramStatus(`✅ Alpaca connected — balance $${baseline.toFixed(2)}`);
    return { ok: true, message: test.message };
  }

  /** Disconnect from Alpaca and return to demo mode. */
  disconnectAlpaca(): void {
    this.client.clearCredentials();
    this.alpacaConnected = false;
  }

  /** Manually clear the circuit breaker (weekly halt). */
  async resumeBreaker(): Promise<string> {
    const equity = this.trader.getBalance();
    const result = manualResume(equity);
    await telegramStatus(`🔓 Breaker resumed: ${result}`);
    return result;
  }

  /** @returns circuit breaker state snapshot for dashboard. */
  getBreakerStatus() {
    return getBreakerStatus();
  }

  // ── Main scan loop ─────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    this.lastScanAt = Date.now();
    this.scanCount++;

    // ── Gate 1: Session Filter ───────────────────────────────────────────────
    const session = checkSession();
    if (!session.allowed) {
      log.debug(`[scan] ${session.reason} — skipping`);
      return;
    }

    // ── Gate 2: Circuit Breaker ──────────────────────────────────────────────
    const equity = this.trader.getBalance();
    const breaker = checkBreaker(equity);
    if (!breaker.allowed) {
      log.warn(`[scan] Circuit breaker: ${breaker.reason}`);
      return;
    }

    // ── Gate 3: Volatility Regime ────────────────────────────────────────────
    // Quick sanity check on BTC as proxy for overall market volatility
    const btcBars = await this.client.getCryptoBars('BTC/USD', '15Min', 50).catch(() => []);
    let globalVolAllowed = true;
    if (btcBars.length > 16) {
      const volRegime = getVolatilityRegime(
        btcBars.map((b) => b.high),
        btcBars.map((b) => b.low),
        btcBars.map((b) => b.close),
      );
      if (!volRegime.allowed) {
        log.warn(`[scan] ${volRegime.reason}`);
        globalVolAllowed = false;
      }
    }
    if (!globalVolAllowed) return;

    // ── Gate 4: Fear & Greed ─────────────────────────────────────────────────
    const fgResult = await getMarketSentiment().catch(() => null);

    // ── Scan each symbol ─────────────────────────────────────────────────────
    for (const symbol of this.watchlist) {
      try {
        await this.processSymbol(symbol, breaker.riskMultiplier, fgResult);
      } catch (e) {
        log.error(`[scan] ${symbol}: ${(e as Error).message}`);
      }
    }
  }

  private async processSymbol(
    symbol: string,
    breakerMult: number,
    fgResult: Awaited<ReturnType<typeof getMarketSentiment>> | null,
  ): Promise<void> {
    // ── Signal Engine v3 ─────────────────────────────────────────────────────
    const signal = await this.engine.generateSignals([symbol]).then((s) => s[0]);
    this.lastSignals.set(symbol, signal);

    if (signal.side === 'NEUTRAL') return;

    // ── F&G gate for this side ───────────────────────────────────────────────
    if (fgResult) {
      if (fgResult.blockLong && signal.side === 'LONG') {
        log.debug(`[scan] ${symbol} LONG blocked by Fear&Greed: ${fgResult.reason}`);
        this.lastSignals.set(symbol, { ...signal, side: 'NEUTRAL', blocked: [fgResult.reason] });
        return;
      }
      if (fgResult.blockShort && signal.side === 'SHORT') {
        log.debug(`[scan] ${symbol} SHORT blocked by Fear&Greed: ${fgResult.reason}`);
        this.lastSignals.set(symbol, { ...signal, side: 'NEUTRAL', blocked: [fgResult.reason] });
        return;
      }
    }

    // ── Gate 5: Daily/1H Trend ───────────────────────────────────────────────
    const trendResult = await getDailyTrend(symbol, signal.side).catch(() => null);

    // ── Combine risk multipliers ──────────────────────────────────────────────
    const fgMult     = fgResult?.riskMultiplier ?? 1.0;
    const trendMult  = trendResult?.riskMultiplier ?? 1.0;
    const finalMult  = combineMultipliers(breakerMult, fgMult, trendMult);

    // ── Update signal with 1H trend context ──────────────────────────────────
    if (trendResult) {
      this.lastSignals.set(symbol, {
        ...signal,
        trend1h: trendResult.trend1h,
        fearGreed: fgResult?.fearGreed?.value,
      });
    }

    // ── Open position via PaperTrader ─────────────────────────────────────────
    const pos = await this.trader.openFromSignal(signal, finalMult);
    if (pos) {
      log.info(`[scan] ✅ ${symbol} ${signal.side} opened conf=${signal.confidence}% mult=${finalMult.toFixed(2)} riskMult=${finalMult.toFixed(2)}`);

      // Notify open
      await Promise.allSettled([
        notifyDiscordOpen({
          symbol,
          side: signal.side as 'LONG' | 'SHORT',
          entryPrice: pos.entryPrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          notional: pos.notional,
          confidenceScore: signal.confidence,
        }),
        telegramNotifyOpen({
          symbol,
          side: signal.side as 'LONG' | 'SHORT',
          entryPrice: pos.entryPrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          confidence: signal.confidence,
        }),
      ]);
    }
  }

  private async tick(): Promise<void> {
    const closedTrades = await this.trader.tick((symbol) => this.priceFor(symbol));
    if (!closedTrades || closedTrades.length === 0) return;

    for (const trade of closedTrades) {
      const outcome: 'WIN' | 'LOSS' = trade.realizedPnl > 0 ? 'WIN' : 'LOSS';
      recordTradeOutcome(outcome, this.trader.getBalance());

      await Promise.allSettled([
        notifyDiscordClose({
          symbol: trade.symbol,
          side: trade.side as 'LONG' | 'SHORT',
          entryPrice: trade.entryPrice,
          closePrice: trade.closePrice,
          realizedPnl: trade.realizedPnl,
          pnlPercent: trade.pnlPercent,
          reason: trade.reason,
        }),
        telegramNotifyClose({
          symbol: trade.symbol,
          side: trade.side as 'LONG' | 'SHORT',
          entryPrice: trade.entryPrice,
          closePrice: trade.closePrice,
          realizedPnl: trade.realizedPnl,
          pnlPercent: trade.pnlPercent,
          reason: trade.reason,
        }),
      ]);
    }
  }

  private async priceFor(symbol: string): Promise<number> {
    const bars = await this.client.getCryptoBars(symbol, '15Min', 2);
    return bars[bars.length - 1]?.close ?? 0;
  }

  /** @returns all latest signals (one per watchlist symbol). */
  getLastSignals(): Signal[] {
    return Array.from(this.lastSignals.values());
  }

  /** @returns current equity balance from the paper trader. */
  getBalance(): number {
    return this.trader.getBalance();
  }

  isAlpacaConnected(): boolean { return this.alpacaConnected; }

  getHealth(): BotHealth {
    const warnings: string[] = [];
    const lastScanAgoMs = this.lastScanAt ? Date.now() - this.lastScanAt : -1;
    if (lastScanAgoMs > SCAN_INTERVAL_MS * 3) warnings.push('scan loop stalled');
    const breaker = getBreakerStatus();
    if (breaker.dailyHalted)  warnings.push('daily circuit breaker ACTIVE');
    if (breaker.weeklyHalted) warnings.push('weekly circuit breaker ACTIVE');
    if (breaker.activeCooldown) warnings.push(`streak cooldown (${breaker.cooldownMinutesLeft}m left)`);
    return {
      ok: warnings.length === 0,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      scanCount: this.scanCount,
      lastScanAgoMs,
      scanIntervalSec: SCAN_INTERVAL_MS / 1000,
      watchlistSize: this.watchlist.length,
      alpacaConnected: this.alpacaConnected,
      warnings,
    };
  }
}

let instance: TradingBot | null = null;

/**
 * Get the singleton bot instance.
 * @returns the shared {@link TradingBot}
 */
export function getBot(): TradingBot {
  if (!instance) instance = new TradingBot();
  return instance;
}
