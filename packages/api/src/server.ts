import "dotenv/config";
import express from "express";
import cors from "cors";
import { sql } from "drizzle-orm";
import { createDb } from "@trs/db";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { lotsRouter } from "./routes/lots";
import { refRouter } from "./routes/ref";
import { dashboardRouter } from "./routes/dashboard";
import { adminRouter } from "./routes/admin";
import { HttpError, asyncHandler } from "./lib/http";
import type { Request, Response, NextFunction } from "express";

const app = express();

// C3: Restrict CORS to the declared frontend origin in production
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({ origin: allowedOrigin || "*" }));

app.use(express.json());

const db = createDb();

// Inject db into request
app.use((req, _res, next) => {
  (req as any).db = db;
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/lots", lotsRouter);
app.use("/api/ref", refRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/admin", adminRouter);

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

// Terminal error handler — keeps failed requests from hanging and returns JSON.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Erreur serveur" });
});

export { app };

const PORT = process.env.PORT || 3001;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`TRS API running on port ${PORT}`);
  });
}
