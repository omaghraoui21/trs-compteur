import { Router } from "express";
import { eq, and, or, gte, lte, desc, sql, inArray, isNull } from "drizzle-orm";
import { sessions, lotEntries, sessionEvents, downtimeEvents, downtimeCategories, equipments, products, lotCadenceChanges } from "@trs/db";
import { computeLotTrs, computeSessionTrs, computeZoomTrs, computeProductTrs, computeSixBigLosses, computeMtbfMttr } from "@trs/engine";
import type { ProductLotInput } from "@trs/engine";

import { authenticate } from "../middleware";
import { asyncHandler } from "../lib/http";
import { effectiveLotCadence } from "../lib/cadence";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);


// ─── Batch builder: same result as buildSessionTrs, but for many sessions in
// a fixed number of queries (eliminates the per-session/per-lot N+1). Loads all
// planned events, lots, downtimes (category-joined) and products in ~4 queries,
// groups them in memory, then computes each session's TRS. ────────────────────

interface BuiltSession {
  sessionTrs: ReturnType<typeof computeSessionTrs>;
  lotDetails: any[];
  productLots: ProductLotInput[];
  plannedStopsMin: number;
  downtimeDetails: { durationMinutes: number; isPlanned: boolean }[];
}

async function buildSessionsTrs(db: any, sessionList: any[]): Promise<Map<string, BuiltSession>> {
  const out = new Map<string, BuiltSession>();
  if (sessionList.length === 0) return out;

  const sessionIds = sessionList.map((s) => s.id);

  // 1. Planned stops per session = legacy planned phases (sessionEvents) +
  //    session-level planned downtimes (new model). Unplanned session-level
  //    stops reduce tF. Both maps are keyed by sessionId.
  const events = await db.select().from(sessionEvents)
    .where(and(inArray(sessionEvents.sessionId, sessionIds), eq(sessionEvents.isPlanned, true)));
  const plannedBySession = new Map<string, number>();
  const unplannedBySession = new Map<string, number>();
  for (const e of events) {
    plannedBySession.set(e.sessionId, (plannedBySession.get(e.sessionId) ?? 0) + (e.durationMinutes ?? 0));
  }

  // Session-level downtimes (inter-lot: lot_entry_id IS NULL), category-joined.
  const sessionDts = await db.select({
    sessionId: downtimeEvents.sessionId,
    durationMinutes: downtimeEvents.durationMinutes,
    isPlanned: downtimeCategories.isPlanned,
  }).from(downtimeEvents)
    .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
    .where(and(inArray(downtimeEvents.sessionId, sessionIds), isNull(downtimeEvents.lotEntryId)));
  const sessionDtDetails = new Map<string, { durationMinutes: number; isPlanned: boolean }[]>();
  for (const d of sessionDts) {
    if (!d.sessionId) continue;
    const target = d.isPlanned ? plannedBySession : unplannedBySession;
    target.set(d.sessionId, (target.get(d.sessionId) ?? 0) + d.durationMinutes);
    (sessionDtDetails.get(d.sessionId) ?? sessionDtDetails.set(d.sessionId, []).get(d.sessionId)!)
      .push({ durationMinutes: d.durationMinutes, isPlanned: d.isPlanned });
  }

  // 2. All lots for these sessions
  const lots = await db.select().from(lotEntries).where(inArray(lotEntries.sessionId, sessionIds));
  const lotsBySession = new Map<string, any[]>();
  for (const l of lots) {
    (lotsBySession.get(l.sessionId) ?? lotsBySession.set(l.sessionId, []).get(l.sessionId)!).push(l);
  }

  // 3. All downtimes (category-joined) for these lots
  const lotIds = lots.map((l: any) => l.id);
  const dtsByLot = new Map<string, any[]>();
  if (lotIds.length > 0) {
    const dts = await db.select({
      id: downtimeEvents.id,
      lotEntryId: downtimeEvents.lotEntryId,
      durationMinutes: downtimeEvents.durationMinutes,
      categoryId: downtimeEvents.categoryId,
      comment: downtimeEvents.comment,
      categoryCode: downtimeCategories.code,
      categoryLabel: downtimeCategories.label,
      famille: downtimeCategories.famille,
      isPlanned: downtimeCategories.isPlanned,
    }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .where(inArray(downtimeEvents.lotEntryId, lotIds));
    for (const d of dts) {
      (dtsByLot.get(d.lotEntryId) ?? dtsByLot.set(d.lotEntryId, []).get(d.lotEntryId)!).push(d);
    }
  }

  // 4. Products (small reference table) → lookup map
  const allProducts = await db.select().from(products);
  const productById = new Map<string, any>(allProducts.map((p: any) => [p.id, p]));

  // 5. Cadence changes per lot → time-weighted nominal cadence.
  const changesByLot = new Map<string, any[]>();
  if (lotIds.length > 0) {
    const changes = await db.select().from(lotCadenceChanges).where(inArray(lotCadenceChanges.lotEntryId, lotIds));
    for (const c of changes) (changesByLot.get(c.lotEntryId) ?? changesByLot.set(c.lotEntryId, []).get(c.lotEntryId)!).push(c);
  }

  for (const session of sessionList) {
    const plannedStopsMin = plannedBySession.get(session.id) ?? 0;
    const sessionUnplannedMin = unplannedBySession.get(session.id) ?? 0;
    const sessionLots = lotsBySession.get(session.id) ?? [];

    const lotDetails: any[] = [];
    const lotResults: any[] = [];
    const productLots: ProductLotInput[] = [];
    // Six-losses/pareto consume every stop — include the session-level ones.
    const downtimeDetails: { durationMinutes: number; isPlanned: boolean }[] = [
      ...(sessionDtDetails.get(session.id) ?? []),
    ];

    for (const lot of sessionLots) {
      const dts = dtsByLot.get(lot.id) ?? [];
      const eff = effectiveLotCadence(lot, changesByLot.get(lot.id), session.closedAt!);
      const lotTrs = computeLotTrs({
        cadence: eff.cadence,
        cadenceUnit: eff.cadenceUnit,
        produced: lot.quantityProduced,
        conforming: lot.quantityConforming,
        startedAt: lot.startedAt,
        endedAt: lot.endedAt ?? session.closedAt!,
        downtimes: dts.map((d: any) => ({ durationMinutes: d.durationMinutes, isPlanned: d.isPlanned, famille: d.famille })),
      });
      const product = productById.get(lot.productId);
      for (const d of dts) downtimeDetails.push({ durationMinutes: d.durationMinutes, isPlanned: d.isPlanned });

      if (lotTrs) {
        lotResults.push({ ...lotTrs, produced: lot.quantityProduced, conforming: lot.quantityConforming });
        lotDetails.push({
          lotId: lot.id, batchNumber: lot.batchNumber,
          productName: product?.name ?? "", productCode: product?.code ?? "",
          cadenceUsed: Number(lot.cadenceUsed), cadenceUnit: lot.cadenceUnit,
          quantityProduced: lot.quantityProduced, quantityConforming: lot.quantityConforming,
          quantityRejected: lot.quantityRejected, ...lotTrs,
        });
        productLots.push({
          productId: lot.productId, productName: product?.name ?? "",
          cadence: Number(lot.cadenceUsed), cadenceUnit: lot.cadenceUnit as "u/h" | "u/min",
          produced: lot.quantityProduced, conforming: lot.quantityConforming,
          lotDurationMin: lotTrs.lotDurationMin, unplannedMin: lotTrs.unplannedMin,
          tF: lotTrs.tF, tN: lotTrs.tN, tU: lotTrs.tU,
        });
      }
    }

    const sessionTrs = computeSessionTrs({
      openedAt: session.openedAt, closedAt: session.closedAt!, plannedStopsMin,
      unplannedStopsMin: sessionUnplannedMin, lots: lotResults,
    });
    out.set(session.id, { sessionTrs, lotDetails, productLots, plannedStopsMin, downtimeDetails });
  }

  return out;
}

// ─── Zoom TRS: compute TRS for a date range ──────────────────

dashboardRouter.get("/trs", asyncHandler(async (req, res) => {
  const { db } = req;
  const { equipmentId, from, to } = req.query;

  if (!equipmentId || !from || !to) {
    res.status(400).json({ error: "equipmentId, from, to requis" });
    return;
  }

  const [equipment] = await db.select().from(equipments).where(eq(equipments.id, equipmentId as string)).limit(1);
  const microStopThreshold = equipment?.microStopThresholdMin != null ? Number(equipment.microStopThresholdMin) : 5;

  const closedSessions = await db.select().from(sessions)
    .where(and(
      eq(sessions.equipmentId, equipmentId as string),
      eq(sessions.status, "closed"),
      gte(sessions.sessionDate, from as string),
      lte(sessions.sessionDate, to as string),
    ))
    .orderBy(sessions.sessionDate);

  const sessionResults: any[] = [];
  const allDowntimes: { durationMinutes: number; isPlanned: boolean }[] = [];

  const built = await buildSessionsTrs(db, closedSessions);
  for (const session of closedSessions) {
    const { sessionTrs, lotDetails, downtimeDetails } = built.get(session.id)!;
    allDowntimes.push(...downtimeDetails);
    sessionResults.push({
      date: session.sessionDate,
      notes: session.notes,
      ...sessionTrs,
      lots: lotDetails,
      reliability: computeMtbfMttr(downtimeDetails, sessionTrs.tF, microStopThreshold),
    });
  }

  const zoom = computeZoomTrs({ sessions: sessionResults });

  res.json({
    period: { from, to, equipmentId },
    daily: sessionResults,
    total: { ...zoom, reliability: computeMtbfMttr(allDowntimes, zoom.tF, microStopThreshold) },
  });
}));

// ─── Pareto: downtime aggregated by category ──────────────────

dashboardRouter.get("/pareto", asyncHandler(async (req, res) => {
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

  // All downtimes in those sessions, category-joined, in ONE query.
  const aggregation: Record<string, { code: string; label: string; famille: string; isPlanned: boolean; totalMin: number; count: number }> = {};
  let totalMin = 0;

  const dtRows = await db.select({
    durationMinutes: downtimeEvents.durationMinutes,
    categoryCode: downtimeCategories.code,
    categoryLabel: downtimeCategories.label,
    famille: downtimeCategories.famille,
    isPlanned: downtimeCategories.isPlanned,
  }).from(downtimeEvents)
    .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
    .leftJoin(lotEntries, eq(downtimeEvents.lotEntryId, lotEntries.id))
    .where(or(inArray(lotEntries.sessionId, sessionIds), inArray(downtimeEvents.sessionId, sessionIds)));

  for (const dt of dtRows) {
    const key = dt.categoryCode;
    if (!aggregation[key]) {
      aggregation[key] = { code: dt.categoryCode, label: dt.categoryLabel, famille: dt.famille, isPlanned: dt.isPlanned, totalMin: 0, count: 0 };
    }
    aggregation[key].totalMin += dt.durationMinutes;
    aggregation[key].count += 1;
    totalMin += dt.durationMinutes;
  }

  // Session-level planned stops (phases) in ONE query.
  const evRows = await db.select().from(sessionEvents)
    .where(and(inArray(sessionEvents.sessionId, sessionIds), eq(sessionEvents.isPlanned, true)));
  for (const ev of evRows) {
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
}));

// ─── Comparison: both equipments side by side ─────────────────

dashboardRouter.get("/comparison", asyncHandler(async (req, res) => {
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

    const built = await buildSessionsTrs(db, closedSessions);
    const sessionResults = closedSessions.map((session: any) => ({
      date: session.sessionDate,
      ...built.get(session.id)!.sessionTrs,
    }));

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
}));

// ─── By-Product aggregation (W) ───────────────────────────────

dashboardRouter.get("/by-product", asyncHandler(async (req, res) => {
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
    ));

  const productLots: ProductLotInput[] = [];
  const sessionResults: any[] = [];

  // Batch-build all sessions (fixed query count). Period tR comes from the same
  // engine used everywhere else (tR = tO − tAP).
  const built = await buildSessionsTrs(db, closedSessions);
  for (const session of closedSessions) {
    const b = built.get(session.id)!;
    sessionResults.push(b.sessionTrs);
    productLots.push(...b.productLots);
  }

  // Allocate the period's required time across products so Σ products ≡ global TRS (ΣtU/ΣtR).
  const zoom = computeZoomTrs({ sessions: sessionResults });
  const byProduct = computeProductTrs(productLots, zoom.tR);
  res.json({ period: { from, to, equipmentId }, periodTR: zoom.tR, periodTRS: zoom.TRS, byProduct });
}));

// ─── Six Big Losses (X) ───────────────────────────────────────

dashboardRouter.get("/six-losses", asyncHandler(async (req, res) => {
  const { db } = req;
  const { equipmentId, from, to } = req.query;

  if (!equipmentId || !from || !to) {
    res.status(400).json({ error: "equipmentId, from, to requis" });
    return;
  }

  // Get equipment for micro-stop threshold
  const [equipment] = await db.select().from(equipments).where(eq(equipments.id, equipmentId as string)).limit(1);
  const microStopThreshold = equipment?.microStopThresholdMin != null ? Number(equipment.microStopThresholdMin) : 5;

  const closedSessions = await db.select().from(sessions)
    .where(and(
      eq(sessions.equipmentId, equipmentId as string),
      eq(sessions.status, "closed"),
      gte(sessions.sessionDate, from as string),
      lte(sessions.sessionDate, to as string),
    ))
    .orderBy(sessions.sessionDate);

  // Batch-build TRS for every session (fixed query count).
  const built = await buildSessionsTrs(db, closedSessions);
  const sessionResults = closedSessions.map((s: any) => built.get(s.id)!.sessionTrs);

  // All downtime details (famille + isShortStop) in ONE query, grouped by session.
  type Dt = { durationMinutes: number; famille: string; isPlanned: boolean; isShortStop: boolean | null };
  const dtsBySession = new Map<string, Dt[]>();
  const allDowntimeDetails: Dt[] = [];
  const sessionIds = closedSessions.map((s: any) => s.id);
  if (sessionIds.length > 0) {
    const rows = await db.select({
      sessionId: sql<string>`coalesce(${lotEntries.sessionId}, ${downtimeEvents.sessionId})`.as("session_id"),
      durationMinutes: downtimeEvents.durationMinutes,
      famille: downtimeCategories.famille,
      isPlanned: downtimeCategories.isPlanned,
      isShortStop: downtimeEvents.isShortStop,
    }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .leftJoin(lotEntries, eq(downtimeEvents.lotEntryId, lotEntries.id))
      .where(or(inArray(lotEntries.sessionId, sessionIds), inArray(downtimeEvents.sessionId, sessionIds)));
    for (const r of rows) {
      const dt: Dt = { durationMinutes: r.durationMinutes, famille: r.famille, isPlanned: r.isPlanned, isShortStop: r.isShortStop };
      (dtsBySession.get(r.sessionId) ?? dtsBySession.set(r.sessionId, []).get(r.sessionId)!).push(dt);
      allDowntimeDetails.push(dt);
    }
  }

  const zoom = computeZoomTrs({ sessions: sessionResults });
  const sixLosses = computeSixBigLosses(zoom, allDowntimeDetails, microStopThreshold);

  const dailyLosses = closedSessions.map((session: any, i: number) => {
    const dayLosses = computeSixBigLosses(sessionResults[i], dtsBySession.get(session.id) ?? [], microStopThreshold);
    return { date: session.sessionDate, ...dayLosses };
  });

  res.json({ period: { from, to, equipmentId }, total: sixLosses, daily: dailyLosses });
}));

// ─── Heatmap TRS (Y) ──────────────────────────────────────────

dashboardRouter.get("/heatmap", asyncHandler(async (req, res) => {
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

  const built = await buildSessionsTrs(db, closedSessions);
  const heatmapData = closedSessions.map((session: any) => {
    const { sessionTrs } = built.get(session.id)!;
    return {
      date: session.sessionDate,
      TRS: Math.round(sessionTrs.TRS * 10000) / 100,
      DO: Math.round(sessionTrs.DO * 10000) / 100,
      TP: Math.round(sessionTrs.TP * 10000) / 100,
      TQ: Math.round(sessionTrs.TQ * 10000) / 100,
      lotCount: sessionTrs.lotCount,
    };
  });

  res.json({ period: { from, to, equipmentId }, heatmap: heatmapData });
}));

// ─── Chronological downtime log (stop-by-stop) ────────────────

// Note: this log lists only recorded downtime_events (lot-linked stops). Unlike
// /pareto, it intentionally excludes phase-based planned stops (nettoyage, CHSB…)
// recorded as session events — those belong to the phase timeline, not the stop
// log. A single join (downtimes → categories → lots → sessions) filtered by the
// session range, newest first.
dashboardRouter.get("/downtime-log", asyncHandler(async (req, res) => {
  const { db } = req;
  const { equipmentId, from, to } = req.query;

  if (!equipmentId || !from || !to) {
    res.status(400).json({ error: "equipmentId, from, to requis" });
    return;
  }

  // Two index-friendly queries instead of a coalesce() join condition (which
  // can't use an index): lot-attached stops (via the lot's session) and
  // session-level stops (via downtime_events.session_id), merged + sorted in memory.
  const periodFilter = and(
    eq(sessions.equipmentId, equipmentId as string),
    eq(sessions.status, "closed"),
    gte(sessions.sessionDate, from as string),
    lte(sessions.sessionDate, to as string),
  );
  const cols = {
    id: downtimeEvents.id,
    startedAt: downtimeEvents.startedAt,
    durationMinutes: downtimeEvents.durationMinutes,
    famille: downtimeCategories.famille,
    reason: downtimeCategories.label,
    isPlanned: downtimeCategories.isPlanned,
    batchNumber: lotEntries.batchNumber,
  };
  const [lotRows, sessionRows] = await Promise.all([
    db.select(cols).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .innerJoin(lotEntries, eq(downtimeEvents.lotEntryId, lotEntries.id))
      .innerJoin(sessions, eq(lotEntries.sessionId, sessions.id))
      .where(periodFilter),
    db.select({ ...cols, batchNumber: sql<string | null>`null` }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .innerJoin(sessions, eq(downtimeEvents.sessionId, sessions.id))
      .where(and(isNull(downtimeEvents.lotEntryId), periodFilter)),
  ]);

  const log = [...lotRows, ...sessionRows]
    .sort((a: any, b: any) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((r: any) => ({ ...r, startedAt: r.startedAt.toISOString() }));

  res.json({ period: { from, to, equipmentId }, log });
}));

// ─── Pending lots for supervisor validation ───────────────────

dashboardRouter.get("/pending-lots", asyncHandler(async (req, res) => {
  const { db } = req;
  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.status, "closed"))
    .orderBy(desc(lotEntries.endedAt));
  res.json(lots);
}));
