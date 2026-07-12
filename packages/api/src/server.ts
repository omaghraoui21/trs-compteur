import "dotenv/config";
import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@trs/db";
import { seedIfEmpty } from "./lib/seed";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { lotsRouter } from "./routes/lots";
import { refRouter } from "./routes/ref";
import { dashboardRouter } from "./routes/dashboard";
import { adminRouter } from "./routes/admin";
import { maintenanceRouter } from "./routes/maintenance";
import { eventsRouter } from "./routes/events";
import { alertsRouter } from "./routes/alerts";
import { HttpError, asyncHandler } from "./lib/http";
import type { Request, Response, NextFunction } from "express";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
  });
}

const app = express();

// Trust Railway/Vercel reverse proxy so X-Forwarded-For is available for rate limiting
app.set("trust proxy", 1);

// H5: Security headers
app.use(helmet());

// C3: Restrict CORS to the declared frontend origin. In production we never
// fall back to "*": an unset ALLOWED_ORIGIN means same-origin only (the SPA is
// served by this same server), which is the safe default for pharma data.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
const isProd = process.env.NODE_ENV === "production";
if (isProd && !allowedOrigin) {
  console.warn("[cors] ALLOWED_ORIGIN not set in production — CORS restricted to same-origin only.");
}
app.use(cors({ origin: allowedOrigin || (isProd ? false : "*") }));

// Explicit body-size limit (defends against oversized-payload abuse)
app.use(express.json({ limit: "1mb" }));

// Rate limiters are disabled under test: the integration suite drives many
// auth/API calls from a single IP (127.0.0.1) and would otherwise trip the
// limits, so the limiters themselves are infra config, not under test.
const isTest = process.env.NODE_ENV === "test";

// H3: Brute-force protection on auth (10 attempts / 15 min per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans 15 minutes" },
  skip: () => isTest,
});

// Global API rate limiter — protects heavy dashboard/aggregation queries from DoS.
// 500 req/15 min accommodates multiple operators on the same shop-floor IP while
// blocking runaway clients.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, réessayez dans quelques minutes" },
  skip: (req) => isTest || req.path === "/health",
});

const db = createDb();

// Run pending Drizzle migrations on startup — but only in Railway/Docker where
// the process is long-lived and this runs once per deploy.
// On Vercel, migrations run at build time (scripts/migrate.ts → db/migrate.mjs)
// so each cold-start function invocation is not blocked by a DB round-trip.
// Running migrate() inside a Vercel handler causes parallel cold-start timeouts
// because Promise.all fires 3 simultaneous requests, each spawning a fresh
// function instance that races to migrate the same already-migrated DB.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ?? path.resolve(__dirname, "../../db/drizzle");

if (!process.env.VERCEL) {
  try {
    if (existsSync(MIGRATIONS_DIR)) {
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      console.log("✓ Database migrations applied");
      await seedIfEmpty(db);
    }
  } catch (err) {
    console.error("Migration/seed failed:", err);
    // Do not crash — let the health check surface the issue
  }
}

// Inject db into request
app.use((req, _res, next) => {
  req.db = db;
  next();
});

// Broad API rate limiter applied first, then per-endpoint guards.
app.use("/api/", apiLimiter);
// Brute-force protection guards the password endpoint only; /refresh and /logout
// present high-entropy tokens and must not be throttled (busy shop floor shares one IP).
app.use("/api/auth/login", authLimiter);
app.use("/api/events", eventsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/lots", lotsRouter);
app.use("/api/ref", refRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/admin", adminRouter);
app.use("/api/maintenance", maintenanceRouter);

// C2: Real health check — actually pings the DB so monitors see real status
app.get("/api/health", asyncHandler(async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok", version: "1.0.0", db: "connected" });
  } catch (err) {
    console.error("Health check DB failure:", err);
    res.status(503).json({ status: "error", version: "1.0.0", db: "disconnected" });
  }
}));

// Explicit API 404 — prevents unmatched /api/* paths from falling through to the SPA.
app.use("/api/", (_req, res) => {
  res.status(404).json({ error: "Ressource introuvable" });
});

// Serve the React SPA when STATIC_ROOT is set (Railway/Docker single-service mode).
// API routes above take precedence; everything else falls through to index.html.
const STATIC_ROOT = process.env.STATIC_ROOT;
if (STATIC_ROOT && existsSync(STATIC_ROOT)) {
  app.use(express.static(STATIC_ROOT));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(STATIC_ROOT, "index.html"));
  });
}

// Sentry error handler — must be registered after all routes and before the
// terminal error handler so it captures unhandled Express errors.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Terminal error handler — keeps failed requests from hanging and returns JSON.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("Unhandled error:", err);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  res.status(500).json({ error: "Erreur serveur" });
});

export { app };

const PORT = process.env.PORT || 3001;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`TRS API running on port ${PORT}`);
  });
}
