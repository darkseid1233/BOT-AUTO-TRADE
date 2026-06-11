import { getBot, type TradingBot } from './bot.js';
import { getRecentLogs, getLogsSince, type LogEntry } from './logger.js';
import { getRiskConfig } from './risk.js';
import { getJournal, computeJournalReport, type JournalEntry, type JournalReport } from './trade-journal.js';
import { backtest, walkForward, type BacktestResult } from './backtest.js';
import { getScanStats } from './scan-stats.js';
import { getLatestNews, getHighImpact, type NewsItem } from './news-engine.js';
import { computePerformance, type PerformanceReport } from './performance-metrics.js';
import { compareBacktest, type CompareResult } from './backtest-compare.js';
import type { Bar } from './market-regime.js';
import type {
  Signal, OpenPosition, ClosedTrade, BotStats, EquityPoint, BotHealth, AlpacaAccount,
  RiskSettings, ConnectionStatus,
} from './types.js';

export class TraderService {
  private constructor(private bot: TradingBot) {}

  async start(): Promise<void> { await this.bot.start(); }

  async connect(keyId: string, secret: string, paper = true): Promise<ConnectionStatus> {
    const res = await this.bot.connectAlpaca(keyId, secret, paper);
    return { connected: res.ok, paper, message: res.message };
  }

  disconnect(): ConnectionStatus {
    this.bot.disconnectAlpaca();
    return { connected: false, paper: true, message: 'disconnected — demo mode' };
  }

  async resumeBreaker(): Promise<{ message: string }> {
    const message = await this.bot.resumeBreaker();
    return { message };
  }

  getBreakerStatus() { return this.bot.getBreakerStatus(); }
  getRisk(): RiskSettings { return getRiskConfig().get(); }
  updateRisk(patch: Partial<RiskSettings>): RiskSettings { return getRiskConfig().update(patch); }
  getStats(): BotStats { return this.bot.trader.getStats(); }
  getPositions(): OpenPosition[] { return this.bot.trader.getOpenPositions(); }
  getHistory(limit = 100): ClosedTrade[] { return this.bot.trader.getHistory(limit); }
  getEquity(): EquityPoint[] { return this.bot.trader.getEquityCurve(); }
  getSignals(): Signal[] { return this.bot.getLastSignals(); }
  getJournal(limit = 100): JournalEntry[] { return getJournal(limit); }
  getJournalReport(): JournalReport { return computeJournalReport(); }

  async runBacktest(symbol: string, walk = false): Promise<BacktestResult | ReturnType<typeof walkForward>> {
    const [k15, k1h] = await Promise.all([
      this.bot.client.getCryptoBars(symbol, '15Min', 1000) as Promise<Bar[]>,
      this.bot.client.getCryptoBars(symbol, '1Hour', 500) as Promise<Bar[]>,
    ]);
    return walk ? walkForward(symbol, k15, k1h) : backtest(symbol, k15, k1h);
  }

  async runCompare(symbol: string, walk = true): Promise<CompareResult> {
    const [k15, k1h] = await Promise.all([
      this.bot.client.getCryptoBars(symbol, '15Min', 1000) as Promise<Bar[]>,
      this.bot.client.getCryptoBars(symbol, '1Hour', 500) as Promise<Bar[]>,
    ]);
    return compareBacktest(symbol, k15, k1h, walk);
  }

  /** Per-gate rejection histogram (cumulative + last scan) for the dashboard. */
  getScanStats() { return getScanStats(); }
  getPerSymbolStats() { return this.bot.trader.getPerSymbolStats(); }

  /**
   * Institutional-grade performance metrics: Sharpe, Sortino, Calmar,
   * Profit Factor, Kelly, Expectancy, max drawdown, avg hold time, streaks.
   * Returns null when fewer than 5 full trades exist (not yet meaningful).
   */
  getPerformanceMetrics(): PerformanceReport | null {
    const history = this.bot.trader.getHistory(5000);
    const stats = this.bot.trader.getStats();
    return computePerformance(history, stats.startingBalance);
  }

  /** Latest crypto news items (keyword-sentiment scored). */
  getNews(limit = 20): NewsItem[] { return getLatestNews(limit); }

  /** High-impact news only. */
  getHighImpactNews(): NewsItem[] { return getHighImpact(); }

  getWatchlist(): string[] { return this.bot.watchlist; }
  async getAccount(): Promise<AlpacaAccount> { return this.bot.client.getAccount(); }
  getHealth(): BotHealth { return this.bot.getHealth(); }

  getLogs(since: number, limit: number): { entries: LogEntry[]; ts: number } {
    const entries = since > 0 ? getLogsSince(since) : getRecentLogs(limit);
    const ts = entries.reduce((max, e) => Math.max(max, e.ts), since);
    return { entries, ts };
  }

  pause(): { paused: boolean } { this.bot.trader.pause(); return { paused: true }; }
  resume(): { paused: boolean } { this.bot.trader.resume(); return { paused: false }; }

  async panic(): Promise<{ closed: number }> {
    const closed = await this.bot.trader.closeAll();
    this.bot.trader.pause();
    return { closed: closed.length };
  }

  async closeSymbol(symbol: string): Promise<{ closed: boolean }> {
    const t = await this.bot.trader.closePosition(symbol);
    return { closed: Boolean(t) };
  }

  static from(): TraderService { return new TraderService(getBot()); }
}
