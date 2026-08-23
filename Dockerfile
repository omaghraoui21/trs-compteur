FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@9

# Install deps (cached layer)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Copy sources
COPY packages packages
COPY scripts scripts

# Build React SPA and bundle API with esbuild
RUN pnpm --filter @trs/web build
RUN node scripts/build-api.mjs

# ── Production image (no node_modules needed — esbuild bundle is self-contained) ──
FROM node:20-slim
WORKDIR /app

# Self-contained API bundle (esbuild — all JS dependencies inlined)
COPY --from=builder /app/api/handler.mjs ./api/handler.mjs

# Drizzle migration SQL files (read at runtime by drizzle migrate())
COPY --from=builder /app/packages/db/drizzle ./db/drizzle

# Built React SPA served by Express for all non-/api routes
COPY --from=builder /app/packages/web/dist ./web/dist

ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/db/drizzle
ENV STATIC_ROOT=/app/web/dist
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "api/handler.mjs"]
