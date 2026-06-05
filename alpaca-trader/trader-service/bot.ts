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
  private reconnectTimer?: ReturnType<typeof setInterval>;
  private startedAt = Date.now();
  private scanCount = 0;
  private lastScanAt = 0;
  private alpacaConnected = false;
  private started = false;
  // Auto-reconnect state
  private reconnectKeyId = '';
  private reconnectSecret = '';
  private reconnectPaper = true;
  private consecutiveApiErrors = 0;
  private readonly MAX_API_ERRORS = 5;
  private readonly RECONNECT_INTERVAL_MS = Number(process.env.RECONNECT_INTERVAL_SEC ?? 60) * 1000;
  // Per-symbol SL cooldown — blocks re-entry after a stop-loss for SL_COOLDOWN_MS
  private slCooldowns = new Map<string, number>();
  private readonly SL_COOLDOWN_MS = Number(process.env.SL_COOLDOWN_MINUTES ?? 30) * 60_000;
  // Signal dedup — blocks opening the same side on the same symbol within SIGNAL_DEDUP_MS
  // Prevents "revenge trading" where the bot immediately reopens an identical position
  private lastOpenedAt = new Map<string, { side: string; ts: number }>();
  private readonly SIGNAL_DEDUP_MS = Number(process.env.SIGNAL_DEDUP_MINUTES ?? 15) * 60_000;

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

    // Start auto-reconnect watchdog (checks every RECONNECT_INTERVAL_MS)
    this.reconnectTimer = setInterval(() => {
      this.watchdogReconnect().catch((e) => log.warn(`[reconnect] ${(e as Error).message}`));
    }, this.RECONNECT_INTERVAL_MS);

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
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
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
    // Save credentials for auto-reconnect watchdog
    this.reconnectKeyId = keyId;
    this.reconnectSecret = secret;
    this.reconnectPaper = paper;
    this.consecutiveApiErrors = 0;
    log.info(`[bot] ✅ Alpaca connected — balance ${baseline.toLocaleString()}`);
    await telegramStatus(`✅ Alpaca connected — balance ${baseline.toFixed(2)}`);
    return { ok: true, message: test.message };
  }

  /** Disconnect from Alpaca and return to demo mode. Clears auto-reconnect credentials. */
  disconnectAlpaca(): void {
    this.client.clearCredentials();
    this.alpacaConnected = false;
    this.reconnectKeyId = '';
    this.reconnectSecret = '';
    this.consecutiveApiErrors = 0;
  }

  /**
   * Watchdog: detects Alpaca API errors and attempts to reconnect.
   * Runs every RECONNECT_INTERVAL_MS (default 60s).
   * Only fires when credentials were previously set.
   */
  private async watchdogReconnect(): Promise<void> {
    if (!this.reconnectKeyId || !this.reconnectSecret) return; // demo mode — nothing to reconnect
    if (this.consecutiveApiErrors < this.MAX_API_ERRORS) return; // not enough errors yet

    log.warn(`[reconnect] ${this.consecutiveApiErrors} consecutive API errors — attempting reconnect…`);
    try {
      this.client.setCredentials(this.reconnectKeyId, this.reconnectSecret, this.reconnectPaper);
      const test = await this.client.testConnection();
      if (test.ok) {
        const acct = await this.client.getAccount();
        this.alpacaConnected = acct.connected;
        this.consecutiveApiErrors = 0;
        log.info('[reconnect] ✅ Alpaca reconnected successfully');
        await telegramStatus('🔄 AlpacaBot auto-reconnected to Alpaca after API errors.');
      } else {
        log.warn(`[reconnect] still failing: ${test.message}`);
      }
    } catch (e) {
      log.warn(`[reconnect] error: ${(e as Error).message}`);
    }
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

  // ── Main scan loop ──────────────────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    this.lastScanAt = Date.now();
    this.scanCount++;
    this.consecutiveApiErrors = 0; // reset on successful scan start

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
    const btcBars = await this.client.getCryptoBars('BTC/USD', '15Min', 50).catch((e) => {
      this.consecutiveApiErrors++;
      log.warn(`[scan] BTC bars fetch failed (${this.consecutiveApiErrors}/${this.MAX_API_ERRORS}): ${(e as Error).message}`);
      return [] as typeof btcBars;
    });
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

    // ── Scan each symbol ───────────────────────────────────────────────────────────
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

    // ── F&G gate for this side ─────────────────────────────────────────────────
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

    // ── Combine risk multipliers ─────────────────────────────────────────────────
    const fgMult     = fgResult?.riskMultiplier ?? 1.0;
    const trendMult  = trendResult?.riskMultiplier ?? 1.0;
    const finalMult  = combineMultipliers(breakerMult, fgMult, trendMult);

    // ── Update signal with 1H trend context ────────────────────────────────────────
    if (trendResult) {
      this.lastSignals.set(symbol, {
        ...signal,
        trend1h: trendResult.trend1h,
        fearGreed: fgResult?.fearGreed?.value,
      });
    }

    // ── SL cooldown guard ─────────────────────────────────────────────────────
    const slCooldownUntil = this.slCooldowns.get(symbol) ?? 0;
    if (Date.now() < slCooldownUntil) {
      const minsLeft = Math.ceil((slCooldownUntil - Date.now()) / 60_000);
      log.debug(`[scan] ${symbol} in SL cooldown — ${minsLeft}m left, skip re-entry`);
      return;
    }

    // ── Signal dedup guard — prevent revenge trading ──────────────────────────
    // If we opened the same side on this symbol within SIGNAL_DEDUP_MS, skip.
    // This stops the bot re-entering MATIC SHORT immediately after an SL closed it.
    const lastOpen = this.lastOpenedAt.get(symbol);
    if (lastOpen && lastOpen.side === signal.side && Date.now() - lastOpen.ts < this.SIGNAL_DEDUP_MS) {
      const minsLeft = Math.ceil((this.SIGNAL_DEDUP_MS - (Date.now() - lastOpen.ts)) / 60_000);
      log.debug(`[scan] ${symbol} ${signal.side} dedup — same signal opened ${minsLeft}m ago, cooling down`);
      return;
    }

    // ── Open position via PaperTrader ─────────────────────────────────────────
    const pos = await this.trader.openFromSignal(signal, finalMult);
    if (pos) {
      // Record the open for dedup tracking
      this.lastOpenedAt.set(symbol, { side: signal.side, ts: Date.now() });
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

      // SL cooldown: block same symbol for SL_COOLDOWN_MS after a stop-loss
      if (trade.reason === 'SL' || trade.reason === 'TRAILING') {
        this.slCooldowns.set(trade.symbol, Date.now() + this.SL_COOLDOWN_MS);
        log.info(`[bot] 🕐 ${trade.symbol} SL cooldown ${this.SL_COOLDOWN_MS / 60_000}m — no re-entry until ${new Date(Date.now() + this.SL_COOLDOWN_MS).toISOString()}`);
      }

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
