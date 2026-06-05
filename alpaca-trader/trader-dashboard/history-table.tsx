import type { ClosedTrade } from './types.js';
import { fmtPrice, fmtMoney, fmtTime } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Table of recently closed trades.
 * @param props.trades closed trade history (newest first)
 */
export function HistoryTable({ trades }: { trades: ClosedTrade[] }) {
  if (trades.length === 0) {
    return <div className={styles.empty}>No closed trades yet.</div>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th>Entry</th><th>Close</th>
            <th>PnL</th><th>PnL %</th><th>Reason</th><th>Closed</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={`${t.id}-${t.closedAt}`}>
              <td className={styles.symbol}>{t.symbol}</td>
              <td className={t.side === 'LONG' ? styles.long : styles.short}>{t.side}</td>
              <td>{fmtPrice(t.entryPrice)}</td>
              <td>{fmtPrice(t.closePrice)}</td>
              <td className={t.realizedPnl >= 0 ? styles.long : styles.short}>{fmtMoney(t.realizedPnl)}</td>
              <td className={t.pnlPercent >= 0 ? styles.long : styles.short}>{t.pnlPercent.toFixed(2)}%</td>
              <td>{t.reason}</td>
              <td>{fmtTime(t.closedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
