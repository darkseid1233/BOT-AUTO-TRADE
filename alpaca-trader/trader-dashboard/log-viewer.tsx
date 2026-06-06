import { useState } from 'react';
import type { LogEntry } from './types.js';
import styles from './trader-dashboard.module.css';

const LEVEL_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Live log viewer v2 — filterable by level, searchable, auto-scroll latest.
 */
export function LogViewer({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');

  if (logs.length === 0) {
    return <div className={styles.empty}>No logs yet — bot will stream here.</div>;
  }

  const visible = logs.filter((l) => {
    const levelOk = filter === 'all' || l.level === filter || (filter === 'info' && LEVEL_ORDER[l.level] <= 2);
    const searchOk = !search || l.msg.toLowerCase().includes(search.toLowerCase());
    return levelOk && searchOk;
  });

  const levelClass: Record<LogEntry['level'], string> = {
    info: styles.logInfo,
    warn: styles.logWarn,
    error: styles.logError,
    debug: styles.logDebug,
  };

  const levelBadge: Record<string, string> = { error: '🔴', warn: '🟡', info: '⚪', debug: '⬛' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
          <button key={lvl} onClick={() => setFilter(lvl)} style={{
            padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
            background: filter === lvl ? 'var(--accent2)' : 'var(--surface2)',
            color: filter === lvl ? '#fff' : 'var(--muted)', fontSize: 12, fontWeight: 600,
          }}>
            {lvl.toUpperCase()}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 160, padding: '5px 10px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: 'var(--text)', fontSize: 12, outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{visible.length}/{logs.length}</span>
      </div>

      {/* Log list */}
      <div className={styles.logList}>
        {visible.map((l, i) => (
          <div key={i} className={`${styles.logEntry} ${levelClass[l.level] ?? styles.logInfo}`}>
            <span className={styles.logTs}>{new Date(l.ts).toLocaleTimeString('en-GB')}</span>
            <span style={{ fontSize: 10, flexShrink: 0 }}>{levelBadge[l.level] ?? '⚪'}</span>
            <span className={styles.logMsg}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
