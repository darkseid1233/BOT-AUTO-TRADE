export { TraderService } from './trader-service.js';
export { getBot, TradingBot } from './bot.js';
export { getRiskConfig, RiskConfig } from './risk.js';
export { getStrategyConfig, getTuning, COIN_TUNING } from './strategy-config.js';
export { detectRegime } from './market-regime.js';
export { analyzeBtcState } from './btc-state.js';
export { confirmHtf } from './htf-confirm.js';
export { computeSignalQuality } from './signal-quality.js';
export { backtest, walkForward } from './backtest.js';
export { getJournal, computeJournalReport, recordTrade, resetJournal } from './trade-journal.js';
export { recordGate, beginScan, endScan, getScanStats, gateFromReason } from './scan-stats.js';
export { getLatestNews, getHighImpact, startNewsLoop } from './news-engine.js';
export type { GateName, GateStats } from './scan-stats.js';
export type { NewsItem } from './news-engine.js';
export type { StrategyConfig, ScoreWeights, CoinTuning } from './strategy-config.js';
export type { MarketRegime, RegimeResult, Bar } from './market-regime.js';
export type { BtcState } from './btc-state.js';
export type { HtfResult } from './htf-confirm.js';
export type { QualityBreakdown, QualityInputs } from './signal-quality.js';
export type { BacktestResult, BacktestTrade } from './backtest.js';
export type { JournalEntry, JournalReport } from './trade-journal.js';
export type {
  Signal,
  OpenPosition,
  ClosedTrade,
  BotStats,
  EquityPoint,
  BotHealth,
  AlpacaAccount,
  RiskSettings,
  ConnectionStatus,
  Side,
  WatchSymbol,
} from './types.js';
export type { LogEntry, LogLevel } from './logger.js';
