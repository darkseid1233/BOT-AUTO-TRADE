/**
 * Shared domain types for the Alpaca trading bot service.
 * These shapes are returned by the REST API and consumed by the dashboard.
 */

/** A tradable symbol the bot watches (crypto or US equity). */
export type WatchSymbol = string;

/** Trade direction. */
export type Side = 'LONG' | 'SHORT' | 'NEUTRAL';

/** A generated trading signal for one symbol. */
export type Signal = {
  symbol: string;
  side: Side;
  /** Composite confidence score 0-100. */
  confidence: number;
  price: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  /** Human-readable reasons the signal fired. */
  reasons: string[];
  /** Reasons the signal was blocked (when NEUTRAL). */
  blocked: string[];
  /** Market regime at signal time: TRENDING_BULL | TRENDING_BEAR | RANGING | HIGH_VOL */
  marketRegime?: string;
  /** Choppiness Index value 0-100 */
  chopValue?: number;
  /** Smart Money Concepts verdict */
  smcBull?: number;
  smcBear?: number;
  /** 1H trend direction */
  trend1h?: string;
  /** Fear & Greed index value */
  fearGreed?: number;
  indicators: {
    rsi: number;
    ema20: number;
    ema50: number;
    ema200: number;
    sma: number;
    atr: number;
    momentum: number;
    adx: number;
    macdHistogram: number;
    stochRsi: number;
    bollingerPct: number;
    volRatio: number;
  };
  timestamp: number;
};

/** An open paper position tracked by the bot. */
export type OpenPosition = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  qty: number;
  notional: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  pnlPercent: number;
  openedAt: number;
  confidence: number;
};

/** A closed trade in history. */
export type ClosedTrade = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  closePrice: number;
  qty: number;
  realizedPnl: number;
  pnlPercent: number;
  reason: 'TP' | 'SL' | 'MANUAL' | 'PANIC';
  openedAt: number;
  closedAt: number;
};

/** Aggregate bot statistics for the dashboard KPIs. */
export type BotStats = {
  balance: number;
  startingBalance: number;
  equity: number;
  totalPnl: number;
  totalPnlPct: number;
  dailyPnl: number;
  dailyPnlPct: number;
  winRate: number;
  profitFactor: number | null;
  sharpeRatio: number;
  maxDrawdownPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  openPositions: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  availableUSDT: number;
  paused: boolean;
};

/** Alpaca account snapshot (paper trading). */
export type AlpacaAccount = {
  connected: boolean;
  accountNumber: string;
  status: string;
  currency: string;
  cash: number;
  portfolioValue: number;
  buyingPower: number;
  equity: number;
  paperTrading: boolean;
};

/** A point on the equity curve. */
export type EquityPoint = {
  ts: number;
  balance: number;
};

/** Bot runtime health for the status bar. */
export type BotHealth = {
  ok: boolean;
  uptimeSec: number;
  scanCount: number;
  lastScanAgoMs: number;
  scanIntervalSec: number;
  watchlistSize: number;
  alpacaConnected: boolean;
  warnings: string[];
};

/** Risk-management settings exposed to and editable from the dashboard. */
export type RiskSettings = {
  riskPerTradePct: number;
  maxOpenTrades: number;
  maxNotionalPct: number;
  maxTotalExposurePct: number;
  dailyMaxLossPct: number;
  maxDrawdownStopPct: number;
  minConfidence: number;
};

/** Alpaca connection status reported to the dashboard. */
export type ConnectionStatus = {
  connected: boolean;
  paper: boolean;
  message: string;
};
