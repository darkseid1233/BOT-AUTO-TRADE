/**
 * Small formatting helpers shared across dashboard views.
 */

/**
 * Format a unix-ms timestamp as a local time string.
 * @param ms timestamp in milliseconds
 * @returns HH:MM:SS string
 */
export function fmtTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-GB');
}

/**
 * Format a price with adaptive precision.
 * @param value the numeric price
 * @returns formatted price string
 */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1) return value.toFixed(4);
  if (value < 100) return value.toFixed(3);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a USD money value with a sign.
 * @param value amount
 * @returns formatted string like "+1,234.56"
 */
export function fmtMoney(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a relative "time ago" from a duration in ms.
 * @param ms duration in milliseconds
 * @returns human-friendly string
 */
export function fmtAgo(ms: number): string {
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}
