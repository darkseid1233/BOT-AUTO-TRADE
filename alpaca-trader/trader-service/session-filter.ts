/**
 * Session Filter — restricts trading to high-liquidity windows by default.
 *
 * Sessions:
 *  London  07-11 UTC — allowed
 *  NY_Open 13-17 UTC — allowed
 *  Asian   00-05 UTC — blocked by default (low liquidity / spread risk)
 *  OffHours            — blocked by default
 *
 * Override: set ALLOW_ALL_SESSIONS=true in env to trade 24/7 (default true
 * since Alpaca crypto never closes and our bot benefits from round-the-clock coverage).
 */

export type TradingSession = 'London' | 'NY_Open' | 'Asian' | 'OffHours';

export type SessionResult = {
  session: TradingSession;
  allowed: boolean;
  riskMultiplier: number;
  reason: string;
};

// Default TRUE — 24/7 trading for crypto.
// Set ALLOW_ALL_SESSIONS=false in Railway to limit to London/NY windows only.
const ALLOW_ALL = (process.env.ALLOW_ALL_SESSIONS ?? 'true') === 'true';

/**
 * Determine which trading session the given UTC hour falls in.
 * @param utcHour 0-23
 */
export function getTradingSession(utcHour: number): TradingSession {
  if (utcHour >= 7 && utcHour < 11) return 'London';
  if (utcHour >= 13 && utcHour < 17) return 'NY_Open';
  if (utcHour >= 0 && utcHour < 5) return 'Asian';
  return 'OffHours';
}

/**
 * Check whether trading is allowed for the current UTC hour.
 * @param utcHour override (defaults to current UTC hour)
 */
export function checkSession(utcHour?: number): SessionResult {
  const hour = utcHour ?? new Date().getUTCHours();
  const session = getTradingSession(hour);

  if (ALLOW_ALL) {
    return { session, allowed: true, riskMultiplier: 1.0, reason: `Session: ${session} (24/7 override)` };
  }

  if (session === 'London') {
    return { session, allowed: true, riskMultiplier: 1.0, reason: 'London session 07-11 UTC' };
  }
  if (session === 'NY_Open') {
    return { session, allowed: true, riskMultiplier: 1.0, reason: 'NY session 13-17 UTC' };
  }
  return {
    session,
    allowed: false,
    riskMultiplier: 0,
    reason: `Session ${session} — blocked (trade only London 07-11 or NY 13-17 UTC)`,
  };
}

/**
 * Human-readable summary of the current session state.
 */
export function sessionSummary(): string {
  const s = checkSession();
  return `${s.session} (${s.allowed ? 'ACTIVE' : 'BLOCKED'})`;
}

/**
 * Minutes until the next active session starts.
 * Returns 0 if currently inside an active session.
 */
export function minutesUntilNextSession(): number {
  const now = new Date();
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  const totalMins = hour * 60 + min;

  const londonStart = 7 * 60;
  const nyStart = 13 * 60;

  // Inside active session?
  if ((totalMins >= londonStart && totalMins < 11 * 60) ||
      (totalMins >= nyStart && totalMins < 17 * 60)) return 0;

  // Before London
  if (totalMins < londonStart) return londonStart - totalMins;
  // Between London and NY
  if (totalMins < nyStart) return nyStart - totalMins;
  // After NY → next London
  return 24 * 60 - totalMins + londonStart;
}
