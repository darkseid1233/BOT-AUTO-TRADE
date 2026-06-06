import { useState } from 'react';
import type { OpenPosition } from './types.js';
import { fmtPrice, fmtMoney, fmtAgo } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Positions Table v2 — full live position panel.
 * Trailing stop progress bar, partial TP progress, PnL with live pulse, context badges.
 */
export function PositionsTable({
  positions,
  onClose,
}: {
  positions: OpenPosition[];
  onClose: (symbol: string) => void;
}) {
  const [closing, setClosing] = useState<Set<string>>(new Set());

  if (positions.length === 0) {
    return (
      <div className={styles.empty}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
        No open positions — bot is scanning for setups.
      </div>
    );
  }

  async function handleClose(sym: string) {
    setClosing((s) => new Set(s).add(sym));
    try { await onClose(sym); } finally {
      setClosing((s) => { const n = new Set(s); n.delete(sym); return n; });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {positions.map((pos) => {
        const isLong = pos.side === 'LONG';
        const pnlPositive = pos.unrealizedPnl >= 0;
        const pnlClass = pnlPositive ? styles.pnlPos : styles.pnlNeg;

        // SL progress: how far price has moved from initial SL toward entry (0=just entered, 1=at entry)
        const slRange = Math.abs(pos.entryPrice - pos.initialStopLoss);
        const slProgress = slRange > 0
          ? Math.min(1, Math.abs(pos.markPrice - pos.initialStopLoss) / slRange)
          : 0;
        const trailProgress = pos.trailingActive && pos.trailingStop > 0 && slRange > 0
          ? Math.min(1, Math.abs(pos.markPrice - pos.trailingStop) / slRange)
          : null;

        // TP progress
        const tpRange = Math.abs(pos.takeProfit - pos.entryPrice);
        const tpProgress = tpRange > 0
          ? Math.min(1, Math.abs(pos.markPrice - pos.entryPrice) / tpRange)
          : 0;

        return (
          <div key={pos.id} className={styles.posCard}>
            {/* Header row */}
            <div className={styles.posHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={styles.symbol}>{pos.symbol.replace('/USD', '')}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                  background: isLong ? 'rgba(22,211,154,0.15)' : 'rgba(255,84,112,0.15)',
                  color: isLong ? '#16d39a' : '#ff5470',
                  border: `1px solid ${isLong ? 'rgba(22,211,154,0.3)' : 'rgba(255,84,112,0.3)'}`,
                }}>{pos.side}</span>
                {pos.trailingActive && (
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(245,167,51,0.15)', color: '#ffa733',
                    border: '1px solid rgba(245,167,51,0.3)',
                  }}>⛵ TRAILING</span>
                )}
                {pos.l1Hit && !pos.l2Hit && (
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(91,127,255,0.15)', color: '#5b7fff',
                  }}>L1 TP ✓</span>
                )}
                {pos.l2Hit && (
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(22,211,154,0.15)', color: '#16d39a',
                  }}>L2 TP ✓</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className={`${pnlClass}`} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
                    {pnlPositive ? '+' : ''}{fmtMoney(pos.unrealizedPnl)}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {(pos.pnlPercent ?? 0) >= 0 ? '+' : ''}{(pos.pnlPercent ?? 0).toFixed(2)}%
                  </div>
                </div>
                <button
                  className={styles.closeBtn}
                  onClick={() => handleClose(pos.symbol)}
                  disabled={closing.has(pos.symbol)}
                >
                  {closing.has(pos.symbol) ? '…' : '✕ Close'}
                </button>
              </div>
            </div>

            {/* Metrics grid */}
            <div className={styles.posMetrics}>
              <div><span>Entry</span><strong>{fmtPrice(pos.entryPrice)}</strong></div>
              <div><span>Mark</span><strong>{fmtPrice(pos.markPrice)}</strong></div>
              <div><span>Qty</span><strong>{pos.qtyRemaining?.toFixed(6) ?? pos.qty?.toFixed(6)}</strong></div>
              <div><span>Notional</span><strong>{fmtMoney(pos.notional)}</strong></div>
              <div><span>Take Profit</span><strong className={styles.long}>{fmtPrice(pos.takeProfit)}</strong></div>
              <div>
                <span>{pos.trailingActive ? 'Trail Stop' : 'Stop Loss'}</span>
                <strong className={styles.short}>
                  {fmtPrice(pos.trailingActive && pos.trailingStop > 0 ? pos.trailingStop : pos.stopLoss)}
                </strong>
              </div>
              <div><span>ATR</span><strong>{pos.atrValue?.toFixed(4) ?? '—'}</strong></div>
              <div><span>Confidence</span><strong>{pos.confidence ?? '—'}%</strong></div>
              <div><span>Open</span><strong>{fmtAgo(pos.openedAt)}</strong></div>
            </div>

            {/* TP progress bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                <span>TP Progress ({(tpProgress * 100).toFixed(0)}%)</span>
                <span>{pos.l1Hit ? '✓ L1' : 'L1 —'} · {pos.l2Hit ? '✓ L2' : 'L2 —'}</span>
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${tpProgress * 100}%`,
                  background: tpProgress > 0.5 ? '#16d39a' : '#5b7fff',
                  borderRadius: 2, transition: 'width 0.4s ease',
                }} />
              </div>
            </div>

            {/* SL / trailing progress bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                <span>{pos.trailingActive ? 'Trailing SL buffer' : 'SL buffer'}</span>
                <span>{fmtPrice(pos.trailingActive && pos.trailingStop > 0 ? pos.trailingStop : pos.stopLoss)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(trailProgress ?? slProgress) * 100}%`,
                  background: pos.trailingActive ? '#ffa733' : '#ff5470',
                  borderRadius: 2, transition: 'width 0.4s ease',
                }} />
              </div>
            </div>

            {/* Context badges */}
            {pos.context && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
                {pos.context.marketRegime && (
                  <span style={{ padding: '2px 7px', borderRadius: 4, background: 'rgba(113,119,149,0.15)', color: 'var(--muted)' }}>
                    {pos.context.marketRegime}
                  </span>
                )}
                {pos.context.btcState && (
                  <span style={{ padding: '2px 7px', borderRadius: 4, background: 'rgba(91,127,255,0.1)', color: '#5b7fff' }}>
                    ₿ {pos.context.btcState}
                  </span>
                )}
                {pos.context.trend1h && (
                  <span style={{ padding: '2px 7px', borderRadius: 4, background: 'rgba(245,208,32,0.1)', color: '#f5d020' }}>
                    1H {pos.context.trend1h}
                  </span>
                )}
                {pos.context.entryReasons?.slice(0, 2).map((r, i) => (
                  <span key={i} style={{ padding: '2px 7px', borderRadius: 4, background: 'rgba(22,211,154,0.08)', color: 'var(--muted)' }}>
                    {r.length > 50 ? r.slice(0, 50) + '…' : r}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
