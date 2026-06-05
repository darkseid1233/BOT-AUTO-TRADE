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
  qtyRemaining: number;
  notional: number;
  stopLoss: number;
  initialStopLoss: number;
  takeProfit: number;
  trailingActive: boolean;
  trailingStop: number;
  l1Hit: boolean;
  l2Hit: boolean;
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
  reason: 'TP' | 'SL' | 'TRAILING' | 'TP_PARTIAL_L1' | 'TP_PARTIAL_L2' | 'MANUAL' | 'PANIC';
  openedAt: number;
  closedAt: number;
};

export type Signal = {
  symbol: string;
  side: Side;
  confidence: number;
  qualityScore?: number;
  qualityFactors?: Record<string, number>;
  btcState?: string;
  price: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasons: string[];
  blocked: string[];
  marketRegime?: string;
  trend1h?: string;
  chopIndex?: number;
  adx?: number;
  atr?: number;
  indicators?: {
    ema20: number; ema50: number; ema200: number;
    rsi: number; sma: number; atr: number; momentum: number;
    adx?: number; macdHistogram?: number; stochRsi?: number;
    bollingerPct?: number; volRatio?: number;
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

export type EquityPoint = { ts: number; balance: number; };

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

export type LogEntry = { ts: number; level: 'info' | 'warn' | 'error' | 'debug'; msg: string; };

export type RiskSettings = {
  riskPerTradePct: number;
  maxOpenTrades: number;
  maxNotionalPct: number;
  maxTotalExposurePct: number;
  minConfidence: number;
  dailyMaxLossPct: number;
  maxDrawdownStopPct: number;
};

export type ConnectionStatus = { connected: boolean; paper: boolean; message: string; };

export type JournalEntry = {
  id: string; symbol: string; side: 'LONG' | 'SHORT';
  entryPrice: number; closePrice: number; qty: number;
  realizedPnl: number; pnlPercent: number; reason: string;
  openedAt: number; closedAt: number; holdMinutes: number; won: boolean;
  qualityScore: number; marketRegime: string;
  btcState?: string; trend1h?: string;
  entryReasons: string[];
  qualityFactors?: Record<string, number>;
};

export type JournalReport = {
  totalTrades: number;
  byRegime: Record<string, { trades: number; wins: number; winRate: number; avgPnlPct: number }>;
  byQualityBucket: Record<string, { trades: number; wins: number; winRate: number; avgPnlPct: number }>;
  factorEdge: { factor: string; avgWin: number; avgLoss: number; edge: number }[];
  bestRegime: string | null;
  worstRegime: string | null;
};

export type BreakerStatus = {
  dailyHalted: boolean;
  weeklyHalted: boolean;
  activeCooldown: boolean;
  cooldownMinutesLeft: number;
  cooldownTriggeredBy: number;
  consecutiveLosses: number;
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  reducedRiskTradesLeft: number;
};
