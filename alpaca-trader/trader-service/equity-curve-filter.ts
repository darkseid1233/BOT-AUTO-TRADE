/**
 * Equity Curve Filter — meta-strategy used by top quant funds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONCEPT
 * ─────────────────────────────────────────────────────────────────────────────
 * The equity curve IS a price series. When the bot is performing well, the
 * equity curve trends up. When the strategy is out of sync with the market
 * (wrong regime, parameter drift, structural market change), the equity curve
 * trends DOWN — often BEFORE the circuit breaker fires.
 *
 * Applying a simple MA crossover to the equity curve lets the bot:
 *   - Trade at FULL SIZE when the equity curve is ABOVE its own MA (performing)
 *   - Trade at REDUCED SIZE when below MA (underperforming — reduce exposure)
 *   - Stop trading entirely when far BELOW MA (strategy has broken down)
 *
 * This is used by Winton, Man AHL, and several Freqtrade strategies ("equity
 * curve exit"). It is NOT a stop-loss — it does not close open positions. It
 * only gates NEW entries.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARAMETERS (all env-overridable)
 * ─────────────────────────────────────────────────────────────────────────────
 * EQUITY_CURVE_PERIOD=20   — MA lookback (in trades / equity points)
 * EQUITY_CURVE_REDUCE=0.5  — size multiplier when equity is below MA
 * EQUITY_CURVE_STOP=-0.05  — % below MA that completely stops new entries (−5%)
 * EQUITY_CURVE_ENABLED=true
 */

import { log } from './logger.js';

const PERIOD = Number(process.env.EQUITY_CURVE_PERIOD ?? '20');
const REDUCE_MULT = Number(process.env.EQUITY_CURVE_REDUCE ?? '0.5');
const STOP_THRESHOLD = Number(process.env.EQUITY_CURVE_STOP ?? '-0.05'); // −5%
const ENABLED = process.env.EQUITY_CURVE_ENABLED !== 'false';

/**
 * Equity curve filter result.
 */
export type EcfResult = {
  allowed: boolean;
  /** Sizing multiplier — 1.0 when above MA, REDUCE_MULT when below, 0 when halted. */
  mult: number;
  reason: string;
};

/**
 * Evaluate the equity curve filter for a new entry.
 *
 * @param equityCurve ordered array of balance snapshots (oldest first)
 * @returns EcfResult with allowed flag and sizing multiplier
 */
export function equityCurveFilter(
  equityCurve: { ts: number; balance: number }[],
): EcfResult {
  if (!ENABLED) return { allowed: true, mult: 1.0, reason: 'ECF disabled' };
  if (equityCurve.length < PERIOD + 1) {
    return { allowed: true, mult: 1.0, reason: `ECF: insufficient history (${equityCurve.length}/${PERIOD})` };
  }

  const recent = equityCurve.slice(-PERIOD);
  const ma = recent.reduce((s, p) => s + p.balance, 0) / recent.length;
  const current = equityCurve[equityCurve.length - 1].balance;
  const deviation = (current - ma) / ma; // negative = below MA

  if (deviation <= STOP_THRESHOLD) {
    log.warn(
      `[ecf] equity ${deviation > -1 ? (deviation * 100).toFixed(1) : '??'}% below ${PERIOD}-trade MA ` +
      `(current $${current.toFixed(0)} vs MA $${ma.toFixed(0)}) — NEW ENTRIES HALTED`,
    );
    return {
      allowed: false,
      mult: 0,
      reason: `ECF halted: equity ${(deviation * 100).toFixed(1)}% below ${PERIOD}-period MA`,
    };
  }

  if (deviation < 0) {
    log.info(
      `[ecf] equity ${(deviation * 100).toFixed(1)}% below MA — sizing ×${REDUCE_MULT}`,
    );
    return {
      allowed: true,
      mult: REDUCE_MULT,
      reason: `ECF reduced ×${REDUCE_MULT}: equity ${(deviation * 100).toFixed(1)}% below MA`,
    };
  }

  return {
    allowed: true,
    mult: 1.0,
    reason: `ECF healthy: equity ${(deviation * 100).toFixed(1)}% above MA`,
  };
}
