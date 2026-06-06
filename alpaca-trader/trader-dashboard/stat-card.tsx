import styles from './trader-dashboard.module.css';

/**
 * Single KPI stat card.
 * @param label metric label
 * @param value formatted metric value
 * @param sub optional sub-label
 * @param tone "pos" | "neg" | "neutral" — colours the left accent bar
 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'pos' | 'neg' | 'neutral';
}) {
  const valueColor = tone === 'pos' ? '#16d39a' : tone === 'neg' ? '#ff5470' : 'var(--text)';
  return (
    <div className={`${styles.statCard} ${tone === 'pos' ? styles.pos : tone === 'neg' ? styles.neg : styles.neutral}`}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={{ color: valueColor }}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}
