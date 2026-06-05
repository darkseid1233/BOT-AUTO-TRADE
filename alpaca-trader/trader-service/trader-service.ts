import { getBot, type TradingBot } from './bot.js';
import { getRecentLogs, getLogsSince, type LogEntry } from './logger.js';
import { getRiskConfig } from './risk.js';
import type {
  Signal, OpenPosition, ClosedTrade, BotStats, EquityPoint, BotHealth, AlpacaAccount,
  RiskSettings, ConnectionStatus,
} from './types.js';

/**
 * TraderService — the application service facade over the trading bot.
 * The Express layer (app-root) calls these methods to serve the REST API.
 */
export class TraderService {
  private constructor(private bot: TradingBot) {}

  /** Start the underlying bot loops. */
  async start(): Promise<void> {
    await this.bot.start();
  }

  /**
   * Connect to Alpaca with API keys and sync the balance baseline.
   * @param keyId Alpaca API key id
   * @param secret Alpaca API secret key
   * @param paper whether to use the paper endpoint (default true)
   * @returns connection result
   */
  async connect(keyId: string, secret: string, paper = true): Promise<ConnectionStatus> {
    const res = await this.bot.connectAlpaca(keyId, secret, paper);
    return { connected: res.ok, paper, message: res.message };
  }

  /** Disconnect from Alpaca and return to demo mode. @returns the new status */
  disconnect(): ConnectionStatus {
    this.bot.disconnectAlpaca();
    return { connected: false, paper: true, message: 'disconnected — demo mode' };
  }

  /**
   * Manually resume the circuit breaker after a weekly halt.
   * @returns status message
   */
  async resumeBreaker(): Promise<{ message: string }> {
    const message = await this.bot.resumeBreaker();
    return { message };
  }

  /** @returns circuit-breaker status snapshot. */
  getBreakerStatus() {
    return this.bot.getBreakerStatus();
  }

  /** @returns the current risk-management settings. */
  getRisk(): RiskSettings {
    return getRiskConfig().get();
  }

  /**
   * Update risk-management settings (values are clamped to safe ranges).
   * @param patch partial settings to apply
   * @returns the updated settings
   */
  updateRisk(patch: Partial<RiskSettings>): RiskSettings {
    return getRiskConfig().update(patch);
  }

  /** @returns aggregate KPI statistics. */
  getStats(): BotStats {
    return this.bot.trader.getStats();
  }

  /** @returns currently open positions. */
  getPositions(): OpenPosition[] {
    return this.bot.trader.getOpenPositions();
  }

  /**
   * @param limit max number of closed trades
   * @returns recent closed trades, newest first
   */
  getHistory(limit = 100): ClosedTrade[] {
    return this.bot.trader.getHistory(limit);
  }

  /** @returns the equity curve points. */
  getEquity(): EquityPoint[] {
    return this.bot.trader.getEquityCurve();
  }

  /** @returns the latest signal per watchlist symbol. */
  getSignals(): Signal[] {
    return this.bot.getLastSignals();
  }

  /** @returns the bot's watchlist symbols. */
  getWatchlist(): string[] {
    return this.bot.watchlist;
  }

  /** @returns the Alpaca paper account snapshot. */
  async getAccount(): Promise<AlpacaAccount> {
    return this.bot.client.getAccount();
  }

  /** @returns runtime health. */
  getHealth(): BotHealth {
    return this.bot.getHealth();
  }

  /**
   * @param since unix-ms cursor; 0 returns the most recent buffer
   * @param limit max entries
   * @returns log entries plus the next cursor
   */
  getLogs(since: number, limit: number): { entries: LogEntry[]; ts: number } {
    const entries = since > 0 ? getLogsSince(since) : getRecentLogs(limit);
    const ts = entries.reduce((max, e) => Math.max(max, e.ts), since);
    return { entries, ts };
  }

  /** Pause opening new trades. @returns the new paused state. */
  pause(): { paused: boolean } {
    this.bot.trader.pause();
    return { paused: true };
  }

  /** Resume opening new trades. @returns the new paused state. */
  resume(): { paused: boolean } {
    this.bot.trader.resume();
    return { paused: false };
  }

  /**
   * Panic — close all open positions immediately.
   * @returns how many positions were closed
   */
  async panic(): Promise<{ closed: number }> {
    const closed = await this.bot.trader.closeAll();
    this.bot.trader.pause();
    return { closed: closed.length };
  }

  /**
   * Manually close one symbol's position.
   * @param symbol symbol to close
   * @returns whether a position was closed
   */
  async closeSymbol(symbol: string): Promise<{ closed: boolean }> {
    const t = await this.bot.trader.closePosition(symbol);
    return { closed: Boolean(t) };
  }

  /**
   * Create a new instance of the trader service, wiring in the singleton bot.
   * @returns a ready TraderService
   */
  static from(): TraderService {
    return new TraderService(getBot());
  }
}
