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

  /**
   * Symbols whose most recent getCryptoBars call fell back to SYNTHETIC data.
   * Inspired by Freqtrade's data-quality gate: the strategy layer must be able to
   * tell real bars from generated ones so it never opens a live trade on fake
   * prices. The bot checks this via {@link isDataSynthetic} before entering.
   */
  private syntheticSymbols = new Set<string>();

  /**
   * Short-TTL OHLCV cache (like Freqtrade's DataProvider cache). A single scan
   * fetches the same symbol several times (signal + HTF + BTC-state + tick).
   * Caching for a fraction of the bar interval removes redundant HTTP calls and
   * the rate-limit pressure that caused intermittent failures.
   */
  private barCache = new Map<string, { fetchedAt: number; bars: { open: number; high: number; low: number; close: number; volume: number; ts: number }[] }>();

  /** True when real Alpaca credentials are configured. */
  get hasCredentials(): boolean {
    return Boolean(this.keyId && this.secret);
  }

  /**
   * Whether the last bars returned for a symbol were SYNTHETIC (demo/fallback).
   * @param symbol crypto symbol
   * @returns true when the latest data for this symbol was generated, not real
   */
  isDataSynthetic(symbol: string): boolean {
    return this.syntheticSymbols.has(symbol);
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
    if (!this.hasCredentials) return { ok: false, message: 'No credentials set' };
    // Detect obvious key format mistakes before hitting the API
    if (this.isPaper && this.keyId.startsWith('AK')) {
      return { ok: false, message: 'You selected Paper Trading but entered a LIVE key (starts with AK). Use Paper Trading keys from alpaca.markets → Paper Trading → API Keys.' };
    }
    if (!this.isPaper && this.keyId.startsWith('PK')) {
      return { ok: false, message: 'You selected Live Trading but entered a PAPER key (starts with PK). Switch to Paper (Demo) mode or use your live API keys.' };
    }
    try {
      const res = await fetch(`${this.tradingBase}/v2/account`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        const alpacaMsg = body ? ` — ${body.slice(0, 200)}` : '';
        if (res.status === 403 || res.status === 401) {
          return { ok: false, message: `Invalid API keys (${res.status})${alpacaMsg}. Double-check your Key ID and Secret in alpaca.markets → Paper Trading → API Keys.` };
        }
        return { ok: false, message: `Alpaca API error ${res.status} ${res.statusText}${alpacaMsg}` };
      }
      const a = (await res.json()) as Record<string, string>;
      return { ok: true, message: `Connected — account ${a.account_number ?? ''} (${a.status ?? 'OK'})` };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')) {
        return { ok: false, message: `Network error reaching Alpaca: ${msg}. Check your internet connection.` };
      }
      return { ok: false, message: msg };
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
    // IMPORTANT: Alpaca's crypto market-data endpoint (v1beta3/crypto/us/bars) is
    // PUBLIC — it returns real OHLCV without authentication. The previous version
    // only fetched real data when credentials were present AND always sent auth
    // headers, which produced a 401 on every call (trading-only keys / no data
    // plan) → silent fallback to SYNTHETIC random-walk prices for EVERY symbol.
    // The bot was effectively trading on fake data.
    //
    // Fix: always try the public endpoint. Send auth headers when available, but
    // on 401/403 retry once WITHOUT headers (public access) before giving up.

    // ── Cache hit (Freqtrade-style): serve recent bars without a new request ──
    const cacheKey = `${symbol}|${timeframe}|${limit}`;
    const cached = this.barCache.get(cacheKey);
    const cacheTtl = Math.min(timeframeMs(timeframe) / 3, 60_000); // ≤ 1/3 bar, max 60s
    if (cached && Date.now() - cached.fetchedAt < cacheTtl) {
      return cached.bars;
    }
    try {
      // CRITICAL: request an explicit time window wide enough to cover `limit`
      // bars (buffer for gaps/maintenance) and paginate with next_page_token.
      const barMs = timeframeMs(timeframe);
      const startMs = Date.now() - Math.ceil(limit * 1.5) * barMs;
      const all: Array<Record<string, number | string>> = [];
      let pageToken: string | undefined;
      let guard = 0;
      do {
        const url = new URL(`${this.dataBase}/v1beta3/crypto/us/bars`);
        url.searchParams.set('symbols', symbol);
        url.searchParams.set('timeframe', timeframe);
        url.searchParams.set('start', new Date(startMs).toISOString());
        url.searchParams.set('limit', '1000'); // max page size
        if (pageToken) url.searchParams.set('page_token', pageToken);
        const res = await this.fetchPublicData(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as {
          bars?: Record<string, Array<Record<string, number | string>>>;
          next_page_token?: string | null;
        };
        const page = data.bars?.[symbol] ?? [];
        all.push(...page);
        pageToken = data.next_page_token ?? undefined;
      } while (pageToken && ++guard < 10 && all.length < limit + 50);

      if (all.length > 0) {
        // Alpaca returns oldest-first; keep only the most recent `limit` bars.
        const trimmed = all.slice(-limit);
        const bars = trimmed.map((b) => ({
          open: Number(b.o),
          high: Number(b.h),
          low: Number(b.l),
          close: Number(b.c),
          volume: Number(b.v),
          ts: new Date(String(b.t)).getTime(),
        }));
        // Real data: clear any synthetic flag and cache it.
        this.syntheticSymbols.delete(symbol);
        this.barCache.set(cacheKey, { fetchedAt: Date.now(), bars });
        return bars;
      }
      log.warn(`[alpaca] getCryptoBars ${symbol} returned 0 bars (symbol delisted/untradeable?) — using synthetic`);
    } catch (e) {
      log.warn(`[alpaca] getCryptoBars ${symbol} failed, using synthetic: ${(e as Error).message}`);
    }
    // Fallback: flag the symbol so the strategy layer can refuse to trade on it.
    this.syntheticSymbols.add(symbol);
    return syntheticBars(symbol, limit, timeframe);
  }

  /**
   * Fetch from the PUBLIC Alpaca crypto data endpoint.
   * Tries with auth headers first (when available); on 401/403 — which means the
   * keys are trading-only or lack a data subscription — retries once WITHOUT
   * headers, because the crypto bars endpoint is publicly accessible.
   * @param url fully-built request URL
   * @returns the fetch Response (caller checks res.ok)
   */
  private async fetchPublicData(url: URL): Promise<Response> {
    if (this.hasCredentials) {
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
      if (res.status !== 401 && res.status !== 403) return res;
      // Auth rejected for market data — fall through to public (no-auth) request.
    }
    return fetch(url, { signal: AbortSignal.timeout(10_000) });
  }

  /**
   * Place a market order on the paper account. No-op in demo mode.
   *
   * Alpaca crypto requires qty as a fractional number. For very low-priced coins
   * (DOGE, MATIC, SHIB) Alpaca sometimes rejects qty-based orders with 422 if the
   * lot-size minimum isn't met. We always send qty (preferred) but catch 422 and
   * log a clear message instead of crashing the bot — the paper position is already
   * tracked internally so the mirror failure is non-fatal.
   *
   * @param symbol order symbol (e.g. "MATIC/USD")
   * @param side "buy" or "sell"
   * @param qty quantity (fractional units)
   * @returns the broker order id, or a synthetic id in demo mode
   */
  async placeMarketOrder(symbol: string, side: 'buy' | 'sell', qty: number): Promise<string> {
    if (!this.hasCredentials) {
      log.info(`[alpaca] DEMO order ${side} ${qty} ${symbol} (no credentials — simulated)`);
      return `demo-${Date.now()}`;
    }
    // Alpaca crypto symbols use "/" format (e.g. "MATIC/USD") but the REST orders
    // endpoint also accepts it natively — no symbol translation needed.
    const body: Record<string, string> = {
      symbol,
      side,
      qty: qty.toFixed(8),   // max 8dp, avoids scientific notation for tiny qty
      type: 'market',
      time_in_force: 'gtc',
    };
    const res = await fetch(`${this.tradingBase}/v2/orders`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      // 422 = Unprocessable Entity (qty below minimum, symbol not tradeable on account, etc.)
      // This is non-fatal — our internal paper position is already booked; just log.
      if (res.status === 422) {
        log.warn(`[alpaca] mirror order 422 ${symbol} ${side} qty=${qty.toFixed(8)} — ${text} (position tracked internally)`);
        return `skipped-422-${Date.now()}`;
      }
      throw new Error(`order failed: ${res.status} ${text}`);
    }
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
  'POL/USD': 0.45,
  'UNI/USD': 9.5,
};

/** Timeframe string → milliseconds per bar. */
function timeframeMs(tf: string): number {
  const m = /^(\d+)\s*(Min|Hour|Day)$/i.exec(tf.trim());
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'hour') return n * 60 * 60 * 1000;
  if (unit === 'day') return n * 24 * 60 * 60 * 1000;
  return n * 60 * 1000;
}

/** Mulberry32 — tiny deterministic PRNG. Same seed → same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (for per-symbol seeding). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * DETERMINISTIC synthetic OHLCV generator for demo mode.
 *
 * Each bar is a pure function of (symbol, bar-timestamp), so repeated calls
 * return IDENTICAL prices for the same time window. This is critical: the scan
 * loop (which computes the entry) and the tick loop (which marks-to-market)
 * must see a CONTINUOUS price series — otherwise positions teleport across the
 * stop-loss on the very next tick and book catastrophic, unrealistic losses.
 *
 * @param symbol symbol used to seed the base price + walk
 * @param limit number of bars
 * @param timeframe Alpaca timeframe (controls bar spacing + drift scale)
 * @returns generated bars, oldest first
 */
function syntheticBars(
  symbol: string,
  limit: number,
  timeframe = '15Min',
): { open: number; high: number; low: number; close: number; volume: number; ts: number }[] {
  const barMs = timeframeMs(timeframe);
  const now = Date.now();
  // Anchor to the current bar bucket so the latest bar is stable within a bucket.
  const lastBucket = Math.floor(now / barMs);
  const base = BASE_PRICES[symbol] ?? 100;
  const symSeed = hashStr(symbol);
  // Gentle regime trend that changes slowly over hours (deterministic per symbol).
  const trend = Math.sin(lastBucket / 96 + symSeed % 7) * 0.0006;

  const out: { open: number; high: number; low: number; close: number; volume: number; ts: number }[] = [];
  let price = base;
  for (let i = limit - 1; i >= 0; i--) {
    const bucket = lastBucket - i;
    // Seed each bar by (symbol, absolute bar bucket) → fully reproducible.
    const rnd = mulberry32(symSeed ^ (bucket >>> 0) ^ (bucket << 13));
    const drift = trend + (rnd() - 0.5) * 0.008;
    const open = price;
    const close = price * (1 + drift);
    const high = Math.max(open, close) * (1 + rnd() * 0.003);
    const low = Math.min(open, close) * (1 - rnd() * 0.003);
    const volume = 500 + rnd() * 2000;
    out.push({ open, high, low, close, volume, ts: bucket * barMs });
    price = close;
  }
  return out;
}
