/**
 * Shared domain types for the Alpaca trading bot service.
 * These shapes are returned by the REST API and consumed by the dashboard.
 */

export type WatchSymbol = string;
export type Side = 'LONG' | 'SHORT' | 'NEUTRAL';

export type Signal = {
  symbol: string;
  side: Side;
  confidence: number;
  qualityScore?: number;
  qualityFactors?: Record<string, number>;
  btcState?: string;
  htfResult?: { trend1h: string; confirmed: boolean };
  tradeJournal?: unknown;
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

export type OpenPosition = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  qty: number;
  /** Remaining qty after partial TPs. */
  qtyRemaining: number;
  notional: number;
  stopLoss: number;
  /** Original SL before breakeven adjustment. */
  initialStopLoss: number;
  takeProfit: number;
  /** Whether chandelier trailing stop is active (after L2 hit). */
  trailingActive: boolean;
  /** Current trailing stop level. */
  trailingStop: number;
  /** ATR at entry — used for trailing step. */
  atrValue: number;
  /** L1 partial TP triggered. */
  l1Hit: boolean;
  /** L2 partial TP triggered. */
  l2Hit: boolean;
  unrealizedPnl: number;
  pnlPercent: number;
  openedAt: number;
  confidence: number;
  context?: SignalContext;
};

export type SignalContext = {
  qualityScore: number;
  marketRegime: string;
  btcState?: string;
  trend1h?: string;
  entryReasons: string[];
  qualityFactors?: Record<string, number>;
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
  context?: SignalContext;
};

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

export type EquityPoint = { ts: number; balance: number; };

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

export type ConnectionStatus = {
  connected: boolean;
  paper: boolean;
  message: string;
};

export type RiskSettings = {
  riskPerTradePct: number;
  maxOpenTrades: number;
  maxNotionalPct: number;
  maxTotalExposurePct: number;
  minConfidence: number;
  dailyMaxLossPct: number;
  maxDrawdownStopPct: number;
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
