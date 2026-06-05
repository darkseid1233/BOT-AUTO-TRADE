/**
 * Circuit Breaker — multi-layer capital protection.
 *
 * Three independent breakers:
 *  1. DAILY  — drawdown > DAILY_DRAWDOWN_LIMIT (3%) of day-start balance → halt until 00:01 UTC
 *  2. WEEKLY — drawdown > WEEKLY_DRAWDOWN_LIMIT (8%) of week-start balance → halt until manual /resume
 *  3. STREAK — consecutive losses ≥ STREAK_TRIGGER_LOSSES (3) → cooldown + risk -25% for next 3 wins
 *
 * State is in-memory (no DB). Survives within a process lifetime.
 * On Railway, state resets on redeploy — acceptable given daily limits reset naturally.
 */
import { log } from './logger.js';

/** Breaker state snapshot. */
export type BreakerState = {
  dayStartBalance: number;
  dayStartedAt: number;
  weekStartBalance: number;
  weekStartedAt: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  reducedRiskTradesLeft: number;
  dailyHalted: boolean;
  weeklyHalted: boolean;
  cooldownUntil: number;
  cooldownTriggeredBy: number;
  lastUpdated: number;
  lastKnownBalance: number;
};

/** Result of a breaker check. */
export type BreakerCheck = {
  allowed: boolean;
  /** 0 = halted, 0.75 = reduced risk, 1.0 = normal */
  riskMultiplier: number;
  reason: string;
  breaker: 'DAILY' | 'WEEKLY' | 'STREAK' | 'OK';
};

function readEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const DAILY_LIMIT_PCT  = readEnv('DAILY_DRAWDOWN_LIMIT', 0.03);   // 3%
const WEEKLY_LIMIT_PCT = readEnv('WEEKLY_DRAWDOWN_LIMIT', 0.08);  // 8%
const STREAK_COOLDOWN_MS = readEnv('STREAK_COOLDOWN_MINUTES', 60) * 60_000;
const STREAK_TRIGGER_LOSSES = readEnv('STREAK_TRIGGER_LOSSES', 3);
const STREAK_REDUCED_TRADES = 3;
const STREAK_RISK_MULT = 0.75;

let notifyFn: ((msg: string) => Promise<void>) | null = null;

/** Register a callback to send alerts (e.g. Telegram). */
export function registerNotify(fn: (msg: string) => Promise<void>): void {
  notifyFn = fn;
}

function alert(msg: string): void {
  log.warn(`[circuit-breaker] ${msg}`);
  if (notifyFn) notifyFn(msg).catch(() => {});
}

function initState(balance: number): BreakerState {
  const now = Date.now();
  return {
    dayStartBalance: balance,
    dayStartedAt: now,
    weekStartBalance: balance,
    weekStartedAt: now,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    reducedRiskTradesLeft: 0,
    dailyHalted: false,
    weeklyHalted: false,
    cooldownUntil: 0,
    cooldownTriggeredBy: 0,
    lastUpdated: now,
    lastKnownBalance: balance,
  };
}

let state: BreakerState = initState(10_000);

/**
 * Initialise the circuit breaker with the current account balance.
 * Call once at startup after loading the account/paper balance.
 * @param balance current account balance
 */
export function initBreaker(balance: number): void {
  state = initState(balance);
  log.info(`[circuit-breaker] initialised — balance $${balance.toFixed(2)} | daily ${(DAILY_LIMIT_PCT * 100).toFixed(0)}% | weekly ${(WEEKLY_LIMIT_PCT * 100).toFixed(0)}% | streak ${STREAK_TRIGGER_LOSSES} losses`);
}

/** Reset the daily halt at UTC midnight. */
function resetDayIfNeeded(): void {
  const now = Date.now();
  const dayStart = new Date(state.dayStartedAt);
  const today = new Date();
  const isNewDay =
    today.getUTCFullYear() !== dayStart.getUTCFullYear() ||
    today.getUTCMonth() !== dayStart.getUTCMonth() ||
    today.getUTCDate() !== dayStart.getUTCDate();

  if (isNewDay) {
    if (state.dailyHalted) {
      log.info('[circuit-breaker] new UTC day — daily halt lifted');
      state.dailyHalted = false;
    }
    state.dayStartBalance = state.lastKnownBalance;
    state.dayStartedAt = now;
  }
}

/**
 * Check whether a new trade is allowed right now.
 * @param currentEquity current account equity
 * @returns BreakerCheck with allowed flag and risk multiplier
 */
export function checkBreaker(currentEquity: number): BreakerCheck {
  state.lastKnownBalance = currentEquity;
  resetDayIfNeeded();

  // Weekly halt — requires manual resume
  if (state.weeklyHalted) {
    return { allowed: false, riskMultiplier: 0, reason: 'Weekly drawdown halt — use /resume to clear', breaker: 'WEEKLY' };
  }

  // Daily halt
  if (state.dailyHalted) {
    return { allowed: false, riskMultiplier: 0, reason: `Daily drawdown halt — resets at midnight UTC`, breaker: 'DAILY' };
  }

  // Streak cooldown
  if (state.cooldownUntil > Date.now()) {
    const minLeft = Math.ceil((state.cooldownUntil - Date.now()) / 60_000);
    return { allowed: false, riskMultiplier: 0, reason: `Streak cooldown — ${minLeft}m left (${state.cooldownTriggeredBy} consecutive losses)`, breaker: 'STREAK' };
  }

  // Check daily drawdown
  if (state.dayStartBalance > 0) {
    const dailyDd = (state.dayStartBalance - currentEquity) / state.dayStartBalance;
    if (dailyDd >= DAILY_LIMIT_PCT) {
      state.dailyHalted = true;
      alert(`🔴 DAILY HALT — drawdown ${(dailyDd * 100).toFixed(2)}% exceeds ${(DAILY_LIMIT_PCT * 100).toFixed(0)}% limit. Bot paused until midnight UTC.`);
      return { allowed: false, riskMultiplier: 0, reason: `Daily drawdown ${(dailyDd * 100).toFixed(2)}% ≥ ${(DAILY_LIMIT_PCT * 100).toFixed(0)}%`, breaker: 'DAILY' };
    }
  }

  // Check weekly drawdown
  if (state.weekStartBalance > 0) {
    const weeklyDd = (state.weekStartBalance - currentEquity) / state.weekStartBalance;
    if (weeklyDd >= WEEKLY_LIMIT_PCT) {
      state.weeklyHalted = true;
      alert(`🔴 WEEKLY HALT — drawdown ${(weeklyDd * 100).toFixed(2)}% exceeds ${(WEEKLY_LIMIT_PCT * 100).toFixed(0)}% limit. Manual /resume required.`);
      return { allowed: false, riskMultiplier: 0, reason: `Weekly drawdown ${(weeklyDd * 100).toFixed(2)}% ≥ ${(WEEKLY_LIMIT_PCT * 100).toFixed(0)}%`, breaker: 'WEEKLY' };
    }
  }

  // Reduced risk after streak recovery
  if (state.reducedRiskTradesLeft > 0) {
    return {
      allowed: true,
      riskMultiplier: STREAK_RISK_MULT,
      reason: `Reduced risk mode (${state.reducedRiskTradesLeft} trades left after streak)`,
      breaker: 'OK',
    };
  }

  return { allowed: true, riskMultiplier: 1.0, reason: 'OK', breaker: 'OK' };
}

/**
 * Record the outcome of a closed trade (updates streak counters).
 * @param outcome WIN or LOSS
 * @param currentEquity current equity after the trade
 */
export function recordTradeOutcome(outcome: 'WIN' | 'LOSS', currentEquity: number): void {
  state.lastKnownBalance = currentEquity;

  if (outcome === 'LOSS') {
    state.consecutiveLosses += 1;
    state.consecutiveWins = 0;

    // Reset reduced risk on a loss (streak reset)
    if (state.reducedRiskTradesLeft > 0) {
      state.reducedRiskTradesLeft = 0;
      log.info('[circuit-breaker] reduced-risk period reset by new loss');
    }

    if (state.consecutiveLosses >= STREAK_TRIGGER_LOSSES) {
      const triggered = state.consecutiveLosses;
      state.cooldownUntil = Date.now() + STREAK_COOLDOWN_MS;
      state.cooldownTriggeredBy = triggered;
      state.consecutiveLosses = 0;
      state.reducedRiskTradesLeft = STREAK_REDUCED_TRADES;
      alert(`⚠️ STREAK COOLDOWN — ${triggered} consecutive losses. Bot paused ${Math.round(STREAK_COOLDOWN_MS / 60_000)}min. Next ${STREAK_REDUCED_TRADES} trades at -25% risk.`);
    }
  } else {
    state.consecutiveLosses = 0;
    state.consecutiveWins += 1;

    if (state.reducedRiskTradesLeft > 0) {
      state.reducedRiskTradesLeft -= 1;
      if (state.reducedRiskTradesLeft === 0) {
        log.info('[circuit-breaker] reduced-risk period complete — back to normal risk');
        alert('✅ Reduced-risk period complete after streak recovery. Normal risk restored.');
      }
    }
  }

  state.lastUpdated = Date.now();
}

/**
 * Manually clear the weekly halt (operator command).
 * @param currentEquity current equity to reset week baseline
 * @returns status message
 */
export function manualResume(currentEquity: number): string {
  if (!state.weeklyHalted && !state.dailyHalted && state.cooldownUntil <= Date.now()) {
    return 'Circuit breaker is not active — no resume needed.';
  }
  state.weeklyHalted = false;
  state.dailyHalted = false;
  state.cooldownUntil = 0;
  state.weekStartBalance = currentEquity;
  state.dayStartBalance = currentEquity;
  state.consecutiveLosses = 0;
  state.reducedRiskTradesLeft = 0;
  log.info(`[circuit-breaker] manual resume — balance reset to $${currentEquity.toFixed(2)}`);
  return `Circuit breaker cleared. Balance baseline reset to $${currentEquity.toFixed(2)}.`;
}

/** @returns a snapshot of the current breaker state for the dashboard. */
export function getBreakerStatus(): BreakerState & {
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  activeCooldown: boolean;
  cooldownMinutesLeft: number;
} {
  const dailyDrawdownPct = state.dayStartBalance > 0
    ? ((state.dayStartBalance - state.lastKnownBalance) / state.dayStartBalance) * 100
    : 0;
  const weeklyDrawdownPct = state.weekStartBalance > 0
    ? ((state.weekStartBalance - state.lastKnownBalance) / state.weekStartBalance) * 100
    : 0;
  const activeCooldown = state.cooldownUntil > Date.now();
  const cooldownMinutesLeft = activeCooldown ? Math.ceil((state.cooldownUntil - Date.now()) / 60_000) : 0;

  return {
    ...state,
    dailyDrawdownPct,
    weeklyDrawdownPct,
    activeCooldown,
    cooldownMinutesLeft,
  };
}
