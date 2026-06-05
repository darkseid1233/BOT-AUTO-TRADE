import type { OpenPosition } from './types.js';
import { fmtPrice, fmtMoney } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Table of currently open positions with a per-row close button.
 * @param props.positions open positions
 * @param props.onClose callback invoked with the symbol to close
 */
export function PositionsTable({
  positions,
  onClose,
}: {
  positions: OpenPosition[];
  onClose: (symbol: string) => void;
}) {
  if (positions.length === 0) {
    return <div className={styles.empty}>No open positions.</div>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th>Entry</th><th>Mark</th>
            <th>Qty</th><th>SL</th><th>TP</th><th>PnL</th><th>PnL %</th><th>Conf</th><th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id}>
              <td className={styles.symbol}>{p.symbol}</td>
              <td className={p.side === 'LONG' ? styles.long : styles.short}>{p.side}</td>
              <td>{fmtPrice(p.entryPrice)}</td>
              <td>{fmtPrice(p.markPrice)}</td>
              <td>{p.qty.toFixed(4)}</td>
              <td className={styles.short}>{fmtPrice(p.stopLoss)}</td>
              <td className={styles.long}>{fmtPrice(p.takeProfit)}</td>
              <td className={p.unrealizedPnl >= 0 ? styles.long : styles.short}>{fmtMoney(p.unrealizedPnl)}</td>
              <td className={p.pnlPercent >= 0 ? styles.long : styles.short}>{p.pnlPercent.toFixed(2)}%</td>
              <td>{p.confidence}</td>
              <td>
                <button className={styles.closeBtn} onClick={() => onClose(p.symbol)}>Close</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
