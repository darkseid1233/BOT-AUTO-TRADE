import type { Signal } from './types.js';
import styles from './trader-dashboard.module.css';

/**
 * Market Heatmap — colored tiles for each symbol showing side + quality + regime.
 * One glance shows: what's being traded, what's neutral, and why.
 * @param props.signals latest signals from the bot scan
 */
export function MarketHeatmap({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return <div className={styles.empty}>Waiting for first scan…</div>;
  }

  const sorted = [...signals].sort((a, b) => {
    // Active trades first, then by quality
    const aActive = a.side !== 'NEUTRAL' ? 1 : 0;
    const bActive = b.side !== 'NEUTRAL' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.confidence - a.confidence;
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: 10,
      padding: '14px 18px',
    }}>
      {sorted.map((s) => {
        const isLong = s.side === 'LONG';
        const isShort = s.side === 'SHORT';
        const isActive = isLong || isShort;

        const bg = isLong
          ? `rgba(22,211,154,${0.08 + (s.confidence / 100) * 0.12})`
          : isShort
          ? `rgba(255,84,112,${0.08 + (s.confidence / 100) * 0.12})`
          : 'rgba(113,119,149,0.05)';
        const border = isLong
          ? 'rgba(22,211,154,0.4)'
          : isShort
          ? 'rgba(255,84,112,0.4)'
          : 'rgba(35,40,68,0.6)';
        const sideColor = isLong ? '#16d39a' : isShort ? '#ff5470' : '#717795';

        const regime = s.marketRegime ?? 'RANGING';
        const adx = s.indicators?.adx ?? s.adx ?? 0;
        const rsi = s.indicators?.rsi ?? 50;
        const blocker = s.blocked?.[0] ?? '';
        const quality = s.confidence;

        return (
          <div
            key={s.symbol}
            style={{
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Glow for active trades */}
            {isActive && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 10,
                boxShadow: `inset 0 0 20px ${isLong ? 'rgba(22,211,154,0.08)' : 'rgba(255,84,112,0.08)'}`,
                pointerEvents: 'none',
              }} />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{s.symbol.replace('/USD', '')}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px',
                borderRadius: 4, background: sideColor + '25', color: sideColor,
                border: `1px solid ${sideColor}55`,
              }}>{s.side}</span>
            </div>

            {/* Quality bar */}
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${quality}%`,
                background: isLong ? '#16d39a' : isShort ? '#ff5470' : '#717795',
                borderRadius: 2, transition: 'width 0.4s',
              }} />
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#717795' }}>
                {regime.replace('_', ' ').replace('TRENDING ', '')}
              </span>
              {adx > 0 && (
                <span style={{ fontSize: 10, color: adx > 25 ? '#5b7fff' : '#717795' }}>
                  ADX {adx.toFixed(0)}
                </span>
              )}
              <span style={{
                fontSize: 10,
                color: rsi > 70 ? '#f5d020' : rsi < 30 ? '#ff5470' : '#717795',
              }}>
                RSI {rsi.toFixed(0)}
              </span>
            </div>

            {isActive ? (
              <div style={{ fontSize: 11, color: sideColor, fontWeight: 600 }}>
                Qual {quality}% · R:R {s.riskReward?.toFixed(1) ?? '—'}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#717795', lineHeight: 1.4 }}>
                {blocker.length > 40 ? blocker.slice(0, 38) + '…' : blocker || 'Neutral — no setup'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
