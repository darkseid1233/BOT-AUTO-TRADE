import type { Signal } from './types.js';
import { fmtPrice } from './format.js';
import styles from './trader-dashboard.module.css';

/**
 * Grid of live trading signals, active (LONG/SHORT) first.
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
        const detail = [...s.reasons, ...s.blocked].slice(0, 2);
        const sideClass =
          s.side === 'LONG' ? styles.sideLong : s.side === 'SHORT' ? styles.sideShort : styles.sideNeutral;
        return (
          <div key={s.symbol} className={`${styles.signalCard} ${active ? styles.signalActive : ''}`}>
            <div className={styles.signalTop}>
              <span className={styles.symbol}>{s.symbol}</span>
              <span className={`${styles.signalSide} ${sideClass}`}>{s.side}</span>
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
            <div className={styles.signalReasons}>
              {detail.length > 0 ? detail.join(' · ') : 'No setup details.'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
