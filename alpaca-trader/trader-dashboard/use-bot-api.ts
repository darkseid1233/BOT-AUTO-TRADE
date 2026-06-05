import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  BotStats, OpenPosition, ClosedTrade, Signal, AlpacaAccount, EquityPoint, BotHealth, LogEntry,
  RiskSettings, ConnectionStatus,
} from './types.js';

/**
 * Trader-service base path.
 *
 * The dashboard's Vite dev server proxies `/trader-service` to the platform
 * gateway (see vite.config.js), so the browser always talks same-origin — no
 * CORS, and it works identically on a PC and in the Bit cloud workspace.
 */
const BASE = '/trader-service';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' });
  if (!res.ok && res.status !== 503) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * POST helper for control endpoints.
 * @param path API path under the trader service
 * @param body optional JSON body to send
 * @returns parsed JSON response
 */
export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Connect to Alpaca with API keys. @param payload keyId, secret, paper flag */
export async function connectAlpaca(payload: {
  keyId: string;
  secret: string;
  paper: boolean;
}): Promise<ConnectionStatus> {
  return postJson<ConnectionStatus>('/api/connect', payload);
}

/** Disconnect from Alpaca, returning to demo mode. */
export async function disconnectAlpaca(): Promise<ConnectionStatus> {
  return postJson<ConnectionStatus>('/api/disconnect');
}

/** Update risk-management settings. @param patch partial settings */
export async function updateRisk(patch: Partial<RiskSettings>): Promise<RiskSettings> {
  return postJson<RiskSettings>('/api/risk', patch);
}

/** Aggregate data returned by the polling hook. */
export type BotData = {
  stats: BotStats | null;
  positions: OpenPosition[];
  history: ClosedTrade[];
  signals: Signal[];
  account: AlpacaAccount | null;
  equity: EquityPoint[];
  health: BotHealth | null;
  logs: LogEntry[];
  risk: RiskSettings | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
  refresh: () => void;
};

/**
 * Poll the trader-service REST API on an interval and expose live bot data.
 * @param pollMs polling interval in milliseconds (default 5000)
 * @returns the latest bot data plus a manual refresh function
 */
export function useBotApi(pollMs = 5000): BotData {
  const [stats, setStats] = useState<BotStats | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [history, setHistory] = useState<ClosedTrade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [health, setHealth] = useState<BotHealth | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [risk, setRisk] = useState<RiskSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const lastLogTs = useRef(0);

  const fetchAll = useCallback(async () => {
    try {
      const [s, p, h, sig, acc, eq, hl, rk] = await Promise.allSettled([
        getJson<BotStats>('/api/status'),
        getJson<OpenPosition[]>('/api/positions'),
        getJson<ClosedTrade[]>('/api/history?limit=100'),
        getJson<Signal[]>('/api/signals'),
        getJson<AlpacaAccount>('/api/account'),
        getJson<EquityPoint[]>('/api/equity'),
        getJson<BotHealth>('/api/health/deep'),
        getJson<RiskSettings>('/api/risk'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (p.status === 'fulfilled') setPositions(Array.isArray(p.value) ? p.value : []);
      if (h.status === 'fulfilled') setHistory(Array.isArray(h.value) ? h.value : []);
      if (sig.status === 'fulfilled') setSignals(Array.isArray(sig.value) ? sig.value : []);
      if (acc.status === 'fulfilled') setAccount(acc.value);
      if (eq.status === 'fulfilled') setEquity(Array.isArray(eq.value) ? eq.value : []);
      if (hl.status === 'fulfilled') setHealth(hl.value);
      if (rk.status === 'fulfilled') setRisk(rk.value);

      const anyOk = [s, p, h, sig, acc, eq, hl].some((r) => r.status === 'fulfilled');
      setError(anyOk ? null : 'Cannot reach the trading bot service.');
      setLastUpdated(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await getJson<{ entries: LogEntry[]; ts: number }>(
        `/api/logs?since=${lastLogTs.current}&limit=100`,
      );
      if (data.entries.length > 0) {
        lastLogTs.current = data.ts;
        const newestFirst = [...data.entries].sort((a, b) => b.ts - a.ts);
        setLogs((prev) => [...newestFirst, ...prev].slice(0, 300));
      }
    } catch {
      /* ignore log fetch errors */
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchLogs();
    const t1 = setInterval(fetchAll, pollMs);
    const t2 = setInterval(fetchLogs, 4000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [fetchAll, fetchLogs, pollMs]);

  return {
    stats, positions, history, signals, account, equity, health, logs, risk,
    loading, error, lastUpdated, refresh: fetchAll,
  };
}
