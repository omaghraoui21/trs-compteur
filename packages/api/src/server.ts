import "dotenv/config";
import express from "express";
import cors from "cors";
import { createDb } from "@trs/db";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { lotsRouter } from "./routes/lots";
import { refRouter } from "./routes/ref";
import { dashboardRouter } from "./routes/dashboard";

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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

export { app };

const PORT = process.env.PORT || 3001;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`TRS API running on port ${PORT}`);
  });
}
