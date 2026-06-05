# 🦙 AlpacaBot — 24/7 Crypto Auto-Trader

A fully automated crypto trading bot with a live React dashboard, built on [Alpaca Markets](https://alpaca.markets/) paper/live trading API. Runs 24/7 on Railway.

![AlpacaBot Dashboard](https://img.shields.io/badge/status-live-brightgreen) ![Railway](https://img.shields.io/badge/hosted-Railway-blueviolet) ![Alpaca](https://img.shields.io/badge/exchange-Alpaca%20Markets-yellow)

---

## ✨ Features

- **Automated signal engine** — EMA crossovers, RSI, ATR-based entries/exits
- **Balance-aware risk management** — 1% per trade, daily loss cap, drawdown stop
- **Paper trading mode** — safe testing without real money (default)
- **Live React dashboard** — equity chart, open positions, trade history, live logs
- **24/7 Railway hosting** — bot runs continuously, no PC required
- **One-click controls** — pause, resume, panic-close all from the dashboard

---

## 🚀 Deploy to Railway in 3 steps

### 1. Fork / clone this repo

```bash
git clone https://github.com/YOUR_USER/alpaca-trader.git
```

### 2. Create a Railway project

1. Go to [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo**
2. Select this repository
3. Railway auto-detects the `Dockerfile`

### 3. Add environment variables in Railway

In your Railway service → **Variables** tab, add:

| Variable | Value | Required |
|---|---|---|
| `ALPACA_API_KEY_ID` | Your Alpaca key ID | ✅ for live trading |
| `ALPACA_API_SECRET_KEY` | Your Alpaca secret | ✅ for live trading |
| `INITIAL_BALANCE` | `100000` | optional (demo only) |
| `RISK_PER_TRADE` | `0.01` | optional |
| `MAX_OPEN_TRADES` | `5` | optional |
| `MIN_CONFIDENCE` | `60` | optional |

> 💡 Without Alpaca credentials, the bot runs in **demo mode** with simulated data.

---

## 🖥️ Local development (Bit workspace)

```bash
# Install Bit
npx @teambit/bvm install

# Install deps
bit install

# Start the platform (frontend + backend)
bit run alpaca-trader
# → Dashboard: http://localhost:3001
# → Gateway:   http://localhost:5000
```

---

## 🏗️ Architecture

```
alpaca-trader/          ← Bit workspace root
├── alpaca-trader/      ← Platform (gateway + orchestrator)
├── trader-service/     ← Express REST API + bot engine
└── trader-dashboard/   ← React + Vite dashboard
deploy/                 ← Railway standalone build
├── server.js           ← Single Express server (API + static files)
├── Dockerfile          ← Multi-stage Docker build
└── tsconfig.build.json ← TypeScript → dist/
```

### Bot engine (trader-service)

| Module | Responsibility |
|---|---|
| `alpaca-client.ts` | Alpaca REST API wrapper (paper + live) |
| `signal-engine.ts` | EMA20/50 crossover + RSI + ATR signal generation |
| `paper-trader.ts` | Position sizing, SL/TP tracking, equity curve |
| `bot.ts` | Scan + tick loops, watchlist management |
| `risk.ts` | Runtime-configurable risk limits |
| `logger.ts` | Ring-buffer in-memory log (polled by dashboard) |

---

## 📊 Dashboard tabs

| Tab | Content |
|---|---|
| Overview | Equity chart, KPI cards, account status |
| Signals | Current signals per symbol (confidence, indicators) |
| Positions | Open trades with live PnL + close button |
| History | Closed trades with realized PnL |
| Risk | Adjust risk settings live |
| Logs | Live bot log stream |

---

## ⚙️ All environment variables

See [`.env.example`](.env.example) for full documentation.

---

## ⚠️ Disclaimer

This bot is for **educational purposes only**. Paper trading is safe — live trading carries real financial risk. Always understand what the bot is doing before enabling live mode.
