import { log } from './logger.js';

/**
 * Risk configuration — controls how much of the account balance each trade can
 * put at risk and the safety limits that stop the bot before a balance is wiped.
 *
 * All sizing is a PERCENTAGE of the live account balance, never a fixed dollar
 * amount. So a $1,000 account risks the same fraction as a $100,000 account and
 * a single trade can only ever lose `riskPerTradePct` of the balance.
 */
/** Mutable risk settings, adjustable at runtime from the dashboard. */
export type RiskSettings = {
  /** Fraction of balance risked per trade (stop-loss distance). e.g. 0.01 = 1%. */
  riskPerTradePct: number;
  /** Max number of simultaneously open positions. */
  maxOpenTrades: number;
  /** Max fraction of balance a single position's notional can use. e.g. 0.2 = 20%. */
  maxNotionalPct: number;
  /** Max fraction of balance allowed as TOTAL exposure across all open trades. */
  maxTotalExposurePct: number;
  /** Daily loss limit — bot auto-pauses when the day's loss exceeds this fraction. */
  dailyMaxLossPct: number;
  /** Hard drawdown stop — bot auto-pauses when equity falls this far below peak. */
  maxDrawdownStopPct: number;
  /** Minimum signal confidence (0-100) required to open a trade. */
  minConfidence: number;
};

/** Conservative defaults — a single trade risks 1% of balance, day capped at 5%. */
const DEFAULTS: RiskSettings = {
  riskPerTradePct: clampNum(process.env.RISK_PER_TRADE, 0.01, 0.001, 0.1),
  maxOpenTrades: clampInt(process.env.MAX_OPEN_TRADES, 5, 1, 20),
  maxNotionalPct: clampNum(process.env.MAX_NOTIONAL_PCT, 0.2, 0.01, 1),
  maxTotalExposurePct: clampNum(process.env.MAX_TOTAL_EXPOSURE_PCT, 0.6, 0.05, 2),
  dailyMaxLossPct: clampNum(process.env.DAILY_MAX_LOSS_PCT, 0.05, 0.005, 0.5),
  maxDrawdownStopPct: clampNum(process.env.MAX_DRAWDOWN_STOP_PCT, 0.15, 0.01, 0.9),
  minConfidence: clampInt(process.env.MIN_CONFIDENCE, 60, 0, 100),
};

function clampNum(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  return Math.round(clampNum(raw, def, min, max));
}

/**
 * Singleton holder of the current risk settings. The paper trader reads from it
 * on every trade, and the dashboard can update it live via the settings API.
 */
export class RiskConfig {
  private settings: RiskSettings = { ...DEFAULTS };

  /** @returns a copy of the current risk settings. */
  get(): RiskSettings {
    return { ...this.settings };
  }

  /**
   * Update one or more risk settings. Values are clamped to safe ranges.
   * @param patch partial settings to apply
   * @returns the updated settings
   */
  update(patch: Partial<RiskSettings>): RiskSettings {
    const s = this.settings;
    if (patch.riskPerTradePct !== undefined) s.riskPerTradePct = clampNum(String(patch.riskPerTradePct), s.riskPerTradePct, 0.001, 0.1);
    if (patch.maxOpenTrades !== undefined) s.maxOpenTrades = clampInt(String(patch.maxOpenTrades), s.maxOpenTrades, 1, 20);
    if (patch.maxNotionalPct !== undefined) s.maxNotionalPct = clampNum(String(patch.maxNotionalPct), s.maxNotionalPct, 0.01, 1);
    if (patch.maxTotalExposurePct !== undefined) s.maxTotalExposurePct = clampNum(String(patch.maxTotalExposurePct), s.maxTotalExposurePct, 0.05, 2);
    if (patch.dailyMaxLossPct !== undefined) s.dailyMaxLossPct = clampNum(String(patch.dailyMaxLossPct), s.dailyMaxLossPct, 0.005, 0.5);
    if (patch.maxDrawdownStopPct !== undefined) s.maxDrawdownStopPct = clampNum(String(patch.maxDrawdownStopPct), s.maxDrawdownStopPct, 0.01, 0.9);
    if (patch.minConfidence !== undefined) s.minConfidence = clampInt(String(patch.minConfidence), s.minConfidence, 0, 100);
    log.info(`[risk] settings updated: risk/trade ${(s.riskPerTradePct * 100).toFixed(1)}% · maxOpen ${s.maxOpenTrades} · dailyStop ${(s.dailyMaxLossPct * 100).toFixed(1)}% · ddStop ${(s.maxDrawdownStopPct * 100).toFixed(1)}%`);
    return { ...s };
  }
}

let instance: RiskConfig | null = null;

/**
 * Get the singleton risk config.
 * @returns the shared {@link RiskConfig}
 */
export function getRiskConfig(): RiskConfig {
  if (!instance) instance = new RiskConfig();
  return instance;
}
