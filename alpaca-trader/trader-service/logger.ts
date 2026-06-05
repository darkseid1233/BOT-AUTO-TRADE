/**
 * Lightweight in-memory ring-buffer logger.
 *
 * Keeps the last N log entries in memory so the dashboard can poll them via
 * the /logs endpoint. Also mirrors output to the console.
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogEntry = {
  ts: number;
  level: LogLevel;
  msg: string;
};

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];

function push(level: LogLevel, msg: string): void {
  const entry: LogEntry = { ts: Date.now(), level, msg };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  const line = `[${new Date(entry.ts).toISOString()}] ${level.toUpperCase()} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * Shared logger used across the bot. Each method records an entry into the
 * ring buffer and prints it to the console.
 */
export const log = {
  /** Log an informational message. */
  info: (msg: string) => push('info', msg),
  /** Log a warning message. */
  warn: (msg: string) => push('warn', msg),
  /** Log an error message. */
  error: (msg: string) => push('error', msg),
  /** Log a debug message. */
  debug: (msg: string) => push('debug', msg),
};

/**
 * Return recent log entries, newest last.
 * @param limit maximum number of entries to return
 * @returns array of log entries
 */
export function getRecentLogs(limit = 200): LogEntry[] {
  return buffer.slice(-limit);
}

/**
 * Return log entries newer than the given timestamp.
 * @param since unix-ms timestamp; only entries with ts > since are returned
 * @returns array of log entries
 */
export function getLogsSince(since: number): LogEntry[] {
  return buffer.filter((e) => e.ts > since);
}
