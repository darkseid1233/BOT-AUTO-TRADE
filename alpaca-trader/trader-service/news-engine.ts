/**
 * News Engine — fetches crypto news from public RSS feeds.
 *
 * Sources: CoinTelegraph, CoinDesk, Decrypt.
 * Refreshes every 60 minutes. No API key required.
 * Sentiment scoring is keyword-based (no AI dependency).
 *
 * Items are cached in-memory and exposed via getLatestNews() / getHighImpact().
 */
import { log } from './logger.js';

const FEEDS = [
  'https://cointelegraph.com/rss',
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://decrypt.co/feed',
];

const REFRESH_INTERVAL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export type NewsItem = {
  title: string;
  link: string;
  pubDate: number;
  source: string;
  /** 'bullish' | 'bearish' | 'neutral' */
  sentiment: 'bullish' | 'bearish' | 'neutral';
  /** Impact score 1-10 */
  impact: number;
  /** Symbols mentioned */
  symbols: string[];
};

const BULLISH_KEYWORDS = ['rally', 'surge', 'bull', 'breakout', 'adoption', 'institutional', 'etf approved', 'upgrade'];
const BEARISH_KEYWORDS = ['crash', 'dump', 'bear', 'hack', 'ban', 'regulation', 'sec', 'lawsuit', 'collapse', 'liquidation'];
const CRYPTO_SYMBOLS   = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'POL', 'UNI', 'LTC', 'BNB', 'ADA'];

let cache: NewsItem[] = [];
let lastRefresh = 0;

function parseRss(xml: string, source: string): Array<{ title: string; link: string; pubDate: number }> {
  const items: Array<{ title: string; link: string; pubDate: number }> = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
  const linkRe  = /<link>([\s\S]*?)<\/link>/;
  const dateRe  = /<pubDate>([\s\S]*?)<\/pubDate>/;
  const matches = xml.match(itemRegex) ?? [];
  for (const m of matches) {
    const title = (m.match(titleRe)?.[1] ?? '').trim();
    const link  = (m.match(linkRe)?.[1] ?? '').trim();
    const date  = (m.match(dateRe)?.[1] ?? '').trim();
    if (!title) continue;
    const ts = Date.parse(date);
    items.push({ title, link, pubDate: isNaN(ts) ? Date.now() : ts });
  }
  return items;
}

function scoreItem(title: string): { sentiment: NewsItem['sentiment']; impact: number; symbols: string[] } {
  const lower = title.toLowerCase();
  const bullish = BULLISH_KEYWORDS.filter((k) => lower.includes(k)).length;
  const bearish = BEARISH_KEYWORDS.filter((k) => lower.includes(k)).length;
  const symbols = CRYPTO_SYMBOLS.filter((s) => title.toUpperCase().includes(s));

  let sentiment: NewsItem['sentiment'] = 'neutral';
  if (bullish > bearish) sentiment = 'bullish';
  else if (bearish > bullish) sentiment = 'bearish';

  const impact = Math.min(10, 3 + bullish + bearish + (symbols.length > 0 ? 2 : 0));
  return { sentiment, impact, symbols };
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const xml = await res.text();
    const source = new URL(url).hostname.replace('www.', '');
    return parseRss(xml, source).map((item) => ({
      ...item,
      source,
      ...scoreItem(item.title),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch all feeds and update the cache. */
export async function refreshNews(): Promise<NewsItem[]> {
  try {
    const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
    const all: NewsItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }
    all.sort((a, b) => b.pubDate - a.pubDate);
    cache = all.slice(0, 100);
    lastRefresh = Date.now();
    log.debug(`[news] refreshed — ${cache.length} items`);
    return cache;
  } catch (e) {
    log.debug(`[news] refresh failed: ${(e as Error).message}`);
    return cache;
  }
}

/** Return the latest cached news items. */
export function getLatestNews(limit = 20): NewsItem[] {
  return cache.slice(0, limit);
}

/** Return high-impact items (impact >= 7) from the last 6 hours. */
export function getHighImpact(): NewsItem[] {
  const cutoff = Date.now() - 6 * 3_600_000;
  return cache.filter((n) => n.impact >= 7 && n.pubDate > cutoff);
}

/** @returns the last refresh timestamp. */
export function getNewsRefreshAt(): number { return lastRefresh; }

/** Start the background news refresh loop. @returns cleanup interval id */
export function startNewsLoop(): ReturnType<typeof setInterval> {
  refreshNews().catch(() => {});
  return setInterval(() => {
    refreshNews().catch(() => {});
  }, REFRESH_INTERVAL_MS);
}
