import type { LogEntry } from './types.js';
import styles from './trader-dashboard.module.css';

/**
 * Live log viewer — renders the bot's recent log entries, newest first.
 * @param props.logs log entries to display
 */
export function LogViewer({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) {
    return <div className={styles.empty}>No logs yet.</div>;
  }
  const levelClass: Record<LogEntry['level'], string> = {
    info: styles.logInfo,
    warn: styles.logWarn,
    error: styles.logError,
    debug: styles.logDebug,
  };
  return (
    <div className={styles.logViewer}>
      {logs.map((l, i) => (
        <div key={`${l.ts}-${i}`} className={styles.logLine}>
          <span className={styles.logTs}>{new Date(l.ts).toLocaleTimeString('en-GB')}</span>
          <span className={levelClass[l.level]}>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
