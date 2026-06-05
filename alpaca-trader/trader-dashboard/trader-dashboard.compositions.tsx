import { MemoryRouter } from 'react-router-dom';
import { TraderDashboard } from './trader-dashboard.js';
import { StatCard } from './stat-card.js';
import { SignalGrid } from './signal-grid.js';
import { PositionsTable } from './positions-table.js';
import type { Signal, OpenPosition } from './types.js';

/** Full dashboard (connects to the live service when running in the platform). */
export const FullDashboard = () => (
  <MemoryRouter>
    <TraderDashboard />
  </MemoryRouter>
);

/** A grid of KPI stat cards in different tones. */
export const StatCards = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 20, background: '#0a0c16' }}>
    <StatCard label="Equity" value="$104,820" tone="pos" sub="Balance $103,500" />
    <StatCard label="Total PnL" value="+$4,820" tone="pos" sub="+4.82%" />
    <StatCard label="Max Drawdown" value="6.40%" tone="neg" />
  </div>
);

const mockSignals: Signal[] = [
  {
    symbol: 'BTC/USD', side: 'LONG', confidence: 78, price: 64200, entry: 64200,
    stopLoss: 63100, takeProfit: 66400, riskReward: 2.0,
    reasons: ['Trend up (EMA20 > EMA50)', 'Momentum 1.4% confirms'], blocked: [],
    indicators: { rsi: 56, ema20: 64100, ema50: 63500, sma: 63900, atr: 730, momentum: 1.4 },
    timestamp: Date.now(),
  },
  {
    symbol: 'ETH/USD', side: 'NEUTRAL', confidence: 0, price: 3210, entry: 3210,
    stopLoss: 0, takeProfit: 0, riskReward: 0,
    reasons: [], blocked: ['No clear trend (EMA20 ≈ EMA50)'],
    indicators: { rsi: 49, ema20: 3208, ema50: 3209, sma: 3210, atr: 40, momentum: -0.1 },
    timestamp: Date.now(),
  },
];

/** Signals grid with one active and one neutral signal. */
export const Signals = () => (
  <div style={{ background: '#0a0c16' }}>
    <SignalGrid signals={mockSignals} />
  </div>
);

const mockPositions: OpenPosition[] = [
  {
    id: 'P1', symbol: 'SOL/USD', side: 'LONG', entryPrice: 150, markPrice: 154,
    qty: 12, notional: 1800, stopLoss: 146, takeProfit: 162, unrealizedPnl: 48,
    pnlPercent: 2.67, openedAt: Date.now(), confidence: 72,
  },
];

/** Open positions table. */
export const Positions = () => (
  <div style={{ background: '#0a0c16' }}>
    <PositionsTable positions={mockPositions} onClose={() => {}} />
  </div>
);
