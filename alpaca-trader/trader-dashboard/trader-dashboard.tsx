import { useState, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useBotApi, postJson } from './use-bot-api.js';
import { StatCard } from './stat-card.js';
import { EquityChart } from './equity-chart.js';
import { PositionsTable } from './positions-table.js';
import { HistoryTable } from './history-table.js';
import { SignalGrid } from './signal-grid.js';
import { LogViewer } from './log-viewer.js';
import { AnalyticsPanel } from './analytics-panel.js';
import { MarketHeatmap } from './market-heatmap.js';
import { ScanFunnel } from './scan-funnel.js';
import { RiskPanel } from './risk-panel.js';
import { PerSymbolPanel } from './per-symbol-panel.js';
import { ConnectModal } from './connect-modal.js';
import { fmtMoney } from './format.js';
import styles from './trader-dashboard.module.css';

type TabId =
  | 'overview' | 'positions' | 'signals' | 'heatmap'
  | 'history' | 'per-symbol' | 'analytics' | 'funnel'
  | 'risk' | 'logs';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',    label: 'Overview',      icon: '📊' },
  { id: 'positions',  label: 'Positions',     icon: '📈' },
  { id: 'signals',    label: 'Signals',       icon: '⚡' },
  { id: 'heatmap',    label: 'Heatmap',       icon: '🌡' },
  { id: 'history',    label: 'History',       icon: '📜' },
  { id: 'per-symbol', label: 'Per Symbol',    icon: '🪙' },
  { id: 'analytics',  label: 'Analytics',     icon: '🧠' },
  { id: 'funnel',     label: 'Scan Funnel',   icon: '🔬' },
  { id: 'risk',       label: 'Risk',          icon: '🛡' },
  { id: 'logs',       label: 'Logs',          icon: '📋' },
];

export function TraderDashboard() {
  const [tab, setTab] = useState<TabId>('overview');
  const [connectOpen, setConnectOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const {
    stats, positions, history, signals, account, equity, health,
    logs, risk, breaker, scanStats, perSymbolStats, loading, error, lastUpdated, refresh,
  } = useBotApi(5000);

  const doClose = useCallback(async (symbol: string) => {
    try { await postJson('/api/close', { symbol }); refresh(); } catch { /* silent */ }
  }, [refresh]);

  const doAction = useCallback(async (path: string, label: string) => {
    setActionBusy(label);
    try { await postJson(path); refresh(); } catch { /* silent */ }
    finally { setActionBusy(null); }
  }, [refresh]);

  /* ────────────────────────── Status Indicators ─────────────────────────── */
  const isHalted = breaker?.dailyHalted || breaker?.weeklyHalted || breaker?.activeCooldown;
  const isConnected = account?.connected ?? false;
  const isPaper = account?.paperTrading ?? true;
  const uptime = health?.uptimeSec
    ? health.uptimeSec < 3600
      ? `${Math.floor(health.uptimeSec / 60)}m`
      : `${(health.uptimeSec / 3600).toFixed(1)}h`
    : '—';

  const lastScanAge = health?.lastScanAgoMs
    ? health.lastScanAgoMs < 60000 ? `${Math.floor(health.lastScanAgoMs / 1000)}s ago` : `${Math.floor(health.lastScanAgoMs / 60000)}m ago`
    : '—';

  if (loading) {
    return (
      <div className={styles.root} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚡</div>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Connecting to bot…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ─── Top Nav ───────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <span style={{ fontWeight: 900, fontSize: 16, letterSpacing: -0.5 }}>AlpacaBot</span>
          </div>

          {/* Status pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
              background: isConnected ? 'rgba(22,211,154,0.15)' : 'rgba(255,84,112,0.15)',
              color: isConnected ? '#16d39a' : '#ff5470',
              border: `1px solid ${isConnected ? 'rgba(22,211,154,0.3)' : 'rgba(255,84,112,0.3)'}`,
            }}>
              {isConnected ? '● LIVE' : '○ OFFLINE'}
            </span>
            {isPaper && (
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
                background: 'rgba(91,127,255,0.15)', color: '#5b7fff', border: '1px solid rgba(91,127,255,0.3)',
              }}>PAPER</span>
            )}
            {isHalted && (
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
                background: 'rgba(255,84,112,0.2)', color: '#ff5470', border: '1px solid rgba(255,84,112,0.4)',
              }}>
                🛑 {breaker?.dailyHalted ? 'DAILY HALTED' : breaker?.weeklyHalted ? 'WEEKLY HALTED' : `COOLDOWN ${breaker?.cooldownMinutesLeft ?? '?'}m`}
              </span>
            )}
            {health?.ok === false && !isHalted && (
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
                background: 'rgba(255,167,51,0.15)', color: '#ffa733',
              }}>⚠ DEGRADED</span>
            )}
          </div>
        </div>

        {/* Right: meta + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {health && (
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 10 }}>
              <span>Up: <strong style={{ color: 'var(--text)' }}>{uptime}</strong></span>
              <span>Scan #{health.scanCount ?? '—'}</span>
              <span>Last: <strong style={{ color: 'var(--text)' }}>{lastScanAge}</strong></span>
              <span>Watch: <strong style={{ color: 'var(--text)' }}>{health.watchlistSize ?? '—'}</strong></span>
            </div>
          )}

          {lastUpdated > 0 && (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              ↻ {new Date(lastUpdated).toLocaleTimeString('en-GB')}
            </span>
          )}

          <button className={styles.btnSecondary} onClick={refresh} title="Refresh now">↺</button>

          {/* Pause / Resume */}
          {stats && (
            <button
              className={stats.paused ? styles.btnWarn : styles.btnSecondary}
              disabled={actionBusy !== null}
              onClick={() => doAction(stats.paused ? '/api/resume' : '/api/pause', stats.paused ? 'resume' : 'pause')}
            >
              {actionBusy === 'pause' || actionBusy === 'resume' ? '…' : stats.paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}

          {/* Breaker manual resume */}
          {(breaker?.dailyHalted || breaker?.weeklyHalted) && (
            <button className={styles.btnDanger}
              disabled={actionBusy !== null}
              onClick={() => doAction('/api/breaker/resume', 'resume-breaker')}>
              {actionBusy === 'resume-breaker' ? '…' : '🔓 Override Halt'}
            </button>
          )}

          <button className={styles.btnPrimary} onClick={() => setConnectOpen(true)}>
            {isConnected ? '🔗 Re-connect' : '🔗 Connect'}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ background: 'rgba(255,84,112,0.1)', border: '1px solid rgba(255,84,112,0.3)', borderRadius: 8, padding: '10px 16px', margin: '0 0 16px 0', color: '#ff5470', fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* ─── KPI Row ─────────────────────────────────────────────────────── */}
      <div className={styles.kpiRow}>
        <StatCard
          label="Equity"
          value={fmtMoney(stats?.equity ?? 0)}
          sub={`Balance ${fmtMoney(stats?.balance ?? 0)}`}
          tone={stats && stats.equity >= stats.startingBalance ? 'pos' : 'neg'}
        />
        <StatCard
          label="Total PnL"
          value={`${(stats?.totalPnl ?? 0) >= 0 ? '+' : ''}${fmtMoney(stats?.totalPnl ?? 0)}`}
          sub={`${(stats?.totalPnlPct ?? 0) >= 0 ? '+' : ''}${(stats?.totalPnlPct ?? 0).toFixed(2)}%`}
          tone={stats && (stats.totalPnl ?? 0) >= 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Today"
          value={`${(stats?.dailyPnl ?? 0) >= 0 ? '+' : ''}${fmtMoney(stats?.dailyPnl ?? 0)}`}
          sub={`${(stats?.dailyPnlPct ?? 0).toFixed(2)}% today`}
          tone={stats && (stats.dailyPnl ?? 0) >= 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Win Rate"
          value={`${(stats?.winRate ?? 0).toFixed(1)}%`}
          sub={`${stats?.wins ?? 0}W · ${stats?.losses ?? 0}L`}
          tone={stats && (stats.winRate ?? 0) >= 50 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Profit Factor"
          value={stats?.profitFactor !== null ? (stats?.profitFactor ?? 0).toFixed(2) : '—'}
          sub={`Sharpe ${(stats?.sharpeRatio ?? 0).toFixed(2)}`}
          tone={stats && (stats.profitFactor ?? 0) > 1 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Drawdown"
          value={`${(stats?.maxDrawdownPct ?? 0).toFixed(2)}%`}
          sub={`${positions.length} open · ${fmtMoney(stats?.totalCosts ?? 0)} fees`}
          tone={stats && (stats.maxDrawdownPct ?? 0) > 5 ? 'neg' : 'neutral'}
        />
        <StatCard
          label="Expectancy"
          value={fmtMoney(stats?.expectancy ?? 0)}
          sub={`Avg W ${fmtMoney(stats?.avgWin ?? 0)} / L ${fmtMoney(stats?.avgLoss ?? 0)}`}
          tone={stats && (stats.expectancy ?? 0) > 0 ? 'pos' : 'neg'}
        />
        {account && (
          <StatCard
            label="Buying Power"
            value={fmtMoney(account.buyingPower ?? account.cash)}
            sub={`#${account.accountNumber?.slice(-4) ?? '????'}`}
            tone="neutral"
          />
        )}
      </div>

      {/* ─── Breaker Summary ─────────────────────────────────────────────── */}
      {breaker && (breaker.consecutiveLosses > 0 || breaker.dailyDrawdownPct > 1) && (
        <div style={{
          display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16,
          padding: '10px 14px', background: 'rgba(255,167,51,0.06)',
          border: '1px solid rgba(255,167,51,0.2)', borderRadius: 10,
        }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Circuit Breaker:</span>
          <span style={{ fontSize: 11 }}>Daily DD <strong style={{ color: breaker.dailyDrawdownPct > 2 ? '#ff5470' : '#ffa733' }}>{breaker.dailyDrawdownPct.toFixed(2)}%</strong></span>
          <span style={{ fontSize: 11 }}>Weekly DD <strong style={{ color: breaker.weeklyDrawdownPct > 5 ? '#ff5470' : 'var(--text)' }}>{breaker.weeklyDrawdownPct.toFixed(2)}%</strong></span>
          <span style={{ fontSize: 11 }}>Consec. Losses <strong style={{ color: breaker.consecutiveLosses >= 3 ? '#ff5470' : 'var(--text)' }}>{breaker.consecutiveLosses}</strong></span>
          {breaker.reducedRiskTradesLeft > 0 && (
            <span style={{ fontSize: 11 }}>Reduced risk for <strong>{breaker.reducedRiskTradesLeft}</strong> more trades</span>
          )}
        </div>
      )}

      {/* ─── Tabs ────────────────────────────────────────────────────────── */}
      <nav className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tabBtn} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span> {t.label}
            {t.id === 'positions' && positions.length > 0 && (
              <span className={styles.badge}>{positions.length}</span>
            )}
            {t.id === 'signals' && signals.filter(s => s.side !== 'NEUTRAL').length > 0 && (
              <span className={styles.badge} style={{ background: '#5b7fff' }}>
                {signals.filter(s => s.side !== 'NEUTRAL').length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ─── Tab Content ─────────────────────────────────────────────────── */}
      <main className={styles.main}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className={styles.overviewGrid}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <span>Equity Curve</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{equity.length} points</span>
              </div>
              <EquityChart data={equity} startingBalance={stats?.startingBalance ?? 10000} />
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <span>Open Positions</span>
                <span className={styles.badge}>{positions.length}</span>
              </div>
              <PositionsTable positions={positions} onClose={doClose} />
            </section>

            <section className={styles.card} style={{ gridColumn: '1 / -1' }}>
              <div className={styles.cardHeader}>
                <span>Market Heatmap</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {signals.filter(s => s.side !== 'NEUTRAL').length} active · {signals.filter(s => s.side === 'NEUTRAL').length} neutral
                </span>
              </div>
              <MarketHeatmap signals={signals} />
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <span>Recent Trades</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Last {Math.min(history.length, 10)}</span>
              </div>
              <HistoryTable trades={history.slice(0, 10)} />
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeader}><span>Scan Funnel</span></div>
              <ScanFunnel data={scanStats} />
            </section>
          </div>
        )}

        {/* POSITIONS */}
        {tab === 'positions' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Open Positions</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={styles.badge}>{positions.length}</span>
                <button className={styles.btnDanger} style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={positions.length === 0 || actionBusy !== null}
                  onClick={() => doAction('/api/panic', 'panic')}>
                  {actionBusy === 'panic' ? '…' : '💥 Close All'}
                </button>
              </div>
            </div>
            <PositionsTable positions={positions} onClose={doClose} />
          </section>
        )}

        {/* SIGNALS */}
        {tab === 'signals' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Live Signals</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {signals.filter(s => s.side !== 'NEUTRAL').length} active · click card to expand
              </span>
            </div>
            <SignalGrid signals={signals} />
          </section>
        )}

        {/* HEATMAP */}
        {tab === 'heatmap' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Market Heatmap</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>ST = Supertrend · V = VWAP distance · DIV = divergence · 🕯 = pattern</span>
            </div>
            <MarketHeatmap signals={signals} />
          </section>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Trade History</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{history.length} total trades</span>
            </div>
            <HistoryTable trades={history} />
          </section>
        )}

        {/* PER SYMBOL */}
        {tab === 'per-symbol' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Per-Symbol Performance</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Freqtrade-style breakdown</span>
            </div>
            <PerSymbolPanel data={perSymbolStats} />
          </section>
        )}

        {/* ANALYTICS */}
        {tab === 'analytics' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}><span>Trade Journal Analytics</span></div>
            <AnalyticsPanel />
          </section>
        )}

        {/* SCAN FUNNEL */}
        {tab === 'funnel' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Scan Gate Funnel</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>why signals get rejected at each gate</span>
            </div>
            <ScanFunnel data={scanStats} />
          </section>
        )}

        {/* RISK */}
        {tab === 'risk' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}><span>Risk Management</span></div>
            <RiskPanel settings={risk ?? undefined} onSaved={refresh} />
          </section>
        )}

        {/* LOGS */}
        {tab === 'logs' && (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span>Bot Logs</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>live · {logs.length} entries</span>
            </div>
            <LogViewer logs={logs} />
          </section>
        )}
      </main>

      {/* ─── Connect Modal ───────────────────────────────────────────────── */}
      {connectOpen && (
        <ConnectModal
          status={account
            ? { connected: account.connected, paper: account.paperTrading, message: account.status }
            : { connected: false, paper: true, message: 'Disconnected' }}
          onClose={() => setConnectOpen(false)}
          onConnected={refresh}
        />
      )}
    </div>
  );
}
