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
import { ScanFunnel } from './scan-funnel.js';
import { ConnectModal } from './connect-modal.js';
import { RiskPanel } from './risk-panel.js';
import { fmtTime, fmtMoney, fmtAgo } from './format.js';
import styles from './trader-dashboard.module.css';

type Tab = 'overview' | 'signals' | 'positions' | 'history' | 'analytics' | 'risk' | 'logs';

function AlpacaBot() {
  const {
    stats, positions, history, signals, account, equity, health, logs, risk, breaker, scanStats,
    loading, error, lastUpdated, refresh,
  } = useBotApi(5000);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const control = async (path: string) => {
    setBusy(true);
    try { await postJson(path); await refresh(); } finally { setBusy(false); }
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
    { id: 'overview',  label: '📊 Overview' },
    { id: 'signals',   label: `🔔 Signals${signals.filter((s) => s.side !== 'NEUTRAL').length ? ` (${signals.filter((s) => s.side !== 'NEUTRAL').length})` : ''}` },
    { id: 'positions', label: `⚡ Positions (${positions.length})` },
    { id: 'history',   label: '📋 History' },
    { id: 'analytics', label: '📈 Analytics' },
    { id: 'risk',      label: '🛡️ Risk' },
    { id: 'logs',      label: '📡 Logs' },
  ];

  /* Is the circuit breaker active in any way? */
  const breakerActive = breaker?.activeCooldown || breaker?.weeklyHalted || breaker?.dailyHalted;

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>🦩</span>
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

          {/* RESUME trading (manual pause/resume) */}
          {stats?.paused
            ? <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => control('/api/control/resume')}>▶ Resume trading</button>
            : <button className={`${styles.btn} ${styles.btnWarn}`} disabled={busy} onClick={() => control('/api/control/pause')}>⏸ Pause</button>}

          {/* RESUME button — clears streak/daily/weekly cooldown */}
          {breakerActive && (
            <button
              className={`${styles.btn} ${styles.btnResume}`}
              disabled={busy}
              onClick={() => control('/api/breaker/resume')}
              title={
                breaker?.activeCooldown
                  ? `Streak cooldown — ${breaker.cooldownMinutesLeft}m left after ${breaker.cooldownTriggeredBy} consecutive losses. Click to force-clear.`
                  : breaker?.weeklyHalted
                  ? 'Weekly drawdown halt active. Click to clear manually and reset the weekly baseline.'
                  : 'Daily halt active. Click to clear manually.'
              }
            >
              ⚡ RESUME{breaker?.activeCooldown ? ` (${breaker.cooldownMinutesLeft}m)` : ''}
            </button>
          )}

          <button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => control('/api/control/panic')}>🚨 Panic close</button>
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
        {/* Breaker status chips */}
        {breaker?.activeCooldown && (
          <div className={`${styles.chip} ${styles.chipWarn}`}>
            <span className={`${styles.dot} ${styles.dotYellow}`} />
            ⚠️ Streak cooldown {breaker.cooldownMinutesLeft}m · {breaker.cooldownTriggeredBy} losses
          </div>
        )}
        {breaker?.weeklyHalted && (
          <div className={`${styles.chip} ${styles.chipDanger}`}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            🔴 Weekly halt — manual resume required
          </div>
        )}
        {breaker?.dailyHalted && (
          <div className={`${styles.chip} ${styles.chipDanger}`}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            🔴 Daily halt — resets midnight UTC
          </div>
        )}
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
            {account && (
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>🦩 Alpaca Account</span>
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

            {/* Circuit Breaker status card (shown only when active) */}
            {breakerActive && (
              <div className={styles.card} style={{ borderColor: 'rgba(245,208,32,0.4)', background: 'rgba(245,208,32,0.04)' }}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>⚡ Circuit Breaker Active</span>
                  <button
                    className={`${styles.btn} ${styles.btnResume}`}
                    style={{ fontSize: '12px', padding: '6px 14px' }}
                    disabled={busy}
                    onClick={() => control('/api/breaker/resume')}
                  >
                    RESUME — Clear Cooldown
                  </button>
                </div>
                <div className={styles.cardBody} style={{ padding: '14px 18px', fontSize: '13px', lineHeight: '1.8' }}>
                  {breaker?.activeCooldown && <div>⏰ <strong>Streak cooldown:</strong> {breaker.cooldownMinutesLeft}m left after {breaker.cooldownTriggeredBy} consecutive losses. Bot will not open new trades until cooldown expires OR you click RESUME above.</div>}
                  {breaker?.weeklyHalted && <div>🔴 <strong>Weekly halt:</strong> Drawdown exceeded the weekly limit. Requires manual resume.</div>}
                  {breaker?.dailyHalted && <div>🔴 <strong>Daily halt:</strong> Drawdown exceeded the daily limit. Resets automatically at midnight UTC.</div>}
                  {(breaker?.dailyDrawdownPct ?? 0) > 0 && <div>📉 Daily drawdown: <strong style={{ color: 'var(--loss)' }}>{breaker!.dailyDrawdownPct.toFixed(2)}%</strong></div>}
                  {(breaker?.weeklyDrawdownPct ?? 0) > 0 && <div>📉 Weekly drawdown: <strong style={{ color: 'var(--loss)' }}>{breaker!.weeklyDrawdownPct.toFixed(2)}%</strong></div>}
                  {(breaker?.reducedRiskTradesLeft ?? 0) > 0 && <div>⚠️ Reduced-risk mode: next <strong>{breaker!.reducedRiskTradesLeft}</strong> trades at 75% size.</div>}
                </div>
              </div>
            )}

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
                <StatCard label="Available" value={`${stats.availableUSDT.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                <StatCard label="Fees + Slippage" value={fmtMoney(-Math.abs(stats.totalCosts ?? 0))} tone="neg" sub="real cost paid" />
              </div>
            )}

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>📈 Equity Curve</span>
                {stats && <span className={styles.cardBadge}>Start ${stats.startingBalance.toLocaleString()}</span>}
              </div>
              <div className={styles.cardBody}>
                <EquityChart data={equity} startingBalance={stats?.startingBalance ?? 100000} />
              </div>
            </div>

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
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 24 }}>
              <ScanFunnel scanStats={scanStats} />
              <AnalyticsPanel />
            </div>
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

export function TraderDashboard() {
  return (
    <Routes>
      <Route path="/" element={<AlpacaBot />} />
    </Routes>
  );
}
