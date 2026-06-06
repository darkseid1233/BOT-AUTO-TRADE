import type { PerSymbolStats } from './types.js';
import { fmtMoney } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Per-Symbol Performance Panel — Freqtrade-style breakdown.
 * Shows win rate, PnL, avg duration, top exit reason for every traded symbol.
 */
export function PerSymbolPanel({ data }: { data: PerSymbolStats | null }) {
  if (!data || Object.keys(data).length === 0) {
    return <div className={styles.empty}>No closed trades yet — per-symbol stats will appear here.</div>;
  }

  const rows = Object.entries(data)
    .map(([symbol, s]) => ({ symbol, ...s }))
    .sort((a, b) => b.totalPnl - a.totalPnl);

  const bestReason = (reasons: Record<string, number>): string => {
    const sorted = Object.entries(reasons).sort(([, a], [, b]) => b - a);
    return sorted[0]?.[0] ?? '—';
  };

  const fmtDuration = (ms: number): string => {
    if (!ms) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  return (
    <div className={styles.perSymbolPanel}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Symbol</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Trades</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Win%</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Total PnL</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Avg Win</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Avg Loss</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Best</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Worst</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Avg Hold</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Top Exit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} style={{ borderBottom: '1px solid rgba(35,40,68,0.5)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(91,127,255,0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <td style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {r.symbol.replace('/USD', '')}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--muted)' }}>{r.trades}</td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  <WinRateBadge rate={r.winRate} />
                </td>
                <td style={{
                  textAlign: 'right', padding: '10px 10px', fontWeight: 700,
                  color: r.totalPnl >= 0 ? '#16d39a' : '#ff5470',
                }}>
                  {r.totalPnl >= 0 ? '+' : ''}{fmtMoney(r.totalPnl)}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#16d39a' }}>
                  {r.avgWin > 0 ? '+' + fmtMoney(r.avgWin) : '—'}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#ff5470' }}>
                  {r.avgLoss > 0 ? '-' + fmtMoney(r.avgLoss) : '—'}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#16d39a', fontSize: 12 }}>
                  {fmtMoney(r.bestTrade)}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#ff5470', fontSize: 12 }}>
                  {fmtMoney(r.worstTrade)}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--muted)' }}>
                  {fmtDuration(r.avgDurationMs)}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                    background: r.reasons.TP ? 'rgba(22,211,154,0.1)' : 'rgba(255,84,112,0.1)',
                    color: r.reasons.TP ? '#16d39a' : '#ff5470',
                  }}>
                    {bestReason(r.reasons)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>BEST SYMBOL</div>
          <div style={{ fontWeight: 800, color: '#16d39a', fontSize: 15 }}>
            {rows[0]?.symbol.replace('/USD', '') ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: '#16d39a' }}>+{fmtMoney(rows[0]?.totalPnl ?? 0)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>WORST SYMBOL</div>
          <div style={{ fontWeight: 800, color: '#ff5470', fontSize: 15 }}>
            {rows[rows.length - 1]?.symbol.replace('/USD', '') ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: '#ff5470' }}>{fmtMoney(rows[rows.length - 1]?.totalPnl ?? 0)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>AVG WIN RATE</div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {(rows.reduce((s, r) => s + r.winRate, 0) / Math.max(rows.length, 1)).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function WinRateBadge({ rate }: { rate: number }) {
  const color = rate >= 60 ? '#16d39a' : rate >= 45 ? '#f5d020' : '#ff5470';
  return (
    <span style={{ fontWeight: 700, color }}>
      {rate.toFixed(0)}%
    </span>
  );
}
