import "dotenv/config";
import express from "express";
import cors from "cors";
import { createDb } from "@trs/db";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { lotsRouter } from "./routes/lots";
import { refRouter } from "./routes/ref";
import { dashboardRouter } from "./routes/dashboard";
import { adminRouter } from "./routes/admin";
import { HttpError } from "./lib/http";
import type { Request, Response, NextFunction } from "express";

const app = express();
app.use(cors());
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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

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
