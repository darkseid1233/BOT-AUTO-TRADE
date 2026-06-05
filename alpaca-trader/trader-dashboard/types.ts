/**
 * Dashboard-side types mirroring the trader-service REST API shapes.
 */

export type Side = 'LONG' | 'SHORT' | 'NEUTRAL';

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

export type Signal = {
  symbol: string;
  side: Side;
  confidence: number;
  price: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasons: string[];
  blocked: string[];
  indicators: {
    rsi: number;
    ema20: number;
    ema50: number;
    sma: number;
    atr: number;
    momentum: number;
  };
  timestamp: number;
};

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

export type EquityPoint = {
  ts: number;
  balance: number;
};

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

export type LogEntry = {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  msg: string;
};

/** Risk-management settings, mirrored from the service. */
export type RiskSettings = {
  riskPerTradePct: number;
  maxOpenTrades: number;
  maxNotionalPct: number;
  maxTotalExposurePct: number;
  dailyMaxLossPct: number;
  maxDrawdownStopPct: number;
  minConfidence: number;
};

/** Alpaca connection result. */
export type ConnectionStatus = {
  connected: boolean;
  paper: boolean;
  message: string;
};
