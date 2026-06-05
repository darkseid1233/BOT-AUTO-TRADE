/**
 * Telegram Notifier — sends bot messages using the Telegram Bot API directly.
 *
 * No external dependencies (no Telegraf). Uses native fetch.
 * Configure via env vars:
 *  TELEGRAM_BOT_TOKEN — Bot token (from @BotFather)
 *  TELEGRAM_CHAT_ID   — Chat or user ID to send messages to
 *
 * When these env vars are absent, all calls are silent no-ops.
 */
import { log } from './logger.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID   ?? '';
const BASE    = `https://api.telegram.org/bot${TOKEN}`;

/** True when Telegram is configured. */
export const telegramEnabled = Boolean(TOKEN && CHAT_ID);

/**
 * Send a plain-text message to the configured chat.
 * Silently skips if not configured.
 * @param text message text
 */
export async function telegramSend(text: string): Promise<void> {
  if (!telegramEnabled) return;
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn(`[telegram] send failed ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    log.debug(`[telegram] send error: ${(e as Error).message}`);
  }
}

/** Notify on opening a new trade. */
export async function telegramNotifyOpen(trade: {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
}): Promise<void> {
  const emoji = trade.side === 'LONG' ? '📈' : '📉';
  const slPct = Math.abs((trade.stopLoss - trade.entryPrice) / trade.entryPrice * 100).toFixed(2);
  const tpPct = Math.abs((trade.takeProfit - trade.entryPrice) / trade.entryPrice * 100).toFixed(2);
  await telegramSend(
    `${emoji} <b>OPEN ${trade.side}</b> — ${trade.symbol}\n` +
    `Entry: <code>${trade.entryPrice.toFixed(4)}</code>\n` +
    `SL: <code>${trade.stopLoss.toFixed(4)}</code> (-${slPct}%)\n` +
    `TP: <code>${trade.takeProfit.toFixed(4)}</code> (+${tpPct}%)\n` +
    `Confidence: ${trade.confidence}%`,
  );
}

/** Notify on closing a trade. */
export async function telegramNotifyClose(trade: {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  closePrice: number;
  realizedPnl: number;
  pnlPercent: number;
  reason: string;
}): Promise<void> {
  const isWin  = trade.realizedPnl > 0;
  const emoji  = isWin ? '✅' : '❌';
  const sign   = trade.realizedPnl >= 0 ? '+' : '';
  await telegramSend(
    `${emoji} <b>${trade.reason} ${trade.side}</b> — ${trade.symbol}\n` +
    `Entry: <code>${trade.entryPrice.toFixed(4)}</code>  Exit: <code>${trade.closePrice.toFixed(4)}</code>\n` +
    `PnL: <b>${sign}$${trade.realizedPnl.toFixed(2)}</b> (${sign}${trade.pnlPercent.toFixed(2)}%)`,
  );
}

/** Notify a risk / circuit-breaker alert. */
export async function telegramAlert(message: string): Promise<void> {
  await telegramSend(`🚨 <b>RISK ALERT</b>\n${message}`);
}

/** Send a generic status message. */
export async function telegramStatus(message: string): Promise<void> {
  await telegramSend(`ℹ️ ${message}`);
}
