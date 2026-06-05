import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  BotStats, OpenPosition, ClosedTrade, Signal, AlpacaAccount, EquityPoint, BotHealth, LogEntry,
  RiskSettings, ConnectionStatus, JournalEntry, JournalReport, BreakerStatus,
} from './types.js';

const BASE = '/trader-service';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' });
  if (!res.ok && res.status !== 503) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

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

export async function connectAlpaca(payload: { keyId: string; secret: string; paper: boolean }): Promise<ConnectionStatus> {
  return postJson<ConnectionStatus>('/api/connect', payload);
}
export async function disconnectAlpaca(): Promise<ConnectionStatus> {
  return postJson<ConnectionStatus>('/api/disconnect');
}
export async function fetchJournalReport(): Promise<JournalReport> {
  return getJson<JournalReport>('/api/journal/report');
}
export async function fetchJournal(limit = 100): Promise<JournalEntry[]> {
  return getJson<JournalEntry[]>(`/api/journal?limit=${limit}`);
}
export async function updateRisk(patch: Partial<RiskSettings>): Promise<RiskSettings> {
  return postJson<RiskSettings>('/api/risk', patch);
}
export async function fetchBacktestCompare(symbol: string, walk = true): Promise<unknown> {
  return getJson<unknown>(`/api/backtest/compare/${encodeURIComponent(symbol)}?walk=${walk}`);
}
export async function fetchBacktest(symbol: string, walkForward = false): Promise<unknown> {
  return getJson<unknown>(`/api/backtest/${encodeURIComponent(symbol)}?walk=${walkForward}`);
}

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
  breaker: BreakerStatus | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
  refresh: () => void;
};

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
  const [breaker, setBreaker] = useState<BreakerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const lastLogTs = useRef(0);

  const fetchAll = useCallback(async () => {
    try {
      const [s, p, h, sig, acc, eq, hl, rk, br] = await Promise.allSettled([
        getJson<BotStats>('/api/status'),
        getJson<OpenPosition[]>('/api/positions'),
        getJson<ClosedTrade[]>('/api/history?limit=100'),
        getJson<Signal[]>('/api/signals'),
        getJson<AlpacaAccount>('/api/account'),
        getJson<EquityPoint[]>('/api/equity'),
        getJson<BotHealth>('/api/health/deep'),
        getJson<RiskSettings>('/api/risk'),
        getJson<BreakerStatus>('/api/breaker'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (p.status === 'fulfilled') setPositions(Array.isArray(p.value) ? p.value : []);
      if (h.status === 'fulfilled') setHistory(Array.isArray(h.value) ? h.value : []);
      if (sig.status === 'fulfilled') setSignals(Array.isArray(sig.value) ? sig.value : []);
      if (acc.status === 'fulfilled') setAccount(acc.value);
      if (eq.status === 'fulfilled') setEquity(Array.isArray(eq.value) ? eq.value : []);
      if (hl.status === 'fulfilled') setHealth(hl.value);
      if (rk.status === 'fulfilled') setRisk(rk.value);
      if (br.status === 'fulfilled') setBreaker(br.value);
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
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchLogs();
    const t1 = setInterval(fetchAll, pollMs);
    const t2 = setInterval(fetchLogs, 4000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchAll, fetchLogs, pollMs]);

  return {
    stats, positions, history, signals, account, equity, health, logs, risk, breaker,
    loading, error, lastUpdated, refresh: fetchAll,
  };
}
