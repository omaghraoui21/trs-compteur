FROM node:20-slim AS base
RUN npm install -g pnpm@9

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/db/ packages/db/
COPY packages/engine/ packages/engine/
COPY packages/api/ packages/api/

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npx", "tsx", "packages/api/src/server.ts"]
