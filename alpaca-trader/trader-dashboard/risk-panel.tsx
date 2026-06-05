import { useState, useEffect } from 'react';
import { updateRisk } from './use-bot-api.js';
import type { RiskSettings } from './types.js';
import styles from './trader-dashboard.module.css';

/** A single percentage slider row bound to a risk field. */
function PctRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={styles.riskRow}>
      <div className={styles.riskRowTop}>
        <span className={styles.riskLabel}>{label}</span>
        <span className={styles.riskValue}>{(value * 100).toFixed(value < 0.01 ? 1 : 0)}%</span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.riskHint}>{hint}</span>
    </div>
  );
}

/**
 * Risk-management panel. Lets the user tune position sizing and the safety
 * stops that protect the account balance, then save them to the bot.
 *
 * @param props.risk current risk settings from the service
 * @param props.balance current account balance (for the example calculation)
 * @param props.onSaved callback after settings are saved
 */
export function RiskPanel({
  risk,
  balance,
  onSaved,
}: {
  risk: RiskSettings | null;
  balance: number;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RiskSettings | null>(risk);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (risk && !draft) setDraft(risk);
  }, [risk, draft]);

  if (!draft) {
    return <div className={styles.empty}>Loading risk settings…</div>;
  }

  const set = (patch: Partial<RiskSettings>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateRisk(draft);
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const riskDollars = balance * draft.riskPerTradePct;
  const dailyDollars = balance * draft.dailyMaxLossPct;

  return (
    <div className={styles.cardBody}>
      <div className={styles.riskExample}>
        With a balance of <strong>${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>,
        each trade risks at most <strong className={styles.short}>${riskDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>,
        and the bot auto-pauses after a daily loss of <strong className={styles.short}>${dailyDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>.
        Your balance can never be lost in a single trade.
      </div>

      <div className={styles.riskGrid}>
        <PctRow
          label="Risk per trade"
          hint="Max loss on any single trade (stop-loss)."
          value={draft.riskPerTradePct}
          min={0.001}
          max={0.1}
          step={0.001}
          onChange={(v) => set({ riskPerTradePct: v })}
        />
        <PctRow
          label="Max position size"
          hint="Largest notional one trade can use."
          value={draft.maxNotionalPct}
          min={0.01}
          max={1}
          step={0.01}
          onChange={(v) => set({ maxNotionalPct: v })}
        />
        <PctRow
          label="Total exposure cap"
          hint="Max combined size of all open trades."
          value={draft.maxTotalExposurePct}
          min={0.05}
          max={2}
          step={0.05}
          onChange={(v) => set({ maxTotalExposurePct: v })}
        />
        <PctRow
          label="Daily loss limit"
          hint="Auto-pause when the day's loss hits this."
          value={draft.dailyMaxLossPct}
          min={0.005}
          max={0.5}
          step={0.005}
          onChange={(v) => set({ dailyMaxLossPct: v })}
        />
        <PctRow
          label="Max drawdown stop"
          hint="Auto-pause when equity drops this far from its peak."
          value={draft.maxDrawdownStopPct}
          min={0.01}
          max={0.9}
          step={0.01}
          onChange={(v) => set({ maxDrawdownStopPct: v })}
        />
        <div className={styles.riskRow}>
          <div className={styles.riskRowTop}>
            <span className={styles.riskLabel}>Min confidence</span>
            <span className={styles.riskValue}>{draft.minConfidence}/100</span>
          </div>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            step={1}
            value={draft.minConfidence}
            onChange={(e) => set({ minConfidence: Number(e.target.value) })}
          />
          <span className={styles.riskHint}>Only trade signals at or above this score.</span>
        </div>
        <div className={styles.riskRow}>
          <div className={styles.riskRowTop}>
            <span className={styles.riskLabel}>Max open trades</span>
            <span className={styles.riskValue}>{draft.maxOpenTrades}</span>
          </div>
          <input
            className={styles.slider}
            type="range"
            min={1}
            max={20}
            step={1}
            value={draft.maxOpenTrades}
            onChange={(e) => set({ maxOpenTrades: Number(e.target.value) })}
          />
          <span className={styles.riskHint}>How many positions can be open at once.</span>
        </div>
      </div>

      <div className={styles.modalActions}>
        {saved && <span className={styles.okText}>✅ Saved</span>}
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save risk settings'}
        </button>
      </div>
    </div>
  );
}
