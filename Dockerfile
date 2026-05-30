FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm@9

# Install all deps (cached layer — only invalidates when lockfile changes)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Copy all sources and build the web frontend
COPY packages packages
RUN pnpm --filter @trs/web build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm@9

# Copy the entire workspace (preserves pnpm symlinks for workspace packages)
COPY --from=builder /app .

# Path to Drizzle migration SQL files (auto-applied on startup)
ENV MIGRATIONS_DIR=/app/packages/db/drizzle
# Path to the built React app served by Express for non-API routes
ENV STATIC_ROOT=/app/packages/web/dist
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "packages/api/src/server.ts"]
