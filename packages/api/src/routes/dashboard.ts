import { Router } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { sessions, lotEntries, sessionEvents, downtimeEvents } from "@trs/db";
import { computeLotTrs, computeSessionTrs, computeZoomTrs } from "@trs/engine";

import { authenticate } from "../middleware";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// ─── Zoom TRS: compute TRS for a date range ──────────────────

dashboardRouter.get("/trs", async (req, res) => {
  const { db } = req;
  const { equipmentId, from, to } = req.query;

  if (!equipmentId || !from || !to) {
    res.status(400).json({ error: "equipmentId, from, to requis" });
    return;
  }

  const closedSessions = await db.select().from(sessions)
    .where(and(
      eq(sessions.equipmentId, equipmentId as string),
      eq(sessions.status, "closed"),
      gte(sessions.sessionDate, from as string),
      lte(sessions.sessionDate, to as string),
    ))
    .orderBy(sessions.sessionDate);

  const sessionResults = [];
  for (const session of closedSessions) {
    // Get planned stops
    const events = await db.select().from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.isPlanned, true)));
    const plannedStopsMin = events.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

    // Get lots + downtimes
    const lots = await db.select().from(lotEntries)
      .where(eq(lotEntries.sessionId, session.id));

    const lotResults = [];
    for (const lot of lots) {
      const dts = await db.select().from(downtimeEvents).where(eq(downtimeEvents.lotEntryId, lot.id));
      const lotTrs = computeLotTrs({
        cadence: Number(lot.cadenceUsed),
        cadenceUnit: lot.cadenceUnit as "u/h" | "u/min",
        produced: lot.quantityProduced,
        conforming: lot.quantityConforming,
        startedAt: lot.startedAt,
        endedAt: lot.endedAt ?? session.closedAt!,
        downtimes: dts.map(d => ({ durationMinutes: d.durationMinutes, isPlanned: false })),
      });
      if (lotTrs) {
        lotResults.push({ ...lotTrs, produced: lot.quantityProduced, conforming: lot.quantityConforming });
      }
    }

    const sessionTrs = computeSessionTrs({
      openedAt: session.openedAt,
      closedAt: session.closedAt!,
      plannedStopsMin,
      lots: lotResults,
    });

    sessionResults.push({ date: session.sessionDate, ...sessionTrs });
  }

  const zoom = computeZoomTrs({ sessions: sessionResults });

  res.json({
    period: { from, to, equipmentId },
    daily: sessionResults,
    total: zoom,
  });
});

// ─── Pending lots for supervisor validation ───────────────────

dashboardRouter.get("/pending-lots", async (req, res) => {
  const { db } = req;
  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.status, "closed"))
    .orderBy(desc(lotEntries.endedAt));
  res.json(lots);
});
