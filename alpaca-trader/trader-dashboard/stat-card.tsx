import styles from './trader-dashboard.module.css';

/**
 * Single KPI stat card.
 * @param props.label metric label
 * @param props.value formatted metric value
 * @param props.sub optional sub-label
 * @param props.tone "pos" | "neg" | "neutral" — colours the accent bar
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
  const cls =
    tone === 'pos' ? `${styles.statCard} ${styles.statCardPos}`
    : tone === 'neg' ? `${styles.statCard} ${styles.statCardNeg}`
    : styles.statCard;
  const valueCls = tone === 'pos' ? styles.pos : tone === 'neg' ? styles.neg : '';
  return (
    <div className={cls}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${valueCls}`}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}
