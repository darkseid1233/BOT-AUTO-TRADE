import { useEffect, useState, type CSSProperties } from 'react';
import { fetchJournalReport } from './use-bot-api.js';
import type { JournalReport } from './types.js';
import styles from './trader-dashboard.module.css';

/**
 * Performance Metrics Dashboard — renders the Trade Journal analytics:
 *  - Win rate / avg PnL broken down by Market Regime
 *  - Win rate / avg PnL by Signal Quality bucket (proves the quality gate works)
 *  - Factor Edge: which scoring factors actually separate winners from losers
 *
 * Polls /api/journal/report every 15s.
 */
export function AnalyticsPanel() {
  const [report, setReport] = useState<JournalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetchJournalReport()
      .then((r) => { if (alive) { setReport(r); setError(null); } })
      .catch((e) => { if (alive) setError(String(e)); });
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (error) return <div className={styles.empty}>Analytics error: {error}</div>;
  if (!report || report.totalTrades === 0) {
    return <div className={styles.empty}>No closed trades yet — analytics will populate after the first exits.</div>;
  }

  const cell: CSSProperties = { padding: '6px 10px', textAlign: 'left' };
  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div>
        <h3 style={{ margin: '0 0 8px' }}>Performance by Market Regime</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr style={{ color: '#aaa' }}>
            <th style={cell}>Regime</th><th style={cell}>Trades</th><th style={cell}>Win Rate</th><th style={cell}>Avg PnL</th>
          </tr></thead>
          <tbody>
            {Object.entries(report.byRegime).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #2a2a2a' }}>
                <td style={cell}>{k}</td><td style={cell}>{v.trades}</td>
                <td style={{ ...cell, color: v.winRate >= 50 ? '#2ecc71' : '#e74c3c' }}>{pct(v.winRate)}</td>
                <td style={{ ...cell, color: v.avgPnlPct >= 0 ? '#2ecc71' : '#e74c3c' }}>{pct(v.avgPnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px' }}>Performance by Signal Quality</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr style={{ color: '#aaa' }}>
            <th style={cell}>Quality</th><th style={cell}>Trades</th><th style={cell}>Win Rate</th><th style={cell}>Avg PnL</th>
          </tr></thead>
          <tbody>
            {Object.entries(report.byQualityBucket).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #2a2a2a' }}>
                <td style={cell}>{k}</td><td style={cell}>{v.trades}</td>
                <td style={{ ...cell, color: v.winRate >= 50 ? '#2ecc71' : '#e74c3c' }}>{pct(v.winRate)}</td>
                <td style={{ ...cell, color: v.avgPnlPct >= 0 ? '#2ecc71' : '#e74c3c' }}>{pct(v.avgPnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px' }}>Factor Edge (win avg − loss avg)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr style={{ color: '#aaa' }}>
            <th style={cell}>Factor</th><th style={cell}>Win Avg</th><th style={cell}>Loss Avg</th><th style={cell}>Edge</th>
          </tr></thead>
          <tbody>
            {report.factorEdge.map((f) => (
              <tr key={f.factor} style={{ borderTop: '1px solid #2a2a2a' }}>
                <td style={cell}>{f.factor}</td>
                <td style={cell}>{f.avgWin.toFixed(2)}</td>
                <td style={cell}>{f.avgLoss.toFixed(2)}</td>
                <td style={{ ...cell, color: f.edge >= 0 ? '#2ecc71' : '#e74c3c' }}>{f.edge >= 0 ? '+' : ''}{f.edge.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>
          Positive edge = the factor predicts winners → consider raising its weight in strategy-config. Negative = lower it.
        </p>
      </div>
    </div>
  );
}
