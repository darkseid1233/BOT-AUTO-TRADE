/**
 * Bot Orchestrator v2 — integrates all protection layers from bcj2023.
 *
 * KEY CHANGES in this version:
 *  - Scan heartbeat: logs START + DONE every cycle (was silent when all neutral)
 *  - Per-symbol rejection reason logged at INFO (was debug/silent)
 *  - F&G blocking logs at INFO level (was debug)
 *  - consecutiveApiErrors reset moved to END of successful scan (not start)
 *  - processSymbol returns 'opened' | 'neutral' for scan summary counts
 *  - SL cooldown + signal dedup logged at INFO not DEBUG
 */
import { log } from './logger.js';
import { AlpacaClient } from './alpaca-client.js';
// SignalEngine class removed — bot.ts uses generateSignal() directly.
import { generateSignal, generateSignals } from './signal-engine.js';
import { analyzeBtcState } from './btc-state.js';
import { PaperTrader } from './paper-trader.js';
import { checkSession } from './session-filter.js';
import {
  initBreaker, checkBreaker, recordTradeOutcome, getBreakerStatus, manualResume,
  registerNotify as registerBreakerNotify,
} from './circuit-breaker.js';
import { getMarketSentiment } from './fear-greed.js';
import { recordGate, beginScan, endScan, gateFromReason } from './scan-stats.js';
import { getVolatilityRegime } from './volatility-regime.js';
import { getDailyTrend, setDailyTrendClient } from './daily-trend.js';
import { startNewsLoop } from './news-engine.js';
import { notifyDiscordOpen, notifyDiscordClose, notifyDiscordAlert } from './discord-notifier.js';
import { telegramNotifyOpen, telegramNotifyClose, telegramAlert, telegramStatus } from './telegram-notifier.js';
import type { Signal, BotHealth } from './types.js';

/** Default crypto watchlist (Alpaca symbols). Override with WATCHLIST env. */
// NOTE: MATIC/USD was delisted on Alpaca (migrated to POL). Using POL/USD avoids
// the silent fallback to synthetic data that previously made MATIC the only
// "active" symbol — on 100% fake bars. UNI/USD added as a liquid replacement.
const DEFAULT_WATCHLIST = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'LTC/USD',
  'AVAX/USD', 'LINK/USD', 'DOGE/USD', 'UNI/USD',
];

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_SEC  ?? 30) * 1000;
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_SEC  ?? 10) * 1000;

function parseWatchlist(): string[] {
  const raw = process.env.WATCHLIST;
  if (!raw) return DEFAULT_WATCHLIST;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function combineMultipliers(...vals: number[]): number {
  return vals.reduce((acc, v) => acc * v, 1);
}

export class TradingBot {
  readonly client    = new AlpacaClient();
  // engine removed — generateSignal() is called directly (see processSymbol).
  readonly trader    = new PaperTrader(this.client);
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
  private reconnectKeyId = '';
  private reconnectSecret = '';
  private reconnectPaper = true;
  // consecutiveApiErrors must NOT be reset at scan start — needs to accumulate
  private consecutiveApiErrors = 0;
  private readonly MAX_API_ERRORS = 5;
  private readonly RECONNECT_INTERVAL_MS = Number(process.env.RECONNECT_INTERVAL_SEC ?? 60) * 1000;
  // SL cooldown: after any SL hit, block re-entry on that symbol for N minutes
  private slCooldowns = new Map<string, number>();
  private readonly SL_COOLDOWN_MS = Number(process.env.SL_COOLDOWN_MINUTES ?? 30) * 60_000;
  // Signal dedup: block same side on same symbol within N minutes (prevents revenge trading)
  private lastOpenedAt = new Map<string, { side: string; ts: number }>();
  private readonly SIGNAL_DEDUP_MS = Number(process.env.SIGNAL_DEDUP_MINUTES ?? 15) * 60_000;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    setDailyTrendClient(this.client);
    registerBreakerNotify(async (msg) => {
      await Promise.allSettled([notifyDiscordAlert(msg), telegramAlert(msg)]);
    });
    const acct = await this.client.getAccount();
    this.alpacaConnected = acct.connected;
    const startingBalance = acct.connected ? (acct.equity || acct.portfolioValue || acct.cash) : this.trader.getBalance();
    // Sync the paper trader's balance to the REAL account when connected via env
    // credentials. Without this the trader kept the 100000 demo balance while the
    // breaker used the real one — a mismatch that distorted sizing and drawdown.
    if (acct.connected && startingBalance > 0) this.trader.setBalance(startingBalance);
    initBreaker(startingBalance);
    log.info(
      `[bot] v2 starting — Alpaca ${acct.connected ? 'CONNECTED' : 'DEMO'} | ` +
      `balance $${startingBalance.toFixed(2)} | watchlist ${this.watchlist.length} | ` +
      `scan ${SCAN_INTERVAL_MS / 1000}s | SL_COOLDOWN=${this.SL_COOLDOWN_MS / 60_000}m | DEDUP=${this.SIGNAL_DEDUP_MS / 60_000}m`,
    );
    if (acct.connected) {
      await telegramStatus(`🤖 AlpacaBot v2 started — balance $${startingBalance.toFixed(2)} | watching ${this.watchlist.join(', ')}`);
    }
    this.newsTimer = startNewsLoop();
    this.reconnectTimer = setInterval(() => {
      this.watchdogReconnect().catch((e) => log.warn(`[reconnect] ${(e as Error).message}`));
    }, this.RECONNECT_INTERVAL_MS);
    this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));
    this.scanTimer = setInterval(() => {
      this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));
    }, SCAN_INTERVAL_MS);
    this.tickTimer = setInterval(() => {
      this.tick().catch((e) => log.error(`[tick] ${(e as Error).message}`));
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.scanTimer)     clearInterval(this.scanTimer);
    if (this.tickTimer)     clearInterval(this.tickTimer);
    if (this.newsTimer)     clearInterval(this.newsTimer);
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.started = false;
  }

  async connectAlpaca(keyId: string, secret: string, paper = true): Promise<{ ok: boolean; message: string }> {
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
    // FIX: for crypto accounts `cash` can be near-zero while equity holds the real
    // value. Prefer equity → portfolioValue → cash so the baseline is correct.
    const baseline = acct.equity || acct.portfolioValue || acct.cash;
    if (baseline > 0) { this.trader.setBalance(baseline); initBreaker(baseline); }
    this.reconnectKeyId = keyId;
    this.reconnectSecret = secret;
    this.reconnectPaper = paper;
    this.consecutiveApiErrors = 0;
    log.info(`[bot] ✅ Alpaca connected — balance ${baseline.toLocaleString()}`);
    await telegramStatus(`✅ Alpaca connected — balance ${baseline.toFixed(2)}`);
    return { ok: true, message: test.message };
  }

  disconnectAlpaca(): void {
    this.client.clearCredentials();
    this.alpacaConnected = false;
    this.reconnectKeyId = '';
    this.reconnectSecret = '';
    this.consecutiveApiErrors = 0;
  }

  private async watchdogReconnect(): Promise<void> {
    if (!this.reconnectKeyId || !this.reconnectSecret) return;
    if (this.consecutiveApiErrors < this.MAX_API_ERRORS) return;
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
    } catch (e) { log.warn(`[reconnect] error: ${(e as Error).message}`); }
  }

  async resumeBreaker(): Promise<string> {
    const result = manualResume(this.trader.getBalance());
    await telegramStatus(`🔓 Breaker resumed: ${result}`);
    return result;
  }

  getBreakerStatus() { return getBreakerStatus(); }

  // ── Main scan loop ──────────────────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    this.lastScanAt = Date.now();
    this.scanCount++;

    beginScan();
    // ── Heartbeat — always visible in dashboard console ─────────────────────────────
    log.info(`[scan] #${this.scanCount} START — ${this.watchlist.length} symbols | equity ${this.trader.getBalance().toFixed(0)} | open=${this.trader.getOpenPositions().length}`);

    // ── Gate 1: Session Filter ───────────────────────────────────────────────
    const session = checkSession();
    if (!session.allowed) {
      log.info(`[scan] #${this.scanCount} SKIP — ${session.reason}`);
      return;
    }

    // ── Gate 2: Circuit Breaker ──────────────────────────────────────────────
    const equity = this.trader.getBalance();
    const breaker = checkBreaker(equity);
    if (!breaker.allowed) {
      log.warn(`[scan] #${this.scanCount} HALTED — ${breaker.reason}`);
      return;
    }
    if (breaker.riskMultiplier < 1.0) {
      log.info(`[scan] risk mult = ${breaker.riskMultiplier.toFixed(2)} (${breaker.reason})`);
    }

    // ── Gate 3: Volatility Regime (BTC proxy) ─────────────────────────────────
    const btcBars = await this.client.getCryptoBars('BTC/USD', '15Min', 50).catch((e) => {
      this.consecutiveApiErrors++;
      log.warn(`[scan] BTC bars fetch failed (${this.consecutiveApiErrors}/${this.MAX_API_ERRORS}): ${(e as Error).message}`);
      return [] as typeof btcBars;
    });
    if (btcBars.length > 16) {
      const volRegime = getVolatilityRegime(
        btcBars.map((b) => b.high),
        btcBars.map((b) => b.low),
        btcBars.map((b) => b.close),
      );
      if (!volRegime.allowed) {
        log.warn(`[scan] ${volRegime.reason} — all trades blocked`);
        return;
      }
    }

    // ── Gate 4: Fear & Greed ─────────────────────────────────────────────────
    const fgResult = await getMarketSentiment().catch(() => null);
    if (fgResult && (fgResult.blockLong || fgResult.blockShort)) {
      log.info(`[scan] F&G=${fgResult.fearGreed?.value ?? '?'} — ${fgResult.reason}`);
    }

    // ── Fetch BTC state ONCE and share across all symbols (avoids N redundant calls) ─
    const btcState = await analyzeBtcState(this.client).catch(() => undefined);

    // ── Scan each symbol ─────────────────────────────────────────────────────
    let opened = 0;
    let neutralCount = 0;
    for (const symbol of this.watchlist) {
      try {
        const result = await this.processSymbol(symbol, breaker.riskMultiplier, fgResult, btcState);
        if (result === 'opened') opened++; else neutralCount++;
      } catch (e) {
        log.error(`[scan] ${symbol}: ${(e as Error).message}`);
        neutralCount++;
      }
    }

    // Reset ONLY after full successful scan
    this.consecutiveApiErrors = 0;
    endScan();
    log.info(`[scan] #${this.scanCount} DONE — ${opened > 0 ? `✅ ${opened} opened` : 'no trades'} | ${neutralCount} neutral`);
  }

  private async processSymbol(
    symbol: string,
    breakerMult: number,
    fgResult: Awaited<ReturnType<typeof getMarketSentiment>> | null,
    btcState?: Awaited<ReturnType<typeof analyzeBtcState>>,
  ): Promise<'opened' | 'neutral'> {
    const signal = await generateSignal(symbol, this.client, btcState);
    this.lastSignals.set(symbol, signal);

    // ── Data-quality gate (Freqtrade-inspired) ────────────────────────────────
    // NEVER open a live trade on synthetic/fallback data. If the market-data
    // fetch fell back to generated prices, the signal is meaningless for real
    // money. Allow it through only when ALLOW_SYNTHETIC_TRADING=true (demo/testing).
    if (this.client.isDataSynthetic(symbol) && process.env.ALLOW_SYNTHETIC_TRADING !== 'true') {
      recordGate('dataQuality');
      log.warn(`[scan] ${symbol} skip — SYNTHETIC data (real bars unavailable). Set ALLOW_SYNTHETIC_TRADING=true to trade demo data.`);
      this.lastSignals.set(symbol, { ...signal, side: 'NEUTRAL', blocked: ['synthetic data'] });
      return 'neutral';
    }

    if (signal.side === 'NEUTRAL') {
      recordGate(gateFromReason(signal.blocked?.[0]));
      log.info(`[scan] ${symbol} NEUTRAL — ${signal.blocked?.[0] ?? 'regime/quality filter'}`);
      return 'neutral';
    }

    if (fgResult) {
      if (fgResult.blockLong && signal.side === 'LONG') {
        recordGate('fearGreed');
        log.info(`[scan] ${symbol} LONG blocked — F&G=${fgResult.fearGreed?.value} Extreme Fear`);
        this.lastSignals.set(symbol, { ...signal, side: 'NEUTRAL', blocked: [fgResult.reason] });
        return 'neutral';
      }
      if (fgResult.blockShort && signal.side === 'SHORT') {
        recordGate('fearGreed');
        log.info(`[scan] ${symbol} SHORT blocked — F&G=${fgResult.fearGreed?.value} Extreme Greed`);
        this.lastSignals.set(symbol, { ...signal, side: 'NEUTRAL', blocked: [fgResult.reason] });
        return 'neutral';
      }
    }

    const trendResult = await getDailyTrend(symbol, signal.side).catch(() => null);
    const fgMult    = fgResult?.riskMultiplier ?? 1.0;
    const trendMult = trendResult?.riskMultiplier ?? 1.0;
    const finalMult = combineMultipliers(breakerMult, fgMult, trendMult);

    if (trendResult) {
      this.lastSignals.set(symbol, { ...signal, trend1h: trendResult.trend1h, fearGreed: fgResult?.fearGreed?.value });
    }

    log.info(`[scan] ${symbol} ${signal.side} quality=${signal.confidence}% HTF=${trendResult?.trend1h ?? '?'} mult=${finalMult.toFixed(2)}`);

    // ── SL cooldown guard ─────────────────────────────────────────────────────
    const slCooldownUntil = this.slCooldowns.get(symbol) ?? 0;
    if (Date.now() < slCooldownUntil) {
      recordGate('slCooldown');
      const minsLeft = Math.ceil((slCooldownUntil - Date.now()) / 60_000);
      log.info(`[scan] ${symbol} SL cooldown — ${minsLeft}m left, skip re-entry`);
      return 'neutral';
    }

    // ── Signal dedup guard — prevent revenge trading ──────────────────────────
    const lastOpen = this.lastOpenedAt.get(symbol);
    if (lastOpen && lastOpen.side === signal.side && Date.now() - lastOpen.ts < this.SIGNAL_DEDUP_MS) {
      recordGate('signalDedup');
      const minsLeft = Math.ceil((this.SIGNAL_DEDUP_MS - (Date.now() - lastOpen.ts)) / 60_000);
      log.info(`[scan] ${symbol} ${signal.side} dedup — same side opened ${minsLeft}m ago, cooling`);
      return 'neutral';
    }

    // ── Open position ───────────────────────────────────────────────────────────────
    const pos = await this.trader.openFromSignal(signal, finalMult);
    if (pos) {
      recordGate('opened');
      this.lastOpenedAt.set(symbol, { side: signal.side, ts: Date.now() });
      log.info(`[scan] ✅ ${symbol} ${signal.side} OPENED conf=${signal.confidence}% notional=$${pos.notional.toFixed(2)} SL=${pos.stopLoss.toFixed(4)} TP=${pos.takeProfit.toFixed(4)}`);
      await Promise.allSettled([
        notifyDiscordOpen({
          symbol, side: signal.side as 'LONG' | 'SHORT',
          entryPrice: pos.entryPrice, stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit, notional: pos.notional,
          confidenceScore: signal.confidence,
        }),
        telegramNotifyOpen({
          symbol, side: signal.side as 'LONG' | 'SHORT',
          entryPrice: pos.entryPrice, stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit, confidence: signal.confidence,
        }),
      ]);
      return 'opened';
    }
    recordGate('riskCap');
    log.warn(`[scan] ${symbol} ${signal.side} signal OK but openFromSignal rejected (paused or risk cap)`);
    return 'neutral';
  }

  private async tick(): Promise<void> {
    const closedTrades = await this.trader.tick((symbol) => this.priceFor(symbol));
    if (!closedTrades || closedTrades.length === 0) return;
    for (const trade of closedTrades) {
      const outcome: 'WIN' | 'LOSS' = trade.realizedPnl > 0 ? 'WIN' : 'LOSS';
      recordTradeOutcome(outcome, this.trader.getBalance());
      if (trade.reason === 'SL' || trade.reason === 'TRAILING') {
        this.slCooldowns.set(trade.symbol, Date.now() + this.SL_COOLDOWN_MS);
        log.info(`[bot] 🕐 ${trade.symbol} SL cooldown ${this.SL_COOLDOWN_MS / 60_000}m — blocked until ${new Date(Date.now() + this.SL_COOLDOWN_MS).toISOString()}`);
      }
      await Promise.allSettled([
        notifyDiscordClose({
          symbol: trade.symbol, side: trade.side as 'LONG' | 'SHORT',
          entryPrice: trade.entryPrice, closePrice: trade.closePrice,
          realizedPnl: trade.realizedPnl, pnlPercent: trade.pnlPercent,
          reason: trade.reason,
        }),
        telegramNotifyClose({
          symbol: trade.symbol, side: trade.side as 'LONG' | 'SHORT',
          entryPrice: trade.entryPrice, closePrice: trade.closePrice,
          realizedPnl: trade.realizedPnl, pnlPercent: trade.pnlPercent,
          reason: trade.reason,
        }),
      ]);
    }
  }

  private async priceFor(symbol: string): Promise<number> {
    const bars = await this.client.getCryptoBars(symbol, '15Min', 2);
    return bars[bars.length - 1]?.close ?? 0;
  }

  getLastSignals(): Signal[] { return Array.from(this.lastSignals.values()); }
  getBalance(): number { return this.trader.getBalance(); }
  isAlpacaConnected(): boolean { return this.alpacaConnected; }

  getHealth(): BotHealth {
    const warnings: string[] = [];
    const lastScanAgoMs = this.lastScanAt ? Date.now() - this.lastScanAt : -1;
    if (lastScanAgoMs > SCAN_INTERVAL_MS * 3) warnings.push('scan loop stalled');
    const breaker = getBreakerStatus();
    if (breaker.dailyHalted)   warnings.push('daily circuit breaker ACTIVE');
    if (breaker.weeklyHalted)  warnings.push('weekly circuit breaker ACTIVE');
    if (breaker.activeCooldown) warnings.push(`streak cooldown (${breaker.cooldownMinutesLeft}m left)`);
    return {
      ok: warnings.length === 0,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      scanCount: this.scanCount, lastScanAgoMs,
      scanIntervalSec: SCAN_INTERVAL_MS / 1000,
      watchlistSize: this.watchlist.length,
      alpacaConnected: this.alpacaConnected, warnings,
    };
  }
}

let instance: TradingBot | null = null;

export function getBot(): TradingBot {
  if (!instance) instance = new TradingBot();
  return instance;
}
