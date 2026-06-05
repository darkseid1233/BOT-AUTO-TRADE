import { log } from './logger.js';
import { AlpacaClient } from './alpaca-client.js';
import { SignalEngine } from './signal-engine.js';
import { PaperTrader } from './paper-trader.js';
import type { Signal, BotHealth } from './types.js';

/** Default crypto watchlist (Alpaca symbols). Override with WATCHLIST env. */
const DEFAULT_WATCHLIST = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'LTC/USD',
  'AVAX/USD', 'LINK/USD', 'DOGE/USD', 'MATIC/USD',
];

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_SEC ?? 30) * 1000;
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_SEC ?? 10) * 1000;

function parseWatchlist(): string[] {
  const raw = process.env.WATCHLIST;
  if (!raw) return DEFAULT_WATCHLIST;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * Bot orchestrator — owns the scan + tick loops, the signal engine, and the
 * paper trader. A singleton accessed via {@link getBot}.
 */
export class TradingBot {
  readonly client = new AlpacaClient();
  readonly engine = new SignalEngine(this.client);
  readonly trader = new PaperTrader(this.client);
  readonly watchlist = parseWatchlist();

  private lastSignals = new Map<string, Signal>();
  private scanTimer?: ReturnType<typeof setInterval>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private startedAt = Date.now();
  private scanCount = 0;
  private lastScanAt = 0;
  private alpacaConnected = false;
  private started = false;

  /** Start the scan + tick loops. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const acct = await this.client.getAccount();
    this.alpacaConnected = acct.connected;
    log.info(
      `[bot] starting — Alpaca ${acct.connected ? 'CONNECTED' : 'DEMO (no creds)'} | ` +
      `watchlist ${this.watchlist.length} | scan ${SCAN_INTERVAL_MS / 1000}s tick ${TICK_INTERVAL_MS / 1000}s`,
    );

    this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));
    this.scanTimer = setInterval(() => {
      this.scan().catch((e) => log.error(`[scan] ${(e as Error).message}`));
    }, SCAN_INTERVAL_MS);
    this.tickTimer = setInterval(() => {
      this.tick().catch((e) => log.error(`[tick] ${(e as Error).message}`));
    }, TICK_INTERVAL_MS);
  }

  /** Stop the loops. */
  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.started = false;
  }

  /**
   * Connect to the Alpaca account with the given API keys. On success the bot
   * syncs its balance baseline to the real account cash (so all sizing is based
   * on YOUR balance) and switches out of demo mode.
   * @param keyId Alpaca API key id
   * @param secret Alpaca API secret key
   * @param paper whether to use the paper-trading endpoint (default true)
   * @returns connection result with the account snapshot when successful
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
    // Sync sizing baseline to the real account balance (cash).
    const baseline = acct.cash || acct.portfolioValue;
    if (baseline > 0) this.trader.setBalance(baseline);
    log.info(`[bot] ✅ Alpaca connected — balance baseline ${baseline.toLocaleString()}`);
    return { ok: true, message: test.message };
  }

  /**
   * Disconnect from Alpaca and return to demo mode.
   */
  disconnectAlpaca(): void {
    this.client.clearCredentials();
    this.alpacaConnected = false;
  }

  private async scan(): Promise<void> {
    this.lastScanAt = Date.now();
    this.scanCount++;
    for (const symbol of this.watchlist) {
      try {
        const signal = await this.engine.analyze(symbol);
        this.lastSignals.set(symbol, signal);
        if (signal.side !== 'NEUTRAL') {
          const pos = await this.trader.openFromSignal(signal);
          if (pos) {
            log.info(`[scan] ✅ ${symbol} ${signal.side} opened (conf ${signal.confidence})`);
          }
        }
      } catch (e) {
        log.error(`[scan] ${symbol}: ${(e as Error).message}`);
      }
    }
  }

  private async tick(): Promise<void> {
    await this.trader.tick((symbol) => this.priceFor(symbol));
  }

  /**
   * Latest mark price for a symbol from the most recent bar.
   * @param symbol the symbol to price
   * @returns current price
   */
  private async priceFor(symbol: string): Promise<number> {
    const bars = await this.client.getCryptoBars(symbol, '15Min', 2);
    return bars[bars.length - 1]?.close ?? 0;
  }

  /** @returns all latest signals (one per watchlist symbol). */
  getLastSignals(): Signal[] {
    return Array.from(this.lastSignals.values());
  }

  /** @returns whether the connected account is the live Alpaca paper account. */
  isAlpacaConnected(): boolean {
    return this.alpacaConnected;
  }

  /** @returns runtime health snapshot for the dashboard. */
  getHealth(): BotHealth {
    const warnings: string[] = [];
    const lastScanAgoMs = this.lastScanAt ? Date.now() - this.lastScanAt : -1;
    if (lastScanAgoMs > SCAN_INTERVAL_MS * 3) warnings.push('scan loop stalled');
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
