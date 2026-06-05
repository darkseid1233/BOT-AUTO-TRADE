import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useBotApi, postJson } from './use-bot-api.js';
import { StatCard } from './stat-card.js';
import { EquityChart } from './equity-chart.js';
import { PositionsTable } from './positions-table.js';
import { HistoryTable } from './history-table.js';
import { SignalGrid } from './signal-grid.js';
import { LogViewer } from './log-viewer.js';
import { AnalyticsPanel } from './analytics-panel.js';
import { ConnectModal } from './connect-modal.js';
import { RiskPanel } from './risk-panel.js';
import { fmtTime, fmtMoney, fmtAgo } from './format.js';
import styles from './trader-dashboard.module.css';

type Tab = 'overview' | 'signals' | 'positions' | 'history' | 'analytics' | 'risk' | 'logs';

/**
 * AlpacaBot — the live paper-trading dashboard. Polls the trader-service for
 * stats, positions, signals, equity, account, and logs, and exposes control
 * actions (pause / resume / panic / close).
 */
function AlpacaBot() {
  const {
    stats, positions, history, signals, account, equity, health, logs, risk,
    loading, error, lastUpdated, refresh,
  } = useBotApi(5000);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const control = async (path: string) => {
    setBusy(true);
    try {
      await postJson(path);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const closeSymbol = (symbol: string) => control(`/api/control/close/${encodeURIComponent(symbol)}`);

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Connecting to the trading bot…</span>
        </div>
      </div>
    );
  }

  const connected = account?.connected ?? false;
  const equityVal = stats?.equity ?? account?.equity ?? 0;
  const scanAgo = health ? fmtAgo(health.lastScanAgoMs) : '—';
  const scanOk = health ? health.lastScanAgoMs >= 0 && health.lastScanAgoMs < health.scanIntervalSec * 3000 : false;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'signals', label: `🔔 Signals${signals.filter((s) => s.side !== 'NEUTRAL').length ? ` (${signals.filter((s) => s.side !== 'NEUTRAL').length})` : ''}` },
    { id: 'positions', label: `⚡ Positions (${positions.length})` },
    { id: 'history', label: '📋 History' },
    { id: 'analytics', label: '📈 Analytics' },
    { id: 'risk', label: '🛡️ Risk' },
    { id: 'logs', label: '📡 Logs' },
  ];

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>🦙</span>
          <div>
            <div className={styles.logo}>AlpacaBot</div>
            <div className={styles.tagline}>Automated Alpaca paper trader</div>
          </div>
          <span className={`${styles.badge} ${connected ? styles.badgeLive : styles.badgeDemo}`}>
            {connected ? 'Alpaca Paper' : 'Demo Mode'}
          </span>
        </div>
        <div className={styles.headerRight}>
          {lastUpdated > 0 && <span className={styles.updateTs}>Updated {fmtTime(lastUpdated)}</span>}
          <button
            className={`${styles.btn} ${connected ? '' : styles.btnPrimary}`}
            onClick={() => setShowConnect(true)}
            disabled={busy}
          >
            {connected ? '🔑 Account' : '🔑 Connect Alpaca'}
          </button>
          <button className={styles.btn} onClick={refresh} disabled={busy}>Refresh</button>
          {stats?.paused
            ? <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => control('/api/control/resume')}>Resume</button>
            : <button className={`${styles.btn} ${styles.btnWarn}`} disabled={busy} onClick={() => control('/api/control/pause')}>Pause</button>}
          <button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => control('/api/control/panic')}>Panic close</button>
        </div>
      </header>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <div className={styles.chip}>
          <span className={`${styles.dot} ${connected ? styles.dotGreen : styles.dotYellow}`} />
          {connected ? `Alpaca ${account?.status}` : 'Demo (no API keys)'}
        </div>
        <div className={styles.chip}>
          <span className={`${styles.dot} ${scanOk ? styles.dotGreen : styles.dotYellow}`} />
          Scan {scanAgo}
        </div>
        <div className={styles.chip}>
          <span className={`${styles.dot} ${stats?.paused ? styles.dotRed : styles.dotGreen}`} />
          {stats?.paused ? 'Paused' : 'Active'}
        </div>
        <div className={styles.chip}>
          <span className={`${styles.dot} ${positions.length ? styles.dotGreen : styles.dotGray}`} />
          {positions.length} open
        </div>
        {health && (
          <div className={styles.chip}>
            <span className={`${styles.dot} ${styles.dotGray}`} />
            {health.watchlistSize} symbols · up {Math.floor(health.uptimeSec / 60)}m
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className={styles.main}>
        {error && <div className={styles.errorBanner}>⚠️ {error}</div>}

        {tab === 'overview' && (
          <>
            {/* Account panel */}
            {account && (
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>🦙 Alpaca Account</span>
                  <span className={styles.cardBadge}>{account.paperTrading ? 'PAPER' : 'LIVE'} · {account.accountNumber}</span>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.accountGrid}>
                    <div className={styles.accountItem}><span className={styles.accountLabel}>Portfolio Value</span><span className={styles.accountValue}>${account.portfolioValue.toLocaleString()}</span></div>
                    <div className={styles.accountItem}><span className={styles.accountLabel}>Cash</span><span className={styles.accountValue}>${account.cash.toLocaleString()}</span></div>
                    <div className={styles.accountItem}><span className={styles.accountLabel}>Buying Power</span><span className={styles.accountValue}>${account.buyingPower.toLocaleString()}</span></div>
                    <div className={styles.accountItem}><span className={styles.accountLabel}>Status</span><span className={styles.accountValue}>{account.status}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* KPIs */}
            {stats && (
              <div className={styles.statsGrid}>
                <StatCard label="Equity" value={`$${equityVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} tone={equityVal >= stats.startingBalance ? 'pos' : 'neg'} sub={`Balance $${stats.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                <StatCard label="Total PnL" value={fmtMoney(stats.totalPnl)} tone={stats.totalPnl >= 0 ? 'pos' : 'neg'} sub={`${stats.totalPnlPct >= 0 ? '+' : ''}${stats.totalPnlPct.toFixed(2)}%`} />
                <StatCard label="Daily PnL" value={fmtMoney(stats.dailyPnl)} tone={stats.dailyPnl >= 0 ? 'pos' : 'neg'} sub={`${stats.dailyPnlPct >= 0 ? '+' : ''}${stats.dailyPnlPct.toFixed(2)}%`} />
                <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} tone={stats.winRate >= 50 ? 'pos' : 'neg'} sub={`${stats.wins}W / ${stats.losses}L`} />
                <StatCard label="Profit Factor" value={stats.profitFactor === null ? '∞' : stats.profitFactor.toFixed(2)} tone={(stats.profitFactor ?? 1) >= 1 ? 'pos' : 'neg'} />
                <StatCard label="Sharpe" value={stats.sharpeRatio.toFixed(2)} tone={stats.sharpeRatio >= 1 ? 'pos' : 'neutral'} />
                <StatCard label="Max Drawdown" value={`${stats.maxDrawdownPct.toFixed(2)}%`} tone={stats.maxDrawdownPct < 10 ? 'pos' : 'neg'} />
                <StatCard label="Trades" value={String(stats.totalTrades)} sub={`${positions.length} open`} />
                <StatCard label="Avg Win" value={fmtMoney(stats.avgWin)} tone="pos" />
                <StatCard label="Avg Loss" value={fmtMoney(-Math.abs(stats.avgLoss))} tone="neg" />
                <StatCard label="Expectancy" value={fmtMoney(stats.expectancy)} tone={stats.expectancy >= 0 ? 'pos' : 'neg'} sub="per trade" />
                <StatCard label="Available" value={`$${stats.availableUSDT.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              </div>
            )}

            {/* Equity curve */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>📈 Equity Curve</span>
                {stats && <span className={styles.cardBadge}>Start ${stats.startingBalance.toLocaleString()}</span>}
              </div>
              <div className={styles.cardBody}>
                <EquityChart data={equity} startingBalance={stats?.startingBalance ?? 100000} />
              </div>
            </div>

            {/* Open positions */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>⚡ Open Positions</span>
                <span className={styles.cardBadge}>{positions.length}</span>
              </div>
              <PositionsTable positions={positions} onClose={closeSymbol} />
            </div>
          </>
        )}

        {tab === 'signals' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>🔔 Live Signals</span>
              <span className={styles.cardBadge}>{signals.filter((s) => s.side !== 'NEUTRAL').length} active / {signals.length} scanned</span>
            </div>
            <SignalGrid signals={signals} />
          </div>
        )}

        {tab === 'positions' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>⚡ Open Positions</span>
              <span className={styles.cardBadge}>{positions.length}</span>
            </div>
            <PositionsTable positions={positions} onClose={closeSymbol} />
          </div>
        )}

        {tab === 'history' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>📋 Trade History</span>
              <span className={styles.cardBadge}>{history.length} total</span>
            </div>
            <HistoryTable trades={history} />
          </div>
        )}

        {tab === 'analytics' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>📈 Performance Analytics</span>
              <span className={styles.cardBadge}>trade journal · by regime / quality / factor</span>
            </div>
            <AnalyticsPanel />
          </div>
        )}

        {tab === 'risk' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>🛡️ Risk Management</span>
              <span className={styles.cardBadge}>balance-based sizing</span>
            </div>
            <RiskPanel risk={risk} balance={stats?.balance ?? account?.cash ?? 100000} onSaved={refresh} />
          </div>
        )}

        {tab === 'logs' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>📡 Live Bot Logs</span>
              <span className={styles.cardBadge}>auto-refresh 4s</span>
            </div>
            <LogViewer logs={logs} />
          </div>
        )}
      </main>

      {showConnect && (
        <ConnectModal
          connected={connected}
          onClose={() => setShowConnect(false)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/**
 * Router entry for the dashboard app.
 */
export function TraderDashboard() {
  return (
    <Routes>
      <Route path="/" element={<AlpacaBot />} />
    </Routes>
  );
}
