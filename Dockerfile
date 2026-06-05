# ---------------------------------------------
# AlpacaBot -- Railway/Docker image
#
# Stage 1: Install deps from deploy/package.json (vite + react)
#         Build React dashboard via deploy/vite.config.js
#         Compile TypeScript backend via deploy/tsconfig.build.json
# Stage 2: Lean runtime image
# ---------------------------------------------

FROM node:20-alpine AS builder
WORKDIR /app

# 1. Instaleaza dep-urile de build din deploy/package.json
#    (vite, @vitejs/plugin-react, react, react-dom,
#     react-router-dom, recharts, typescript)
COPY deploy/package.json ./deploy/
RUN cd deploy && npm install

# 2. Copiaza sursele
COPY deploy ./deploy
COPY alpaca-trader/trader-dashboard ./alpaca-trader/trader-dashboard
COPY alpaca-trader/trader-service ./alpaca-trader/trader-service

# 3. Build React dashboard --> deploy/public/
#    deploy/vite.config.js are: root: '../alpaca-trader/trader-dashboard'
RUN cd deploy && npx vite build --config vite.config.js

# 4. Compileaza TypeScript backend --> deploy/dist/
RUN cd deploy && npx tsc --project tsconfig.build.json || true

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/deploy ./
RUN npm install --omit=dev
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "server.js"]
