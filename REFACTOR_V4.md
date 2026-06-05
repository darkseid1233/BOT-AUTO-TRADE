# BOT-AUTO-TRADE — Refactor v4 (Regime-First, Weighted Quality, Multi-Timeframe)

Inspirat din ideile din `bcj2023`, adaptat la arhitectura Alpaca a BOT-AUTO-TRADE.
**Nicio linie nu a fost copiată** — au fost preluate mecanismele bune și re-implementate.

---

## 1. Probleme identificate în BOT-AUTO-TRADE (și de ce sunt slabe)

| # | Problemă | De ce e slabă |
|---|----------|----------------|
| 1 | **RSI folosit contrar trendului** | Cumpăra „oversold" în downtrend → fade-uri cu probabilitate mică, drawdown mare |
| 2 | **Bollinger Bands agresiv în trend** | În trend puternic prețul „merge pe bandă"; fade-ul pe BB pierde sistematic |
| 3 | **StochRSI fără context de piață** | Semnal de reversal folosit fără să știe dacă piața e trending sau ranging |
| 4 | **Scoring „count points / 12"** | Plat, neponderat — un semnal slab pe 7 factori egalează unul puternic pe 3 |
| 5 | **Lipsă confirmare HTF reală** | `trend1h: 'pending'` — 1H nu intra efectiv în scor, doar ca risk-multiplier post-factum |
| 6 | **Lipsă evaluare calitate semnal** | Nu exista un scor 0-100 comparabil între simboluri pentru prioritizare |
| 7 | **Praguri hardcodate** | Re-tuning imposibil fără editare de cod |

## 2. Soluția — fluxul v4 (fiecare poartă poate respinge)

```
15m bars
   |
   v
(1) MARKET REGIME --> allowedSide (LONG doar in BULL, SHORT doar in BEAR; RANGING/HIGH_VOL = NO TRADE)
   |                  confluenta: ADX + EMA50/200(spread) + Choppiness + ATR-veto
   v
(2) VOLUME GATE ----> volum relativ >= minVolumeRatio
   v
(3) RSI LATE-ENTRY -> nu urmarim miscari epuizate (RSI > 72 blocheaza LONG tarziu)
   v
(4) BTC STATE ------> BTC 1H bullish/bearish (strong opposing = block; altfel intra in scor)
   v
(5) HTF 1H ---------> EMA50/200 + ADX pe 1H: aligned / opposed / neutral
   v
(6) SIGNAL QUALITY -> Weighted Scoring 0-100 (7 factori) >= minSignalQuality
   v
(7) NET R:R --------> (TP - costuri) / (SL + costuri) >= minRiskReward (dupa fee+slippage)
   v
OPEN TRADE --> Trade Journal (regime, quality, factori) --> Analytics
```

## 3. Weighted Scoring System — Signal Quality Score (0-100)

7 factori, fiecare normalizat 0..1 x greutate (suma = 100). **Toti directionali**: un factor
conteaza DOAR cand confirma directia dictata de regim (niciodata contrarian).

| Factor | Greutate | Sursa |
|--------|----------|-------|
| Trend Strength | 25 | ADX scalat + stack EMA 20>50>200 |
| HTF Alignment | 20 | Trend 1H confirma side-ul |
| Market Structure | 15 | Smart Money (BOS + structura + liquidity sweep) |
| Volume Confirmation | 15 | volum relativ vs media 20 bare |
| Momentum | 10 | RSI/MACD/StochRSI aliniate cu side-ul |
| BTC Correlation | 10 | macro BTC sustine side-ul |
| Volatility | 5 | regim ATR (NORMAL ideal) |

Toate greutatile si pragurile sunt in `strategy-config.ts`, override-abile prin env.

## 4. Fisiere noi

| Fisier | Rol |
|--------|-----|
| `strategy-config.ts` | Single source of truth — gates, greutati, per-coin tuning (env-overridable) |
| `market-regime.ts` | Market Regime Detection — decide singura directie permisa |
| `btc-state.ts` | BTC Market State Analysis (1H, cache 5 min) |
| `htf-confirm.ts` | Confirmare multi-timeframe reala pe 1H |
| `signal-quality.ts` | Weighted Scoring System -> Signal Quality 0-100 |
| `signal-engine.ts` | **rescris** — fluxul v4 regime-first |
| `trade-journal.ts` | Trade Journal complet + analytics (by regime / quality / factor edge) |
| `backtest.ts` | Backtesting Engine (no look-ahead) + Walk-Forward + Performance Metrics |

Fisiere modificate: `types.ts`, `paper-trader.ts` (journal + per-coin size), `trader-service.ts`
+ `trader-service.app-root.ts` (endpoints `/api/journal`, `/api/journal/report`, `/api/backtest/:symbol`),
dashboard (`analytics-panel.tsx`, badge Signal Quality, tab Analytics).

## 5. Parametri recomandati (default in config)

```
MIN_SIGNAL_QUALITY=70      ADX_TREND_THRESHOLD=22     CHOP_RANGING_THRESHOLD=61.8
MIN_VOLUME_RATIO=0.8       MIN_RR_NET=1.8             RSI_LATE_ENTRY_GUARD=72
ATR_SL_MULTIPLIER=1.8      ATR_TP_MULTIPLIER=4.5      EXTREME_VOL_RATIO=2.5
W_TREND_STRENGTH=25  W_HTF_ALIGNMENT=20  W_MARKET_STRUCTURE=15
W_VOLUME=15  W_MOMENTUM=10  W_BTC_CORRELATION=10  W_VOLATILITY=5
```

Conservator (mai putine trade-uri, calitate mai mare): `MIN_SIGNAL_QUALITY=78`, `MIN_RR_NET=2.0`.
Agresiv (mai multe semnale): `MIN_SIGNAL_QUALITY=62`, `ADX_TREND_THRESHOLD=20`.

## 6. Impact estimat (a se valida cu Backtest + Walk-Forward)

| Metrica | Inainte | Estimat dupa | De ce |
|---------|---------|--------------|-------|
| Win rate | baseline | **+8-18%** | zero trade-uri contra-trend / in ranging |
| Profit Factor | ~1.0-1.3 | **1.5-2.0** | net R:R real >= 1.8 + prioritizare calitate |
| Max Drawdown | baseline | **-20-35%** | gate macro BTC + veto volatilitate extrema |
| Nr. semnale | baseline | **-40-60%** | strict, dar de calitate mai mare |

> Estimarile sunt directionale. Ruleaza `GET /api/backtest/BTC/USD?walk=true` pe fiecare simbol
> ca sa confirmi empiric pe datele tale inainte de live.

## 7. Avantaje / Dezavantaje

**Avantaje:** elimina tranzactiile contra-trend; mai putine semnale false; filtreaza lateralul;
prioritizeaza probabilitate ridicata; tunabil fara cod; journal + backtest pentru decizii pe date.

**Dezavantaje:** mai putine trade-uri (poate frustra in piete foarte agitate); in trend puternic
fara pullback rateaza unele intrari; depinde de calitatea datelor 1H/BTC de la Alpaca.
