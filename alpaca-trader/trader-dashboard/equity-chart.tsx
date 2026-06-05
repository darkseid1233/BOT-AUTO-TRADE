import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { EquityPoint } from './types.js';
import styles from './trader-dashboard.module.css';

/**
 * Equity-curve area chart.
 * @param props.data equity points over time
 * @param props.startingBalance baseline used to colour gains vs losses
 */
export function EquityChart({ data, startingBalance }: { data: EquityPoint[]; startingBalance: number }) {
  if (!data || data.length < 2) {
    return <div className={styles.empty}>No equity history yet — waiting for the first closed trades.</div>;
  }
  const last = data[data.length - 1].balance;
  const up = last >= startingBalance;
  const color = up ? '#16d39a' : '#ff5470';
  const chartData = data.map((p) => ({ ts: p.ts, balance: Number(p.balance.toFixed(2)) }));

  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#232844" vertical={false} />
          <XAxis
            dataKey="ts"
            tickFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
            stroke="#717795"
            fontSize={11}
          />
          <YAxis
            domain={['auto', 'auto']}
            stroke="#717795"
            fontSize={11}
            width={64}
            tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{ background: '#171c30', border: '1px solid #232844', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(t) => new Date(t as number).toLocaleString('en-GB')}
            formatter={(v: number) => [`$${v.toLocaleString()}`, 'Equity']}
          />
          <Area type="monotone" dataKey="balance" stroke={color} strokeWidth={2} fill="url(#eq)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
