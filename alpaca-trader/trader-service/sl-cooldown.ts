/**
 * SL Cooldown & Signal Deduplication — anti-revenge-trading guard.
 *
 * NOTE: bot.ts already implements cooldowns inline via `this.slCooldowns` Map
 * and `this.lastOpenedAt` Map with the same semantic. This module is a thin
 * re-export shim so that paper-trader.ts can import named helpers without
 * coupling directly to the TradingBot class internals.
 *
 * The source of truth is STILL the bot's own Maps — this module does NOT
 * maintain its own separate state. If you later want a fully independent
 * global cooldown registry, replace the implementations here.
 */

import { log } from './logger.js';

/** Default SL cooldown in minutes (bot reads from SL_COOLDOWN_MINUTES env). */
const SL_COOLDOWN_MIN = Number(process.env.SL_COOLDOWN_MINUTES ?? 30);
/** Default signal-dedup window in minutes. */
const SIGNAL_DEDUP_MIN = Number(process.env.SIGNAL_DEDUP_MINUTES ?? 15);

/** Internal state — keyed by `"sl:<symbol>"` or `"sig:<symbol>:<side>"`. */
const cooldowns = new Map<string, { blockedUntil: number; reason: string }>();

/**
 * Record a stop-loss hit for a symbol — blocks re-entry on either side
 * for SL_COOLDOWN_MINUTES.
 * @param symbol Alpaca crypto symbol (e.g. "BTC/USD")
 * @param side position side that was stopped out
 */
export function recordSlHit(symbol: string, side: 'LONG' | 'SHORT'): void {
  const key = `sl:${symbol}`;
  const until = Date.now() + SL_COOLDOWN_MIN * 60_000;
  cooldowns.set(key, { blockedUntil: until, reason: `SL hit on ${side}` });
  log.info(`[cooldown] ${symbol} SL cooldown ${SL_COOLDOWN_MIN}m — blocked until ${new Date(until).toISOString()}`);
}

/**
 * Record a successful entry on a side — blocks same-side re-entry for
 * SIGNAL_DEDUP_MINUTES to prevent immediate revenge trades after TP close.
 * @param symbol Alpaca crypto symbol
 * @param side the side just entered
 */
export function recordSignalEntry(symbol: string, side: 'LONG' | 'SHORT'): void {
  const key = `sig:${symbol}:${side}`;
  const until = Date.now() + SIGNAL_DEDUP_MIN * 60_000;
  cooldowns.set(key, { blockedUntil: until, reason: `${side} entry dedup` });
  log.debug(`[cooldown] ${symbol} ${side} dedup ${SIGNAL_DEDUP_MIN}m`);
}

/**
 * Returns true if the symbol is in a post-SL cooldown window.
 * @param symbol Alpaca crypto symbol
 */
export function isInSlCooldown(symbol: string): boolean {
  const entry = cooldowns.get(`sl:${symbol}`);
  if (!entry) return false;
  if (Date.now() > entry.blockedUntil) {
    cooldowns.delete(`sl:${symbol}`);
    return false;
  }
  return true;
}

/**
 * Returns true if the specific side is in a signal-dedup cooldown window.
 * @param symbol Alpaca crypto symbol
 * @param side the side to check
 */
export function isSignalDedupBlocked(symbol: string, side: 'LONG' | 'SHORT'): boolean {
  const key = `sig:${symbol}:${side}`;
  const entry = cooldowns.get(key);
  if (!entry) return false;
  if (Date.now() > entry.blockedUntil) {
    cooldowns.delete(key);
    return false;
  }
  return true;
}

/** Returns all currently active cooldown entries (for dashboard transparency). */
export function getActiveCooldowns(): Array<{ key: string; blockedUntil: number; reason: string }> {
  const now = Date.now();
  const active: Array<{ key: string; blockedUntil: number; reason: string }> = [];
  for (const [key, entry] of cooldowns) {
    if (entry.blockedUntil > now) {
      active.push({ key, blockedUntil: entry.blockedUntil, reason: entry.reason });
    } else {
      cooldowns.delete(key);
    }
  }
  return active;
}

/** Clear all cooldowns — for testing or manual operator reset. */
export function clearAllCooldowns(): void {
  cooldowns.clear();
  log.warn('[cooldown] all cooldowns cleared (manual reset)');
}
