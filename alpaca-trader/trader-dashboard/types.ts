/**
 * Dashboard-side types — fully synced with the trader-service REST API.
 * Updated: new indicators (Supertrend, VWAP, Divergence, CandlePattern),
 * per-symbol stats, signal context, backtest types.
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
  totalCosts: number;
};

/** Per-gate rejection histogram from /api/scan-stats */
export type GateStats = {
  insufficientBars: number;
  regime: number;
  volume: number;
  rsiLateEntry: number;
  btcOpposing: number;
  quality: number;
  riskReward: number;
  fearGreed: number;
  slCooldown: number;
  signalDedup: number;
  dataQuality: number;
  riskCap: number;
  opened: number;
};

export type ScanStats = { cumulative: GateStats; lastScan: GateStats };

export type SignalContext = {
  qualityScore: number;
  marketRegime: string;
  btcState?: string;
  trend1h?: string;
  entryReasons: string[];
  qualityFactors?: Record<string, number>;
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
  atrValue: number;
  l1Hit: boolean;
  l2Hit: boolean;
  unrealizedPnl: number;
  pnlPercent: number;
  openedAt: number;
  confidence: number;
  context?: SignalContext;
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
  reason: 'TP' | 'SL' | 'TRAILING' | 'TP_PARTIAL_L1' | 'TP_PARTIAL_L2' | 'MANUAL' | 'PANIC' | 'TIME';
  openedAt: number;
  closedAt: number;
  context?: SignalContext;
};

export type Signal = {
  symbol: string;
  side: Side;
  confidence: number;
  qualityScore?: number;
  qualityFactors?: Record<string, number>;
  btcState?: string;
  trend1h?: string;
  chopIndex?: number;
  chopValue?: number;
  adx?: number;
  atr?: number;
  marketRegime?: string;
  smcBull?: number;
  smcBear?: number;
  fearGreed?: number;
  price: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasons: string[];
  blocked: string[];
  indicators?: {
    ema20: number; ema50: number; ema200: number;
    rsi: number; sma: number; atr: number; momentum: number;
    adx?: number; macdHistogram?: number; stochRsi?: number;
    bollingerPct?: number; volRatio?: number;
    // new from research audit
    supertrend?: number;
    supertrendDir?: 'up' | 'down';
    vwap?: number;
    vwapDistPct?: number;
    divergence?: string;
    candlePattern?: string;
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

export type EquityPoint = { ts: number; balance: number };

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

export type LogEntry = { ts: number; level: 'info' | 'warn' | 'error' | 'debug'; msg: string };

export type RiskSettings = {
  riskPerTradePct: number;
  maxOpenTrades: number;
  maxNotionalPct: number;
  maxTotalExposurePct: number;
  minConfidence: number;
  dailyMaxLossPct: number;
  maxDrawdownStopPct: number;
};

export type ConnectionStatus = { connected: boolean; paper: boolean; message: string };

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

/** Per-symbol performance breakdown from /api/per-symbol-stats */
export type PerSymbolStats = Record<string, {
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgDurationMs: number;
  reasons: Record<string, number>;
}>;

export type BacktestResult = {
  symbol: string;
  timeframe: string;
  bars: number;
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  avgPnlPct: number;
  profitFactor: number;
  expectancyR: number;
  sharpe: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  startBalance: number;
  finalBalance: number;
};
