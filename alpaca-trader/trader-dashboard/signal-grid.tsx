import type { Signal } from './types.js';
import { fmtPrice } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Grid of live trading signals — v2 with regime, CHOP, ADX, SMC badges.
 * Active signals (LONG/SHORT) shown first, sorted by confidence.
 * @param props.signals latest signals from the bot
 */
export function SignalGrid({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return <div className={styles.empty}>No signals yet — waiting for the next scan.</div>;
  }
  const sorted = [...signals].sort((a, b) => {
    const act = Number(b.side !== 'NEUTRAL') - Number(a.side !== 'NEUTRAL');
    if (act !== 0) return act;
    return b.confidence - a.confidence;
  });

  return (
    <div className={styles.signalGrid}>
      {sorted.map((s) => {
        const active = s.side !== 'NEUTRAL';
        const detail = [...s.reasons, ...s.blocked].slice(0, 3);
        const sideClass =
          s.side === 'LONG' ? styles.sideLong : s.side === 'SHORT' ? styles.sideShort : styles.sideNeutral;

        const regimeColor: Record<string, string> = {
          TRENDING_BULL: '#2ecc71', TRENDING_BEAR: '#e74c3c',
          RANGING: '#f1c40f', HIGH_VOL: '#e67e22',
        };
        const regime = s.marketRegime ?? 'RANGING';

        return (
          <div key={s.symbol} className={`${styles.signalCard} ${active ? styles.signalActive : ''}`}>
            <div className={styles.signalTop}>
              <span className={styles.symbol}>{s.symbol}</span>
              <span className={`${styles.signalSide} ${sideClass}`}>{s.side}</span>
            </div>

            {/* Regime + extra badges */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span style={{
                fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                background: regimeColor[regime] ?? '#555', color: '#fff', fontWeight: 600,
              }}>{regime.replace('_', ' ')}</span>
              {s.chopValue !== undefined && (
                <span style={{
                  fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                  background: s.chopValue > 61.8 ? '#e74c3c' : s.chopValue < 38.2 ? '#2ecc71' : '#555',
                  color: '#fff',
                }}>CHOP {s.chopValue.toFixed(0)}</span>
              )}
              {s.indicators.adx !== undefined && (
                <span style={{
                  fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                  background: (s.indicators.adx ?? 0) > 25 ? '#3498db' : '#555', color: '#fff',
                }}>ADX {(s.indicators.adx ?? 0).toFixed(0)}</span>
              )}
              {s.trend1h && s.trend1h !== 'pending' && (
                <span style={{
                  fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                  background: s.trend1h === 'bullish' ? '#2ecc71' : s.trend1h === 'bearish' ? '#e74c3c' : '#555',
                  color: '#fff',
                }}>1H {s.trend1h.toUpperCase()}</span>
              )}
              {s.fearGreed !== undefined && (
                <span style={{
                  fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                  background: s.fearGreed < 25 ? '#e74c3c' : s.fearGreed > 75 ? '#f1c40f' : '#555',
                  color: s.fearGreed > 75 ? '#000' : '#fff',
                }}>F&G {s.fearGreed}</span>
              )}
            </div>

            <div className={styles.confBar}>
              <div className={styles.confFill} style={{ width: `${s.confidence}%` }} />
            </div>

            <div className={styles.signalMetrics}>
              <span>Conf <strong>{s.confidence}</strong></span>
              <span>R:R <strong>{Number.isFinite(s.riskReward) ? s.riskReward.toFixed(2) : '—'}</strong></span>
              <span>Entry <strong>{fmtPrice(s.entry || s.price)}</strong></span>
              <span>RSI <strong>{s.indicators.rsi.toFixed(0)}</strong></span>
              <span>SL <strong className={styles.short}>{fmtPrice(s.stopLoss)}</strong></span>
              <span>TP <strong className={styles.long}>{fmtPrice(s.takeProfit)}</strong></span>
            </div>

            {/* SMC scores if available */}
            {(s.smcBull !== undefined || s.smcBear !== undefined) && (
              <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>
                SMC 🟢{s.smcBull ?? 0} 🔴{s.smcBear ?? 0}
                {s.indicators.stochRsi !== undefined && ` · StRSI ${(s.indicators.stochRsi ?? 0).toFixed(0)}`}
                {s.indicators.volRatio !== undefined && ` · Vol×${(s.indicators.volRatio ?? 1).toFixed(1)}`}
              </div>
            )}

            <div className={styles.signalReasons}>
              {detail.length > 0 ? detail.join(' · ') : 'Waiting for setup confirmation…'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
