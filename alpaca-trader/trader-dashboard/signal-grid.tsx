import { useState } from 'react';
import type { Signal } from './types.js';
import { fmtPrice } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Signal Grid v3 — fully synced with bot API.
 * Shows new indicators: Supertrend direction, VWAP distance, divergence badge, candle pattern.
 * Active signals first, sorted by confidence. Click to expand full detail.
 */
export function SignalGrid({ signals }: { signals: Signal[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (signals.length === 0) {
    return <div className={styles.empty}>No signals yet — waiting for the next scan.</div>;
  }

  const sorted = [...signals].sort((a, b) => {
    const act = Number(b.side !== 'NEUTRAL') - Number(a.side !== 'NEUTRAL');
    if (act !== 0) return act;
    return b.confidence - a.confidence;
  });

  const regimeColor: Record<string, string> = {
    TRENDING_BULL: '#2ecc71', TRENDING_BEAR: '#e74c3c',
    RANGING: '#f1c40f', HIGH_VOL: '#e67e22',
  };

  return (
    <div className={styles.signalGrid}>
      {sorted.map((s) => {
        const active = s.side !== 'NEUTRAL';
        const isExp = expanded === s.symbol;
        const sideClass = s.side === 'LONG' ? styles.sideLong : s.side === 'SHORT' ? styles.sideShort : styles.sideNeutral;
        const regime = s.marketRegime ?? 'RANGING';
        const chop = s.chopIndex ?? (s as any).chopValue ?? undefined;
        const adx = s.indicators?.adx ?? s.adx;
        const rsi = s.indicators?.rsi;
        const vol = s.indicators?.volRatio;
        const stDir = s.indicators?.supertrendDir;
        const vwapDist = s.indicators?.vwapDistPct;
        const divType = s.indicators?.divergence;
        const pattern = s.indicators?.candlePattern;
        const stochRsi = s.indicators?.stochRsi;
        const macdH = s.indicators?.macdHistogram;
        const bbPct = s.indicators?.bollingerPct;
        const detail = [...s.reasons, ...s.blocked].filter(Boolean).slice(0, 4);

        return (
          <div
            key={s.symbol}
            className={`${styles.signalCard} ${active ? styles.signalActive : ''}`}
            onClick={() => setExpanded(isExp ? null : s.symbol)}
            style={{ cursor: 'pointer' }}
          >
            {/* ── Row 1: Symbol + side badge */}
            <div className={styles.signalTop}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={styles.symbol}>{s.symbol.replace('/USD', '')}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>${fmtPrice(s.price ?? s.entry)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {active && (
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>
                    Q{s.confidence}
                  </span>
                )}
                <span className={`${styles.signalSide} ${sideClass}`}>{s.side}</span>
              </div>
            </div>

            {/* ── Quality bar */}
            <div className={styles.confBar}>
              <div
                className={styles.confFill}
                style={{
                  width: `${s.confidence}%`,
                  background: s.confidence >= 80 ? 'linear-gradient(90deg, #16d39a, #0fae7e)'
                    : s.confidence >= 65 ? 'linear-gradient(90deg, #5b7fff, #3a5ad9)'
                    : 'linear-gradient(90deg, #717795, #505570)',
                }}
              />
            </div>

            {/* ── Row 2: regime + key badges */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                background: regimeColor[regime] ? regimeColor[regime] + '30' : '#333',
                color: regimeColor[regime] ?? '#aaa',
                border: `1px solid ${regimeColor[regime] ?? '#555'}55`,
              }}>{regime.replace('_', ' ')}</span>

              {adx !== undefined && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                  background: adx > 25 ? 'rgba(91,127,255,0.15)' : 'rgba(113,119,149,0.1)',
                  color: adx > 25 ? '#5b7fff' : '#717795', border: '1px solid rgba(91,127,255,0.2)',
                }}>ADX {adx.toFixed(0)}</span>
              )}

              {chop !== undefined && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                  background: chop > 61.8 ? 'rgba(255,84,112,0.15)' : chop < 38.2 ? 'rgba(22,211,154,0.15)' : 'rgba(113,119,149,0.1)',
                  color: chop > 61.8 ? '#ff5470' : chop < 38.2 ? '#16d39a' : '#717795',
                }}>CHOP {chop.toFixed(0)}</span>
              )}

              {s.trend1h && s.trend1h !== 'pending' && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                  background: s.trend1h === 'bullish' ? 'rgba(22,211,154,0.15)' : s.trend1h === 'bearish' ? 'rgba(255,84,112,0.15)' : 'rgba(113,119,149,0.1)',
                  color: s.trend1h === 'bullish' ? '#16d39a' : s.trend1h === 'bearish' ? '#ff5470' : '#717795',
                }}>1H {s.trend1h.toUpperCase()}</span>
              )}

              {/* Supertrend badge */}
              {stDir && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  background: stDir === 'up' ? 'rgba(22,211,154,0.15)' : 'rgba(255,84,112,0.15)',
                  color: stDir === 'up' ? '#16d39a' : '#ff5470',
                  border: `1px solid ${stDir === 'up' ? 'rgba(22,211,154,0.3)' : 'rgba(255,84,112,0.3)'}`,
                }}>ST {stDir === 'up' ? '↑' : '↓'}</span>
              )}

              {/* VWAP badge */}
              {vwapDist !== undefined && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(245,208,32,0.1)', color: '#f5d020',
                }}>VWAP {vwapDist >= 0 ? '+' : ''}{vwapDist.toFixed(1)}%</span>
              )}

              {/* Divergence badge */}
              {divType && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  background: divType.includes('bullish') ? 'rgba(22,211,154,0.2)' : 'rgba(255,84,112,0.2)',
                  color: divType.includes('bullish') ? '#16d39a' : '#ff5470',
                  border: `1px solid ${divType.includes('bullish') ? 'rgba(22,211,154,0.4)' : 'rgba(255,84,112,0.4)'}`,
                }}>DIV {divType.replace('_', ' ').replace('regular ', '').replace('hidden ', 'H-').toUpperCase()}</span>
              )}

              {/* Candle pattern badge */}
              {pattern && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(91,127,255,0.15)', color: '#5b7fff',
                }}>🕯 {pattern}</span>
              )}

              {s.btcState && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: s.btcState === 'bullish' ? 'rgba(22,211,154,0.12)' : s.btcState === 'bearish' ? 'rgba(255,84,112,0.12)' : 'rgba(113,119,149,0.1)',
                  color: s.btcState === 'bullish' ? '#16d39a' : s.btcState === 'bearish' ? '#ff5470' : '#717795',
                }}>₿ {s.btcState.toUpperCase()}</span>
              )}
            </div>

            {/* ── Row 3: key metrics */}
            {active && (
              <div className={styles.signalMetrics}>
                <span>Entry <strong>{fmtPrice(s.entry)}</strong></span>
                <span>SL <strong className={styles.short}>{fmtPrice(s.stopLoss)}</strong></span>
                <span>TP <strong className={styles.long}>{fmtPrice(s.takeProfit)}</strong></span>
                <span>R:R <strong>{s.riskReward?.toFixed(2) ?? '—'}</strong></span>
                {rsi !== undefined && <span>RSI <strong style={{ color: rsi > 70 ? '#f5d020' : rsi < 30 ? '#ff5470' : 'var(--text)' }}>{rsi.toFixed(0)}</strong></span>}
                {vol !== undefined && <span>Vol <strong>{vol.toFixed(1)}x</strong></span>}
              </div>
            )}

            {/* ── SMC row */}
            {(s.smcBull !== undefined || s.smcBear !== undefined) && (
              <div style={{ fontSize: 10, color: '#aaa', display: 'flex', gap: 10 }}>
                <span>SMC 🟢{s.smcBull ?? 0} 🔴{s.smcBear ?? 0}</span>
                {stochRsi !== undefined && <span>StRSI {stochRsi.toFixed(0)}</span>}
                {macdH !== undefined && <span>MACD {macdH >= 0 ? '▲' : '▼'}{Math.abs(macdH).toFixed(4)}</span>}
                {bbPct !== undefined && <span>BB {(bbPct * 100).toFixed(0)}%</span>}
              </div>
            )}

            {/* ── Reasons / blockers */}
            <div className={styles.signalReasons}>
              {detail.length > 0 ? detail.join(' · ') : 'Scanning for setup…'}
            </div>

            {/* ── Expanded detail panel */}
            {isExp && (
              <div style={{
                marginTop: 8, padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
                borderRadius: 8, border: '1px solid var(--border)', fontSize: 11,
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px',
              }}>
                {s.indicators && Object.entries(s.indicators).map(([k, v]) =>
                  v === undefined || v === null ? null : (
                    <span key={k} style={{ color: 'var(--muted)' }}>
                      <strong style={{ color: 'var(--text)' }}>{k}:</strong>{' '}
                      {typeof v === 'number' ? v.toFixed(4) : String(v)}
                    </span>
                  )
                )}
                {s.qualityFactors && Object.entries(s.qualityFactors).map(([k, v]) => (
                  <span key={k} style={{ color: 'var(--muted)' }}>
                    <strong style={{ color: '#f5d020' }}>{k}:</strong> {(v as number).toFixed(2)}
                  </span>
                ))}
                <span style={{ color: 'var(--muted)', gridColumn: '1/-1', marginTop: 4 }}>
                  Updated {new Date(s.timestamp).toLocaleTimeString('en-GB')}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
