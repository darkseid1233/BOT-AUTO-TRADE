import { useState } from 'react';
import type { OpenPosition } from './types.js';
import { fmtPrice, fmtMoney, fmtAgo } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Table of currently open positions with a per-row close button.
 * Shows trailing stop, partial TP tiers, unrealized PnL with live pulse.
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
  const [closing, setClosing] = useState<string | null>(null);

  if (positions.length === 0) {
    return (
      <div className={styles.empty}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
        No open positions — bot is scanning for setups.
      </div>
    );
  }

  const handleClose = async (symbol: string) => {
    setClosing(symbol);
    try { await Promise.resolve(onClose(symbol)); }
    finally { setClosing(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px' }}>
      {positions.map((p) => {
        const pnlPos = p.unrealizedPnl >= 0;
        const pnlColor = pnlPos ? 'var(--win)' : 'var(--loss)';
        const sideColor = p.side === 'LONG' ? 'var(--win)' : 'var(--loss)';
        const holdAgo = fmtAgo(Date.now() - p.openedAt);
        // Progress: how far price has moved from entry toward TP
        const totalDist = Math.abs(p.takeProfit - p.entryPrice);
        const moved = Math.abs(p.markPrice - p.entryPrice);
        const progress = totalDist > 0 ? Math.min(100, (moved / totalDist) * 100) : 0;

        return (
          <div key={p.id} style={{
            background: 'var(--surface2)',
            border: `1px solid ${pnlPos ? 'rgba(22,211,154,0.25)' : 'rgba(255,84,112,0.25)'}`,
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* Top row: symbol + side + PnL + close button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>{p.symbol}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 4, color: sideColor,
                  background: p.side === 'LONG' ? 'rgba(22,211,154,0.15)' : 'rgba(255,84,112,0.15)',
                  border: `1px solid ${sideColor}55`,
                }}>{p.side}</span>
                {p.trailingActive && (
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(245,208,32,0.15)', color: '#f5d020', border: '1px solid rgba(245,208,32,0.4)' }}>🎯 TRAILING</span>
                )}
                {p.l1Hit && !p.l2Hit && (
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(91,127,255,0.15)', color: '#5b7fff', border: '1px solid rgba(91,127,255,0.4)' }}>L1 ✅</span>
                )}
                {p.l2Hit && (
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(91,127,255,0.25)', color: '#5b7fff', border: '1px solid rgba(91,127,255,0.5)' }}>L2 ✅✅</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: pnlColor, fontWeight: 800, fontSize: 15 }} className={styles.pnlLive}>
                  {fmtMoney(p.unrealizedPnl)} ({p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent.toFixed(2)}%)
                </span>
                <button
                  className={styles.closeBtn}
                  onClick={() => handleClose(p.symbol)}
                  disabled={closing === p.symbol}
                >
                  {closing === p.symbol ? '…' : 'Close'}
                </button>
              </div>
            </div>

            {/* Progress bar: entry → mark → TP */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${progress}%`,
                  background: `linear-gradient(90deg, ${sideColor}99, ${sideColor})`,
                  borderRadius: 3, transition: 'width 0.6s',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                <span>Entry {fmtPrice(p.entryPrice)}</span>
                <span>Mark {fmtPrice(p.markPrice)}</span>
                <span>TP {fmtPrice(p.takeProfit)}</span>
              </div>
            </div>

            {/* Details grid */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
              <span>SL <strong style={{ color: 'var(--loss)' }}>{fmtPrice(p.stopLoss)}</strong></span>
              {p.trailingActive && <span>Trail SL <strong style={{ color: '#f5d020' }}>{fmtPrice(p.trailingStop)}</strong></span>}
              <span>Qty <strong style={{ color: 'var(--text)' }}>{p.qtyRemaining.toFixed(4)} / {p.qty.toFixed(4)}</strong></span>
              <span>Notional <strong style={{ color: 'var(--text)' }}>{fmtMoney(p.notional)}</strong></span>
              <span>Conf <strong style={{ color: 'var(--text)' }}>{p.confidence}%</strong></span>
              <span>Open {holdAgo}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
