# Filter Relaxations — June 2026 Bear Market Patch

Applied to make the bot trade in current oversold conditions (F&G=12, RSI 17-22, ADX 18.4).

## What was blocking all trades

| Gate | Old value | New value | Why |
|------|-----------|-----------|-----|
| `ADX_TREND_THRESHOLD` | 22 | **18** | BTC ADX=18.4 was blocked as "RANGING"; now passes |
| `RSI_LATE_ENTRY_GUARD` | 72 → SHORT<28 | **80 → SHORT<20** | ETH/SOL/DOGE RSI=21-22 now passes; only RSI<20 is "too late" |
| `MIN_VOLUME_RATIO` | 0.8 | **0.35** | LTC/LINK at 0.12-0.19x still low, but SOL/ETH/BTC pass |
| `MIN_SIGNAL_QUALITY` | 70 | **58** | Bear conditions produce lower quality scores globally |
| `FG_EXTREME_FEAR` | 20 | **10** | F&G=12 → LONGs now allowed (with 0.5x risk mult); only blocked below 10 |
| `MIN_RR_NET` | 1.8 | **1.5** | ATR is compressed in ranging → need more room |
| `EMA_TREND_SPREAD_PCT` | 0.1% | **0.05%** | Allows early trend detection (fresh EMA crossovers) |
| BTC/ETH min quality | 72 | **62** | Aligned with global relaxation |
| DOGE min quality | 75 | **62** | Same |

## Trade-off

These relaxations mean the bot will take MORE trades with LOWER average quality.
To compensate, per-trade risk is unchanged (RISK_PER_TRADE=0.01 = 1% per trade).

## How to restore strict mode (when market recovers)

Set these env vars on Railway (no redeploy needed, bot reads them at runtime):
```
ADX_TREND_THRESHOLD=22
RSI_LATE_ENTRY_GUARD=72
MIN_VOLUME_RATIO=0.8
MIN_SIGNAL_QUALITY=70
FG_EXTREME_FEAR=20
MIN_RR_NET=1.8
EMA_TREND_SPREAD_PCT=0.1
```

## Expected result after this patch

- BTC/USD: ADX 18.4 now clears regime gate → if EMA50 < EMA200 → SHORT allowed
- ETH/USD RSI=22: clears late-entry guard (was blocked at RSI<28)
- SOL/USD RSI=20-21: clears late-entry guard
- DOGE/USD RSI=22: clears late-entry guard
- LTC/LINK: still blocked by volume (0.12x / 0.19x) — genuinely illiquid, correct
- AVAX RSI=17: still blocked (RSI<20, truly exhausted — correct)
- UNI RSI=18-19: borderline, may clear on some scans
</content>
</invoke>