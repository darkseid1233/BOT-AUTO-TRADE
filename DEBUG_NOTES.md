# 🔍 Full Repo Audit — June 2026

## ✅ What Works Correctly

| Module | Status | Notes |
|--------|--------|-------|
| `alpaca-client.ts` | ✅ | `start` param fixed, pagination with `next_page_token`, synthetic fallback with warning |
| `strategy-config.ts` | ✅ | All thresholds env-overridable, defaults relaxed for bear market |
| `market-regime.ts` | ✅ | ADX + EMA spread + Choppiness Index confluence — solid |
| `signal-engine.ts` | ✅ | 7-gate pipeline, `generateSignals()` wrapper added |
| `signal-quality.ts` | ✅ | Weighted 0-100 scoring with 7 factors |
| `paper-trader.ts` | ✅ | Partial TP L1/L2, trailing stop, fees + slippage model, `totalCosts` |
| `circuit-breaker.ts` | ✅ | Daily/weekly/streak — 3 independent breakers |
| `fear-greed.ts` | ✅ | Extreme Fear threshold lowered to 10 (was 20), cached 30m |
| `scan-stats.ts` | ✅ | Per-gate rejection histogram, cumulative + last-scan |
| `sl-cooldown.ts` | ✅ | In-memory cooldown registry (separate from bot.ts inline maps) |
| `bot.ts` | ✅ | Uses `generateSignal()` directly (engine class removed) |
| `deploy/server.js` | ✅ | All routes present: journal, breaker, backtest, news, scan-stats |
| `trader-service.app-root.ts` | ✅ | Duplicate `/api/news` handler removed |
| `trader-dashboard` | ✅ | Heatmap, position cards, signal grid, scan funnel |

---

## 🐛 Bugs Fixed in This Audit

### 1. `bot.ts` — `SignalEngine` class reference after removal
**Problem:** `bot.ts` imported `SignalEngine` class and called `this.engine.generateSignals()`,
but `SignalEngine` no longer exists as a class (it's now plain `generateSignal()` function exports).
**Fix:** Import `generateSignal` directly, call it in `processSymbol()`.
```diff
- import { SignalEngine } from './signal-engine.js';
+ import { generateSignal, generateSignals } from './signal-engine.js';
- const signal = await this.engine.generateSignals([symbol]).then((s) => s[0]);
+ const signal = await generateSignal(symbol, this.client);
```

### 2. `paper-trader.ts` — mirror close/partial always fires (3 spots)
**Problem:** Partial TP closes and full closes always called `placeMarketOrder` regardless of `ENABLE_MIRROR`.
Only the entry was gated. Caused 403 WARN spam on closes/partials.
**Fix:** All 3 mirror call sites now wrapped in `if (process.env.ENABLE_MIRROR === 'true')`.

### 3. `trader-service.app-root.ts` — duplicate `/api/news` route
**Problem:** Two `app.get('/api/news', ...)` handlers registered — the first (dynamic import)
shadowed the second (clean service call). Express uses first-match, so the cleaner handler never ran.
**Fix:** Removed the dynamic-import version, kept the `service.getNews(limit)` one.

### 4. `signal-engine.ts` — `generateSignals()` wrapper missing
**Problem:** `bot.ts` called `this.engine.generateSignals([symbol])` but that method didn't exist
on the function-based signal engine.
**Fix:** Added explicit `generateSignals(symbols, client, btcStateOverride?)` wrapper.

---

## ⚠️ Known Limitations (Not Bugs — Design Choices)

### A. `sl-cooldown.ts` vs `bot.ts` inline cooldowns — DUAL STATE
Both `sl-cooldown.ts` (module-level Map) and `bot.ts` (`this.slCooldowns`) track cooldowns
independently. `paper-trader.ts` imports from `sl-cooldown.ts` but `bot.ts` uses its own Map.
**Risk:** Double-counting or inconsistency if both run.
**Recommendation:** Pick ONE source of truth. Either:
  - Delete `sl-cooldown.ts` and route everything through `bot.ts` instance methods, OR
  - Move bot.ts inline cooldowns to `sl-cooldown.ts` module (module-level singleton)
**Current state:** Non-fatal — both are additive protection, but adds confusion.

### B. `BotStats.totalCosts` optional in dashboard `types.ts`
`totalCosts?: number` (optional) in dashboard but required in service `types.ts`.
Dashboard shows `—` when undefined, which is fine but not typed correctly.
**Fix (minor):** Make it `totalCosts: number` in `trader-dashboard/types.ts`.

### C. SQLite journal in-memory only on Railway
`[journal-db] SQLite unavailable, using in-memory only: require is not defined`
This is expected — Railway ESM context can't use `require()` for better-sqlite3.
Trade history resets on redeploy. Not a bug, but means no persistent trade log.
**Recommendation:** Add MongoDB via `MONGO_URL` env for persistent journal.

### D. `AVAX/LINK/DOGE` `Volume 0.00x` — zero volume bars
Alpaca returns bars with `v=0` for these symbols during off-peak hours.
`volumeRatio()` divides by the 20-bar average — if all bars have v=0, ratio=NaN → treated as 0x.
**Fix:** Add a guard: `if (avg === 0) return 1` (neutral volume, don't block).
Currently they're correctly blocked (you don't want to trade on zero-volume bars).

### E. `BASE_PRICES` in `alpaca-client.ts` — stale synthetic prices
`'BTC/USD': 64000` but actual BTC is ~60k. Minor — synthetic bars only used as fallback.
Not a real issue since real bars are fetched first.

---

## 📊 Current Filter State (Railway env vars to restore strict mode)

```bash
# CURRENT (bear market relaxed):
ADX_TREND_THRESHOLD=18      # was 22
RSI_LATE_ENTRY_GUARD=80     # was 72 → SHORT blocked only at RSI < 20
MIN_VOLUME_RATIO=0.35       # was 0.8
MIN_SIGNAL_QUALITY=58       # was 70
FG_EXTREME_FEAR=10          # was 20 (LONGs blocked only below 10)
MIN_RR_NET=1.5              # was 1.8
EMA_TREND_SPREAD_PCT=0.05   # was 0.1

# TO RESTORE STRICT (when F&G > 40, ADX > 25 for 3+ days):
ADX_TREND_THRESHOLD=22
RSI_LATE_ENTRY_GUARD=72
MIN_VOLUME_RATIO=0.8
MIN_SIGNAL_QUALITY=70
FG_EXTREME_FEAR=20
MIN_RR_NET=1.8
EMA_TREND_SPREAD_PCT=0.1
```

---

## 🚀 Production Checklist (Railway)

- [ ] `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` set
- [ ] `ENABLE_MIRROR` not set (default OFF — paper only)  
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for alerts
- [ ] `DISCORD_WEBHOOK_URL` for Discord alerts
- [ ] Optional: `MONGO_URL` for persistent trade journal
- [ ] Optional: `WATCHLIST=BTC/USD,ETH/USD,SOL/USD,...` override
- [ ] Optional: Tighten filter env vars as market recovers

---

## 🧪 Test Coverage

| File | Tests | Coverage |
|------|-------|----------|
| `indicators.spec.ts` | ema, sma, rsi, atr, macd, bollinger | Core math |
| `paper-trader.spec.ts` | open, L1/L2 TP, SL, fees | Position lifecycle |
| `market-regime.spec.ts` | TRENDING_BULL/BEAR/RANGING | Regime detection |
| `scan-stats.spec.ts` | recordGate, beginScan, endScan | Telemetry |

Run tests (after compiling): `cd alpaca-trader/trader-service && npx vitest`
</content>
</invoke>
<invoke name="workspace_run_command">
<parameter name="command">grep -n "SignalEngine\|this\.engine\." .repos/darkseid1233/BOT-AUTO-TRADE/alpaca-trader/trader-service/bot.ts | head -20