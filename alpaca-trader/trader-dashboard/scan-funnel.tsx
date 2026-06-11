import { useState } from 'react';
import type { ScanStats, GateStats } from './types.js';
import styles from './scan-funnel.module.css';

/** Human-readable label for each gate. */
const GATE_LABELS: Record<keyof GateStats, string> = {
  insufficientBars: 'Insufficient bars',
  regime: 'Regime / ranging',
  volume: 'Low volume',
  rsiLateEntry: 'RSI late entry',
  btcOpposing: 'BTC opposing',
  quality: 'Low quality score',
  riskReward: 'Poor R:R',
  fearGreed: 'Fear & Greed block',
  slCooldown: 'SL cooldown',
  signalDedup: 'Dedup (anti-revenge)',
  dataQuality: 'Synthetic data block',
  riskCap: 'Risk cap',
  opened: 'Opened ✅',
};

const ORDER: (keyof GateStats)[] = [
  'opened', 'insufficientBars', 'regime', 'volume', 'rsiLateEntry', 'btcOpposing',
  'quality', 'riskReward', 'fearGreed', 'slCooldown', 'signalDedup', 'dataQuality', 'riskCap',
];

/**
 * Plain-language diagnosis of why the bot is (or isn't) trading, based on the
 * dominant rejection gate. This is what turns raw counts into something an
 * operator can act on.
 * @param g the gate histogram to analyse
 */
function diagnose(g: GateStats): string {
  const total = ORDER.reduce((sum, k) => sum + (g[k] || 0), 0);
  if (total === 0) return 'No scans recorded yet — waiting for the first scan cycle.';
  if (g.opened > 0) return `Bot is trading: ${g.opened} position(s) opened. Healthy signal flow.`;

  const rejects = ORDER.filter((k) => k !== 'opened');
  const top = rejects.reduce((a, b) => (g[b] > g[a] ? b : a), rejects[0]);
  const pct = Math.round((g[top] / total) * 100);

  const tips: Partial<Record<keyof GateStats, string>> = {
    insufficientBars: 'symbols are not returning enough history — check Alpaca credentials / data feed.',
    regime: 'markets are ranging (ADX below threshold). Lower ADX_TREND_THRESHOLD or wait for a trend.',
    fearGreed: 'Fear & Greed is blocking one side. Relax FG_EXTREME_FEAR / FG_EXTREME_GREED to loosen.',
    quality: 'signals are forming but scoring below MIN_SIGNAL_QUALITY. Lower it to trade more.',
    btcOpposing: 'BTC macro is blocking trades against its trend. Expected in strong BTC moves.',
    volume: 'relative volume is too low. Lower MIN_VOLUME_RATIO if too strict.',
    riskReward: 'ATR-based R:R is below MIN_RR_NET. Volatility is low.',
  };
  return `Most signals (${pct}%) die at "${GATE_LABELS[top]}" — ${tips[top] ?? 'review this gate.'}`;
}

/**
 * Scan Funnel — a horizontal bar chart of per-gate rejection counts so the
 * operator can instantly see whether the bot is idle because of data, regime,
 * macro filters, or risk caps. Toggles between cumulative and last-scan views.
 * @param props.scanStats the cumulative + last-scan gate histograms
 */
export function ScanFunnel({ scanStats }: { scanStats: ScanStats | null }) {
  const [view, setView] = useState<'cumulative' | 'lastScan'>('cumulative');

  if (!scanStats) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>🛰️</span>
        <span>Scan telemetry not available yet.</span>
      </div>
    );
  }

  const g = scanStats[view];
  const max = Math.max(1, ...ORDER.map((k) => g[k] || 0));

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>🔬 Signal Funnel</div>
          <div className={styles.subtitle}>Where each scan's signals are accepted or rejected</div>
        </div>
        <div className={styles.toggle}>
          <button
            className={`${styles.toggleBtn} ${view === 'cumulative' ? styles.toggleActive : ''}`}
            onClick={() => setView('cumulative')}
          >All time</button>
          <button
            className={`${styles.toggleBtn} ${view === 'lastScan' ? styles.toggleActive : ''}`}
            onClick={() => setView('lastScan')}
          >Last scan</button>
        </div>
      </div>

      <div className={styles.bars}>
        {ORDER.map((k) => {
          const val = g[k] || 0;
          const width = `${(val / max) * 100}%`;
          const isOpened = k === 'opened';
          const isTopBlocker = !isOpened && val === max && val > 0;
          return (
            <div key={k} className={`${styles.row} ${isOpened ? styles.openedRow : ''}`}>
              <span className={styles.label}>{GATE_LABELS[k]}</span>
              <div className={styles.barWrap}>
                <div
                  className={`${styles.bar} ${isOpened ? styles.opened : isTopBlocker ? styles.blocker : styles.reject}`}
                  style={{ width }}
                />
              </div>
              <span className={styles.count}>{val}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.diagnosis}>
        <strong>Diagnosis:</strong> {diagnose(g)}
      </div>
    </div>
  );
}
