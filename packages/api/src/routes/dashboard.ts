import { Router } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { sessions, lotEntries, sessionEvents, downtimeEvents, downtimeCategories, equipments, products } from "@trs/db";
import { computeLotTrs, computeSessionTrs, computeZoomTrs } from "@trs/engine";

import { authenticate } from "../middleware";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// ─── Helper: build lot TRS results with famille ───────────────

async function buildSessionTrs(db: any, session: any) {
  const events = await db.select().from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.isPlanned, true)));
  const plannedStopsMin = events.reduce((s: number, e: any) => s + (e.durationMinutes ?? 0), 0);

  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.sessionId, session.id));

  const lotDetails: any[] = [];
  const lotResults: any[] = [];

  for (const lot of lots) {
    const dts = await db.select({
      id: downtimeEvents.id,
      durationMinutes: downtimeEvents.durationMinutes,
      categoryId: downtimeEvents.categoryId,
      comment: downtimeEvents.comment,
      categoryCode: downtimeCategories.code,
      categoryLabel: downtimeCategories.label,
      famille: downtimeCategories.famille,
      isPlanned: downtimeCategories.isPlanned,
    }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .where(eq(downtimeEvents.lotEntryId, lot.id));

    const lotTrs = computeLotTrs({
      cadence: Number(lot.cadenceUsed),
      cadenceUnit: lot.cadenceUnit as "u/h" | "u/min",
      produced: lot.quantityProduced,
      conforming: lot.quantityConforming,
      startedAt: lot.startedAt,
      endedAt: lot.endedAt ?? session.closedAt!,
      downtimes: dts.map((d: any) => ({
        durationMinutes: d.durationMinutes,
        isPlanned: d.isPlanned,
        famille: d.famille,
      })),
    });

    // Get product info for this lot
    const [product] = await db.select().from(products).where(eq(products.id, lot.productId)).limit(1);

    if (lotTrs) {
      lotResults.push({ ...lotTrs, produced: lot.quantityProduced, conforming: lot.quantityConforming });
      lotDetails.push({
        lotId: lot.id,
        batchNumber: lot.batchNumber,
        productName: product?.name ?? "",
        productCode: product?.code ?? "",
        cadenceUsed: Number(lot.cadenceUsed),
        cadenceUnit: lot.cadenceUnit,
        quantityProduced: lot.quantityProduced,
        quantityConforming: lot.quantityConforming,
        quantityRejected: lot.quantityRejected,
        ...lotTrs,
      });
    }
  }

  const sessionTrs = computeSessionTrs({
    openedAt: session.openedAt,
    closedAt: session.closedAt!,
    plannedStopsMin,
    lots: lotResults,
  });

  return { sessionTrs, lotDetails, plannedStopsMin };
}

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

  const sessionResults: any[] = [];

  for (const session of closedSessions) {
    const { sessionTrs, lotDetails } = await buildSessionTrs(db, session);
    sessionResults.push({
      date: session.sessionDate,
      notes: session.notes,
      ...sessionTrs,
      lots: lotDetails,
    });
  }

  const zoom = computeZoomTrs({ sessions: sessionResults });

  res.json({
    period: { from, to, equipmentId },
    daily: sessionResults,
    total: zoom,
  });
});

// ─── Pareto: downtime aggregated by category ──────────────────

dashboardRouter.get("/pareto", async (req, res) => {
  const { db } = req;
  const { equipmentId, from, to } = req.query;

  if (!equipmentId || !from || !to) {
    res.status(400).json({ error: "equipmentId, from, to requis" });
    return;
  }

  // Get all closed sessions in range
  const closedSessions = await db.select().from(sessions)
    .where(and(
      eq(sessions.equipmentId, equipmentId as string),
      eq(sessions.status, "closed"),
      gte(sessions.sessionDate, from as string),
      lte(sessions.sessionDate, to as string),
    ));

  const sessionIds = closedSessions.map((s: any) => s.id);
  if (sessionIds.length === 0) {
    res.json({ pareto: [], totalMin: 0 });
    return;
  }

  // Get all lots in those sessions
  const allLots: any[] = [];
  for (const sid of sessionIds) {
    const lots = await db.select().from(lotEntries).where(eq(lotEntries.sessionId, sid));
    allLots.push(...lots);
  }

  // Get all downtimes with category info
  const aggregation: Record<string, { code: string; label: string; famille: string; isPlanned: boolean; totalMin: number; count: number }> = {};
  let totalMin = 0;

  for (const lot of allLots) {
    const dts = await db.select({
      durationMinutes: downtimeEvents.durationMinutes,
      categoryCode: downtimeCategories.code,
      categoryLabel: downtimeCategories.label,
      famille: downtimeCategories.famille,
      isPlanned: downtimeCategories.isPlanned,
    }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .where(eq(downtimeEvents.lotEntryId, lot.id));

    for (const dt of dts) {
      const key = dt.categoryCode;
      if (!aggregation[key]) {
        aggregation[key] = { code: dt.categoryCode, label: dt.categoryLabel, famille: dt.famille, isPlanned: dt.isPlanned, totalMin: 0, count: 0 };
      }
      aggregation[key].totalMin += dt.durationMinutes;
      aggregation[key].count += 1;
      totalMin += dt.durationMinutes;
    }
  }

  // Also add session-level planned stops (phases)
  for (const sid of sessionIds) {
    const events = await db.select().from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sid), eq(sessionEvents.isPlanned, true)));
    for (const ev of events) {
      const dur = ev.durationMinutes ?? 0;
      if (dur > 0) {
        const key = `phase_${ev.eventType}`;
        if (!aggregation[key]) {
          const labels: Record<string, string> = {
            nettoyage: "Nettoyage", vide_ligne: "Vide de ligne", pause: "Pause",
            chsb: "CHSB", chsg: "CHSG", apr: "APR", remplissage: "Remplissage",
            mqch: "MQCH", custom: ev.label || "Autre",
          };
          aggregation[key] = { code: key, label: labels[ev.eventType] || ev.eventType, famille: "Phase planifiée", isPlanned: true, totalMin: 0, count: 0 };
        }
        aggregation[key].totalMin += dur;
        aggregation[key].count += 1;
        totalMin += dur;
      }
    }
  }

  const pareto = Object.values(aggregation)
    .sort((a, b) => b.totalMin - a.totalMin)
    .map(item => ({
      ...item,
      pctOfTotal: totalMin > 0 ? Math.round((item.totalMin / totalMin) * 10000) / 100 : 0,
    }));

  // Compute cumulative percentages
  let cumul = 0;
  for (const item of pareto) {
    cumul += item.pctOfTotal;
    (item as any).cumulPct = Math.round(cumul * 100) / 100;
  }

  res.json({ pareto, totalMin });
});

// ─── Comparison: both equipments side by side ─────────────────

dashboardRouter.get("/comparison", async (req, res) => {
  const { db } = req;
  const { from, to } = req.query;

  if (!from || !to) {
    res.status(400).json({ error: "from, to requis" });
    return;
  }

  const eqs = await db.select().from(equipments).where(eq(equipments.isActive, true));
  const results: any[] = [];

  for (const equipment of eqs) {
    const closedSessions = await db.select().from(sessions)
      .where(and(
        eq(sessions.equipmentId, equipment.id),
        eq(sessions.status, "closed"),
        gte(sessions.sessionDate, from as string),
        lte(sessions.sessionDate, to as string),
      ))
      .orderBy(sessions.sessionDate);

    const sessionResults: any[] = [];
    for (const session of closedSessions) {
      const { sessionTrs } = await buildSessionTrs(db, session);
      sessionResults.push({ date: session.sessionDate, ...sessionTrs });
    }

    const zoom = computeZoomTrs({ sessions: sessionResults });

    results.push({
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      equipmentCode: equipment.code,
      equipmentType: equipment.equipmentType,
      trsObjective: Number(equipment.trsObjective),
      daily: sessionResults,
      total: zoom,
    });
  }

  res.json({ period: { from, to }, equipments: results });
});

// ─── Pending lots for supervisor validation ───────────────────

dashboardRouter.get("/pending-lots", async (req, res) => {
  const { db } = req;
  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.status, "closed"))
    .orderBy(desc(lotEntries.endedAt));
  res.json(lots);
});
