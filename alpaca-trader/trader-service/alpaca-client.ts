import { log } from './logger.js';
import type { AlpacaAccount } from './types.js';

/**
 * Minimal Alpaca REST client for PAPER trading.
 *
 * Reads credentials from env:
 *   ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY
 * Base URLs default to the paper-trading + crypto market-data endpoints.
 *
 * When credentials are missing the client runs in "demo" mode: account data is
 * synthesised and historical bars are generated with a deterministic random
 * walk, so the whole app works out of the box without keys.
 */
export class AlpacaClient {
  private keyId = process.env.ALPACA_API_KEY_ID ?? '';
  private secret = process.env.ALPACA_API_SECRET_KEY ?? '';
  private tradingBase = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets';
  private dataBase = process.env.ALPACA_DATA_URL ?? 'https://data.alpaca.markets';

  /** True when real Alpaca credentials are configured. */
  get hasCredentials(): boolean {
    return Boolean(this.keyId && this.secret);
  }

  /** @returns whether the trading base URL points at the paper endpoint. */
  get isPaper(): boolean {
    return this.tradingBase.includes('paper');
  }

  /**
   * Set/replace the Alpaca API credentials at runtime (from the dashboard).
   * @param keyId Alpaca API key id
   * @param secret Alpaca API secret key
   * @param paper whether to use the paper endpoint (default true)
   */
  setCredentials(keyId: string, secret: string, paper = true): void {
    this.keyId = keyId.trim();
    this.secret = secret.trim();
    this.tradingBase = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    log.info(`[alpaca] credentials set — ${paper ? 'PAPER' : 'LIVE'} trading endpoint`);
  }

  /** Remove credentials and revert to demo mode. */
  clearCredentials(): void {
    this.keyId = '';
    this.secret = '';
    log.info('[alpaca] credentials cleared — back to demo mode');
  }

  /**
   * Verify the configured credentials by fetching the account.
   * @returns true when the account responds OK
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.hasCredentials) return { ok: false, message: 'no credentials set' };
    try {
      const res = await fetch(`${this.tradingBase}/v2/account`, { headers: this.headers() });
      if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
      const a = (await res.json()) as Record<string, string>;
      return { ok: true, message: `connected — account ${a.account_number ?? ''} (${a.status ?? 'OK'})` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  private headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.keyId,
      'APCA-API-SECRET-KEY': this.secret,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Fetch the paper-trading account snapshot.
   * @returns account info; a synthetic snapshot in demo mode
   */
  async getAccount(): Promise<AlpacaAccount> {
    if (!this.hasCredentials) {
      return {
        connected: false,
        accountNumber: 'DEMO-PAPER',
        status: 'DEMO',
        currency: 'USD',
        cash: 100000,
        portfolioValue: 100000,
        buyingPower: 200000,
        equity: 100000,
        paperTrading: true,
      };
    }
    try {
      const res = await fetch(`${this.tradingBase}/v2/account`, { headers: this.headers() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const a = (await res.json()) as Record<string, string>;
      return {
        connected: true,
        accountNumber: a.account_number ?? '',
        status: a.status ?? 'UNKNOWN',
        currency: a.currency ?? 'USD',
        cash: Number(a.cash ?? 0),
        portfolioValue: Number(a.portfolio_value ?? 0),
        buyingPower: Number(a.buying_power ?? 0),
        equity: Number(a.equity ?? 0),
        paperTrading: this.tradingBase.includes('paper'),
      };
    } catch (e) {
      log.error(`[alpaca] getAccount failed: ${(e as Error).message}`);
      return {
        connected: false,
        accountNumber: '',
        status: 'ERROR',
        currency: 'USD',
        cash: 0,
        portfolioValue: 0,
        buyingPower: 0,
        equity: 0,
        paperTrading: true,
      };
    }
  }

  /**
   * Fetch recent crypto bars (OHLCV) for a symbol like "BTC/USD".
   * Falls back to a synthetic random walk in demo mode or on error.
   * @param symbol Alpaca crypto symbol, e.g. "BTC/USD"
   * @param timeframe Alpaca timeframe, e.g. "15Min", "1Hour"
   * @param limit number of bars to return
   * @returns OHLCV bars, oldest first
   */
  async getCryptoBars(
    symbol: string,
    timeframe = '15Min',
    limit = 120,
  ): Promise<{ open: number; high: number; low: number; close: number; volume: number; ts: number }[]> {
    if (this.hasCredentials) {
      try {
        const url = new URL(`${this.dataBase}/v1beta3/crypto/us/bars`);
        url.searchParams.set('symbols', symbol);
        url.searchParams.set('timeframe', timeframe);
        url.searchParams.set('limit', String(limit));
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as { bars?: Record<string, Array<Record<string, number | string>>> };
        const bars = data.bars?.[symbol] ?? [];
        if (bars.length > 0) {
          return bars.map((b) => ({
            open: Number(b.o),
            high: Number(b.h),
            low: Number(b.l),
            close: Number(b.c),
            volume: Number(b.v),
            ts: new Date(String(b.t)).getTime(),
          }));
        }
      } catch (e) {
        log.warn(`[alpaca] getCryptoBars ${symbol} failed, using synthetic: ${(e as Error).message}`);
      }
    }
    return syntheticBars(symbol, limit);
  }

  /**
   * Place a market order on the paper account. No-op in demo mode.
   * @param symbol order symbol
   * @param side "buy" or "sell"
   * @param qty quantity
   * @returns the broker order id, or a synthetic id in demo mode
   */
  async placeMarketOrder(symbol: string, side: 'buy' | 'sell', qty: number): Promise<string> {
    if (!this.hasCredentials) {
      log.info(`[alpaca] DEMO order ${side} ${qty} ${symbol} (no credentials — simulated)`);
      return `demo-${Date.now()}`;
    }
    const res = await fetch(`${this.tradingBase}/v2/orders`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ symbol, side, qty: String(qty), type: 'market', time_in_force: 'gtc' }),
    });
    if (!res.ok) throw new Error(`order failed: ${res.status} ${res.statusText}`);
    const o = (await res.json()) as { id: string };
    return o.id;
  }
}

/** Per-symbol base price for the synthetic generator. */
const BASE_PRICES: Record<string, number> = {
  'BTC/USD': 64000,
  'ETH/USD': 3200,
  'SOL/USD': 150,
  'LTC/USD': 85,
  'AVAX/USD': 35,
  'LINK/USD': 16,
  'DOGE/USD': 0.16,
  'MATIC/USD': 0.7,
};

/**
 * Deterministic-ish synthetic OHLCV generator for demo mode.
 * @param symbol symbol used to seed the base price
 * @param limit number of bars
 * @returns generated bars, oldest first
 */
function syntheticBars(
  symbol: string,
  limit: number,
): { open: number; high: number; low: number; close: number; volume: number; ts: number }[] {
  let price = BASE_PRICES[symbol] ?? 100;
  const now = Date.now();
  const out: { open: number; high: number; low: number; close: number; volume: number; ts: number }[] = [];
  // Seed a gentle trend so signals occasionally fire.
  const trend = (Math.sin(now / 1e9 + symbol.length) * 0.0008);
  for (let i = limit - 1; i >= 0; i--) {
    const drift = trend + (Math.random() - 0.5) * 0.01;
    const open = price;
    const close = price * (1 + drift);
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    const volume = 500 + Math.random() * 2000;
    out.push({ open, high, low, close, volume, ts: now - i * 15 * 60 * 1000 });
    price = close;
  }
  return out;
}
