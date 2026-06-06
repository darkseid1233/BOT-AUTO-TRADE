/**
 * Scan Telemetry — counts WHY signals are rejected at each gate.
 *
 * The old bot logged "8 neutral" with no breakdown, so an operator staring at
 * 1700 scans with zero trades had no idea whether the strategy was too strict,
 * the data was missing, or a macro filter was permanently blocking. This module
 * accumulates a per-gate rejection histogram exposed via the API so the dashboard
 * can show exactly where signals die.
 */

/** The ordered gates a signal passes through in the v4 engine. */
export type GateName =
  | 'insufficientBars'
  | 'regime'
  | 'volume'
  | 'rsiLateEntry'
  | 'btcOpposing'
  | 'quality'
  | 'riskReward'
  | 'fearGreed'
  | 'slCooldown'
  | 'signalDedup'
  | 'riskCap'
  | 'opened';

export type GateStats = Record<GateName, number>;

const GATE_NAMES: GateName[] = [
  'insufficientBars', 'regime', 'volume', 'rsiLateEntry', 'btcOpposing',
  'quality', 'riskReward', 'fearGreed', 'slCooldown', 'signalDedup',
  'riskCap', 'opened',
];

function blank(): GateStats {
  return GATE_NAMES.reduce((acc, g) => { acc[g] = 0; return acc; }, {} as GateStats);
}

/** Cumulative totals since process start. */
const cumulative: GateStats = blank();
/** Stats for the most recent completed scan only. */
let lastScan: GateStats = blank();
/** Working accumulator for the in-progress scan. */
let current: GateStats = blank();

/** Record one gate outcome for the current scan. */
export function recordGate(gate: GateName): void {
  current[gate]++;
  cumulative[gate]++;
}

/** Call at the start of every scan to reset the per-scan accumulator. */
export function beginScan(): void {
  current = blank();
}

/** Call at the end of every scan to snapshot the per-scan accumulator. */
export function endScan(): void {
  lastScan = { ...current };
}

/** Snapshot of cumulative + last-scan gate histograms for the dashboard. */
export function getScanStats(): { cumulative: GateStats; lastScan: GateStats } {
  return { cumulative: { ...cumulative }, lastScan: { ...lastScan } };
}

/** Map a NEUTRAL signal's first `blocked` reason to a gate bucket (best-effort). */
export function gateFromReason(reason: string | undefined): GateName {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('insufficient')) return 'insufficientBars';
  if (r.includes('volume')) return 'volume';
  if (r.includes('rsi')) return 'rsiLateEntry';
  if (r.includes('opposing') || r.includes('btc')) return 'btcOpposing';
  if (r.includes('quality')) return 'quality';
  if (r.includes('r:r') || r.includes('atr')) return 'riskReward';
  return 'regime';
}
