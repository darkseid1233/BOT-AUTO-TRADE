import { useState } from 'react';
import type { ClosedTrade } from './types.js';
import { fmtPrice, fmtMoney, fmtTime } from './format.js';
import styles from './trader-dashboard.module.css';

const REASON_COLORS: Record<string, string> = {
  TP: '#16d39a', TP_PARTIAL_L1: '#5b7fff', TP_PARTIAL_L2: '#3a5ad9',
  SL: '#ff5470', TRAILING: '#ffa733', MANUAL: '#717795', PANIC: '#ff0055',
};

/**
 * Closed trade history table v2 — with reason badge, PnL%, hold duration, side chip.
 * Sortable by PnL. Paginated at 50.
 */
export function HistoryTable({ trades }: { trades: ClosedTrade[] }) {
  const [sortBy, setSortBy] = useState<'time' | 'pnl'>('time');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  if (trades.length === 0) {
    return <div className={styles.empty}>No closed trades yet.</div>;
  }

  const sorted = [...trades].sort((a, b) =>
    sortBy === 'time' ? b.closedAt - a.closedAt : b.realizedPnl - a.realizedPnl,
  );
  const total = sorted.length;
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function fmtDuration(from: number, to: number): string {
    const m = Math.round((to - from) / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
  }

  const wins = trades.filter((t) => t.realizedPnl > 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);

  return (
    <div className={styles.historyRoot}>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ padding: '8px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Total </span>
          <strong>{total}</strong>
        </div>
        <div style={{ padding: '8px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Win Rate </span>
          <strong style={{ color: wins / total >= 0.5 ? '#16d39a' : '#ff5470' }}>
            {total > 0 ? ((wins / total) * 100).toFixed(1) : 0}%
          </strong>
        </div>
        <div style={{ padding: '8px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Total PnL </span>
          <strong style={{ color: totalPnl >= 0 ? '#16d39a' : '#ff5470' }}>
            {totalPnl >= 0 ? '+' : ''}{fmtMoney(totalPnl)}
          </strong>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Sort:</span>
          <button style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: sortBy === 'time' ? 'var(--accent2)' : 'var(--surface2)', color: 'var(--text)',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }} onClick={() => { setSortBy('time'); setPage(0); }}>Time</button>
          <button style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: sortBy === 'pnl' ? 'var(--accent2)' : 'var(--surface2)', color: 'var(--text)',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }} onClick={() => { setSortBy('pnl'); setPage(0); }}>PnL</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ textAlign: 'left', padding: '7px 8px' }}>Symbol</th>
              <th style={{ textAlign: 'center', padding: '7px 8px' }}>Side</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>Entry</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>Close</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>PnL</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>%</th>
              <th style={{ textAlign: 'center', padding: '7px 8px' }}>Reason</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>Hold</th>
              <th style={{ textAlign: 'right', padding: '7px 8px' }}>Closed</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((t) => {
              const isWin = t.realizedPnl > 0;
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(35,40,68,0.5)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(91,127,255,0.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                  <td style={{ padding: '9px 8px', fontWeight: 700, color: 'var(--text)' }}>
                    {t.symbol.replace('/USD', '')}
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                      background: t.side === 'LONG' ? 'rgba(22,211,154,0.15)' : 'rgba(255,84,112,0.15)',
                      color: t.side === 'LONG' ? '#16d39a' : '#ff5470',
                    }}>{t.side}</span>
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--muted)' }}>
                    {fmtPrice(t.entryPrice)}
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                    {fmtPrice(t.closePrice)}
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: isWin ? '#16d39a' : '#ff5470' }}>
                    {isWin ? '+' : ''}{fmtMoney(t.realizedPnl)}
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right', color: isWin ? '#16d39a' : '#ff5470' }}>
                    {(t.pnlPercent ?? 0) >= 0 ? '+' : ''}{(t.pnlPercent ?? 0).toFixed(2)}%
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                      background: (REASON_COLORS[t.reason] ?? '#717795') + '22',
                      color: REASON_COLORS[t.reason] ?? '#717795',
                    }}>{t.reason}</span>
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
                    {fmtDuration(t.openedAt, t.closedAt)}
                  </td>
                  <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
                    {fmtTime(t.closedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, alignItems: 'center' }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
            ←
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {page + 1} / {Math.ceil(total / pageSize)}
          </span>
          <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: (page + 1) * pageSize >= total ? 'not-allowed' : 'pointer', opacity: (page + 1) * pageSize >= total ? 0.4 : 1 }}>
            →
          </button>
        </div>
      )}
    </div>
  );
}
