# ─────────────────────────────────────────────────────────────────────────────
# AlpacaBot — Railway/Docker image
#
# Stage 1: Build the React dashboard (static files) + compile TS backend
# Stage 2: Lean runtime image — Node 20 Alpine
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy entire workspace
COPY . .

# ── 1. Build React dashboard → deploy/public/ ─────────────────────────────────
# Install dashboard deps (vite, react, @vitejs/plugin-react) from its own package.json
RUN cd alpaca-trader/trader-dashboard && \
    npm install && \
    npx vite build --outDir ../../deploy/public

# ── 2. Compile TypeScript backend → deploy/dist/ ─────────────────────────────
RUN cd deploy && npm install && npx tsc --project tsconfig.build.json || true

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Only copy the deploy folder (compiled backend + static frontend + server.js)
COPY --from=builder /app/deploy ./

# Install PRODUCTION-only deps (express, node-fetch)
RUN npm install --omit=dev

# Railway injects PORT automatically
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
