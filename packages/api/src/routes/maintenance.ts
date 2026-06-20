import { Router } from "express";
import type { Request } from "express";
import { and, lt, or, isNotNull } from "drizzle-orm";
import { refreshTokens } from "@trs/db";
import { asyncHandler } from "../lib/http";

export const maintenanceRouter = Router();

// Accepts both Vercel cron (GET, Authorization: Bearer CRON_SECRET)
// and manual triggers (POST or GET, X-Maintenance-Secret: <MAINTENANCE_SECRET>).
function isAuthorized(req: Request): boolean {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.authorization === `Bearer ${cron}`) return true;
  const manual = process.env.MAINTENANCE_SECRET;
  if (manual && req.headers["x-maintenance-secret"] === manual) return true;
  return false;
}

const cleanupHandler = asyncHandler(async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }

  const { db } = req;
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86_400_000);

  // Delete tokens that are:
  //   a) expired (expiresAt < now), OR
  //   b) revoked for more than 24 h (revokedAt < 24 h ago)
  // The 24-hour buffer preserves recently-rotated tokens so that the grace-window
  // reuse detection in /refresh still has the revoked row to compare against.
  const deleted = await db.delete(refreshTokens).where(
    or(
      lt(refreshTokens.expiresAt, now),
      and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, oneDayAgo)),
    ),
  ).returning({ id: refreshTokens.id });
  console.log(`[maintenance] cleanup-tokens: deleted ${deleted.length} rows`);
  res.json({ ok: true, deleted: deleted.length });
});

maintenanceRouter.get("/cleanup-tokens", cleanupHandler);
maintenanceRouter.post("/cleanup-tokens", cleanupHandler);
