import { useState } from 'react';
import type { Signal } from './types.js';
import { fmtPrice } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Market Heatmap v2 — extended with new indicator badges.
 * Supertrend, VWAP, Divergence, Candle Pattern all visible at a glance.
 * Click a tile to see full detail overlay.
 */
export function MarketHeatmap({ signals }: { signals: Signal[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (signals.length === 0) {
    return <div className={styles.empty}>Waiting for first scan…</div>;
  }

  const tileColor = (side: string, conf: number) => {
    if (side === 'LONG') {
      if (conf >= 80) return { bg: 'rgba(22,211,154,0.25)', border: 'rgba(22,211,154,0.6)', glow: '0 0 18px rgba(22,211,154,0.3)' };
      return { bg: 'rgba(22,211,154,0.12)', border: 'rgba(22,211,154,0.3)', glow: 'none' };
    }
    if (side === 'SHORT') {
      if (conf >= 80) return { bg: 'rgba(255,84,112,0.25)', border: 'rgba(255,84,112,0.6)', glow: '0 0 18px rgba(255,84,112,0.3)' };
      return { bg: 'rgba(255,84,112,0.12)', border: 'rgba(255,84,112,0.3)', glow: 'none' };
    }
    return { bg: 'rgba(35,40,68,0.5)', border: 'rgba(35,40,68,1)', glow: 'none' };
  };

  const sel = selected ? signals.find((s) => s.symbol === selected) : null;

  return (
    <div>
      <div className={styles.heatmap}>
        {signals.map((s) => {
          const active = s.side !== 'NEUTRAL';
          const col = tileColor(s.side, s.confidence);
          const stDir = s.indicators?.supertrendDir;
          const vwapDist = s.indicators?.vwapDistPct;
          const divType = s.indicators?.divergence;
          const pattern = s.indicators?.candlePattern;
          const isSelected = selected === s.symbol;

          return (
            <div
              key={s.symbol}
              onClick={() => setSelected(isSelected ? null : s.symbol)}
              style={{
                background: col.bg,
                border: `1px solid ${col.border}`,
                boxShadow: isSelected ? `0 0 0 2px var(--accent2), ${col.glow}` : col.glow,
                borderRadius: 12,
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                userSelect: 'none',
                position: 'relative',
              }}
            >
              {/* Symbol + price */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: -0.3 }}>
                    {s.symbol.replace('/USD', '')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                    ${fmtPrice(s.price ?? s.entry)}
                  </div>
                </div>
                {active && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                      background: s.side === 'LONG' ? 'rgba(22,211,154,0.3)' : 'rgba(255,84,112,0.3)',
                      color: s.side === 'LONG' ? '#16d39a' : '#ff5470',
                    }}>{s.side}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Q{s.confidence}</div>
                  </div>
                )}
                {!active && (
                  <span style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.6, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
                    WAIT
                  </span>
                )}
              </div>

              {/* Confidence bar */}
              {active && (
                <div style={{ height: 3, background: 'rgba(0,0,0,0.3)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${s.confidence}%`,
                    background: s.side === 'LONG' ? '#16d39a' : '#ff5470',
                    borderRadius: 2,
                  }} />
                </div>
              )}

              {/* Key stats row */}
              <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                {s.indicators?.adx !== undefined && (
                  <span style={{ color: (s.indicators.adx) > 25 ? '#5b7fff' : 'var(--muted)' }}>
                    ADX {s.indicators.adx.toFixed(0)}
                  </span>
                )}
                {s.indicators?.rsi !== undefined && (
                  <span style={{ color: s.indicators.rsi > 70 ? '#f5d020' : s.indicators.rsi < 30 ? '#ff5470' : 'var(--muted)' }}>
                    RSI {s.indicators.rsi.toFixed(0)}
                  </span>
                )}
                {s.indicators?.volRatio !== undefined && (
                  <span style={{ color: s.indicators.volRatio >= 1 ? '#16d39a' : 'var(--muted)' }}>
                    {s.indicators.volRatio.toFixed(1)}x
                  </span>
                )}
              </div>

              {/* New indicator badges */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {stDir && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                    background: stDir === 'up' ? 'rgba(22,211,154,0.2)' : 'rgba(255,84,112,0.2)',
                    color: stDir === 'up' ? '#16d39a' : '#ff5470',
                  }}>ST{stDir === 'up' ? '↑' : '↓'}</span>
                )}
                {vwapDist !== undefined && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(245,208,32,0.12)', color: '#f5d020',
                  }}>V{vwapDist >= 0 ? '+' : ''}{vwapDist.toFixed(1)}%</span>
                )}
                {divType && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                    background: divType.includes('bullish') ? 'rgba(22,211,154,0.25)' : 'rgba(255,84,112,0.25)',
                    color: divType.includes('bullish') ? '#16d39a' : '#ff5470',
                  }}>DIV</span>
                )}
                {pattern && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(91,127,255,0.15)', color: '#5b7fff',
                  }}>🕯</span>
                )}
                {s.marketRegime && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(113,119,149,0.15)', color: 'var(--muted)',
                  }}>{s.marketRegime.replace('TRENDING_', 'T-').replace('RANGING', 'RANG')}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail overlay for selected tile */}
      {sel && (
        <div style={{
          marginTop: 14, padding: '16px 18px', background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: 12,
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
            <strong style={{ fontSize: 16 }}>{sel.symbol} — Signal Detail</strong>
            <button onClick={() => setSelected(null)} style={{
              background: 'none', border: '1px solid var(--border)', color: 'var(--muted)',
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
            }}>✕ Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px 16px', fontSize: 12 }}>
            {[
              ['Side', sel.side], ['Confidence', sel.confidence + '%'],
              ['Price', '$' + fmtPrice(sel.price ?? sel.entry)],
              ['Entry', '$' + fmtPrice(sel.entry)],
              ['Stop Loss', '$' + fmtPrice(sel.stopLoss)],
              ['Take Profit', '$' + fmtPrice(sel.takeProfit)],
              ['R:R', sel.riskReward?.toFixed(2) ?? '—'],
              ['Regime', sel.marketRegime ?? '—'],
              ['BTC State', sel.btcState ?? '—'],
              ['1H Trend', sel.trend1h ?? '—'],
              ['CHOP', sel.chopValue?.toFixed(1) ?? sel.chopIndex?.toFixed(1) ?? '—'],
              ['SMC 🟢/🔴', `${sel.smcBull ?? 0}/${sel.smcBear ?? 0}`],
              ...(sel.indicators ? [
                ['RSI', sel.indicators.rsi?.toFixed(0) ?? '—'],
                ['ADX', sel.indicators.adx?.toFixed(1) ?? '—'],
                ['Vol Ratio', sel.indicators.volRatio?.toFixed(2) + 'x' ?? '—'],
                ['StochRSI', sel.indicators.stochRsi?.toFixed(0) ?? '—'],
                ['BB %', sel.indicators.bollingerPct !== undefined ? (sel.indicators.bollingerPct * 100).toFixed(0) + '%' : '—'],
                ['MACD Hist', sel.indicators.macdHistogram?.toFixed(5) ?? '—'],
                ['Supertrend', sel.indicators.supertrend ? '$' + fmtPrice(sel.indicators.supertrend) : '—'],
                ['ST Dir', sel.indicators.supertrendDir ?? '—'],
                ['VWAP', sel.indicators.vwap ? '$' + fmtPrice(sel.indicators.vwap) : '—'],
                ['VWAP Dist', sel.indicators.vwapDistPct !== undefined ? sel.indicators.vwapDistPct.toFixed(2) + '%' : '—'],
                ['Divergence', sel.indicators.divergence ?? 'none'],
                ['Pattern', sel.indicators.candlePattern ?? 'none'],
              ] : []),
            ].map(([label, val]) => (
              <div key={label as string}>
                <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
                <div style={{ fontWeight: 600, marginTop: 1 }}>{val}</div>
              </div>
            ))}
          </div>

          {(sel.reasons.length > 0 || sel.blocked.length > 0) && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {sel.side !== 'NEUTRAL' ? 'Entry Reasons' : 'Blocked By'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.7 }}>
                {[...sel.reasons, ...sel.blocked].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
