/**
 * Discord Notifier — sends rich embed notifications to a Discord channel.
 *
 * Uses the Discord REST API directly (no external library).
 * Configure via env vars:
 *  DISCORD_BOT_TOKEN      — Bot token
 *  DISCORD_WIN_CHANNEL_ID — channel for closed wins
 *  DISCORD_OPEN_CHANNEL_ID— channel for new opens (optional, defaults to WIN channel)
 *  DISCORD_ALERT_CHANNEL_ID — channel for circuit breaker / risk alerts
 */
import { log } from './logger.js';

const DISCORD_API     = 'https://discord.com/api/v10';
const WIN_CHANNEL_ID  = process.env.DISCORD_WIN_CHANNEL_ID   ?? '';
const OPEN_CHANNEL_ID = process.env.DISCORD_OPEN_CHANNEL_ID  ?? WIN_CHANNEL_ID;
const ALERT_CHANNEL   = process.env.DISCORD_ALERT_CHANNEL_ID ?? WIN_CHANNEL_ID;

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

/** Send a Discord Embed to the specified channel. */
async function sendEmbed(embed: DiscordEmbed, channelId: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return;
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn(`[discord] send failed ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    log.debug(`[discord] sendEmbed error: ${(e as Error).message}`);
  }
}

export type DiscordOpenTrade = {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  notional: number;
  confidenceScore: number;
};

export type DiscordCloseTrade = {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  closePrice: number;
  realizedPnl: number;
  pnlPercent: number;
  reason: string;
};

/** Notify on opening a new position. */
export async function notifyDiscordOpen(trade: DiscordOpenTrade): Promise<void> {
  const isLong  = trade.side === 'LONG';
  const emoji   = isLong ? '📈' : '📉';
  const color   = isLong ? 0x2ecc71 : 0xe74c3c;
  const slDist  = Math.abs(trade.entryPrice - trade.stopLoss);
  const tpDist  = Math.abs(trade.takeProfit - trade.entryPrice);
  const rr      = slDist > 0 ? (tpDist / slDist).toFixed(2) : '—';
  await sendEmbed({
    title: `${emoji} OPEN ${trade.side} — ${trade.symbol}`,
    color,
    fields: [
      { name: 'Entry',      value: `\`${trade.entryPrice.toFixed(4)}\``, inline: true },
      { name: 'Stop Loss',  value: `\`${trade.stopLoss.toFixed(4)}\``,  inline: true },
      { name: 'Take Profit',value: `\`${trade.takeProfit.toFixed(4)}\``,inline: true },
      { name: 'Notional',   value: `$${trade.notional.toFixed(2)}`,     inline: true },
      { name: 'Confidence', value: `${trade.confidenceScore}%`,          inline: true },
      { name: 'R:R',        value: `${rr}`,                             inline: true },
    ],
    footer: { text: 'AlpacaBot Auto-Trader' },
    timestamp: new Date().toISOString(),
  }, OPEN_CHANNEL_ID);
}

/** Notify on closing a trade with profit or loss. */
export async function notifyDiscordClose(trade: DiscordCloseTrade): Promise<void> {
  const isWin  = trade.realizedPnl > 0;
  const emoji  = isWin ? '✅' : '❌';
  const color  = isWin ? 0xf1c40f : 0x95a5a6;
  const sign   = trade.realizedPnl >= 0 ? '+' : '';
  await sendEmbed({
    title: `${emoji} CLOSE ${trade.side} — ${trade.symbol} (${trade.reason})`,
    color,
    fields: [
      { name: 'Entry',    value: `\`${trade.entryPrice.toFixed(4)}\``, inline: true },
      { name: 'Exit',     value: `\`${trade.closePrice.toFixed(4)}\``, inline: true },
      { name: 'PnL',      value: `${sign}$${trade.realizedPnl.toFixed(2)} (${sign}${trade.pnlPercent.toFixed(2)}%)`, inline: false },
    ],
    footer: { text: 'AlpacaBot Auto-Trader' },
    timestamp: new Date().toISOString(),
  }, WIN_CHANNEL_ID);
}

/** Notify a risk / circuit-breaker alert. */
export async function notifyDiscordAlert(message: string): Promise<void> {
  if (!ALERT_CHANNEL) return;
  await sendEmbed({
    title: '🚨 Risk Alert',
    description: message,
    color: 0xe74c3c,
    timestamp: new Date().toISOString(),
  }, ALERT_CHANNEL);
}
