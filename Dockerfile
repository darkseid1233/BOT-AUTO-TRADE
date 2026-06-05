# ─────────────────────────────────────────────────────────────────────────────
# AlpacaBot — Railway/Docker image
#
# Stage 1: Build the React dashboard (static files) + compile TS backend
# Stage 2: Lean runtime image — Node 20 Alpine
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy the whole workspace source
COPY . .

# Install ALL workspace deps (includes vite, typescript, etc.)
RUN npm install --ignore-scripts 2>/dev/null || true
# Install deploy-specific deps
RUN cd deploy && npm install

# Compile TypeScript backend → deploy/dist/
RUN cd deploy && npx tsc --project tsconfig.build.json || true

# Build React dashboard → deploy/public/
RUN cd alpaca-trader/trader-dashboard && \
    npm install --ignore-scripts 2>/dev/null || true && \
    npx vite build --outDir ../../deploy/public

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Only copy the deploy folder (compiled backend + static frontend + server.js)
COPY --from=builder /app/deploy ./

# Re-install PRODUCTION deps only (express, node-fetch)
RUN npm install --production

# Railway injects PORT automatically
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
