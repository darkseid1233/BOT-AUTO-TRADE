/**
 * Formatting helpers shared across dashboard views — v2.
 */

/** Format unix-ms timestamp as HH:MM:SS local time. */
export function fmtTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-GB');
}

/** Format unix-ms as date + time. */
export function fmtDateTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB');
}

/**
 * Format a price with adaptive precision.
 * - BTC-range (>1000): 2 dp
 * - Mid (1–1000): 4 dp
 * - Micro (<1): 6 dp
 */
export function fmtPrice(value: number | undefined | null, forceDecimals?: number): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  if (forceDecimals !== undefined) return value.toFixed(forceDecimals);
  if (Math.abs(value) >= 10000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  if (Math.abs(value) >= 0.01) return value.toFixed(6);
  return value.toFixed(8);
}

/**
 * Format dollar amount with sign and 2 dp.
 * @param value amount in USD
 */
export function fmtMoney(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '$—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Format duration as "Xh Ym" or "Xm" from a unix-ms timestamp.
 * @param ms timestamp in ms of the START time
 */
export function fmtAgo(ms: number): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m ago`;
}

/**
 * Format a percentage with a sign and 2 dp.
 */
export function fmtPct(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Format a quantity (crypto) with up to 6 dp, trimming trailing zeros.
 */
export function fmtQty(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return parseFloat(value.toFixed(6)).toString();
}
