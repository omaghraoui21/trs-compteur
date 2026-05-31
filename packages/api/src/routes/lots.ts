import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { lotEntries, downtimeEvents, sessionEvents, downtimeCategories } from "@trs/db";
import { diffMinutes } from "@trs/engine";
import { authenticate, requireRole } from "../middleware";
import { asyncHandler, validate } from "../lib/http";
import { audit } from "../lib/audit";
import { startLotSchema, closeLotSchema, updateLotSchema, addDowntimeSchema, validateLotSchema } from "../schemas";

export const lotsRouter = Router();
lotsRouter.use(authenticate);

// ─── Start a lot within a session ─────────────────────────────

lotsRouter.post("/", validate(startLotSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { sessionId, productId, batchNumber, cadenceUsed, cadenceUnit } = req.body;

  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }

  // Check no active lot in this session
  const [activeLot] = await db.select().from(lotEntries)
    .where(and(eq(lotEntries.sessionId, sessionId), eq(lotEntries.status, "active")))
    .limit(1);
  if (activeLot) {
    res.status(409).json({ error: "Un lot est déjà actif dans cette session", lotId: activeLot.id });
    return;
  }

  // Get lot order
  const existingLots = await db.select().from(lotEntries)
    .where(eq(lotEntries.sessionId, sessionId));
  const lotOrder = existingLots.length + 1;

  const now = new Date();

  // Create lot_start event
  const [lot] = await db.insert(lotEntries).values({
    sessionId,
    productId,
    batchNumber,
    lotOrder,
    cadenceUsed: String(cadenceUsed),
    cadenceUnit: cadenceUnit || "u/h",
    operatorId: userId,
    startedAt: now,
    status: "active",
  }).returning();

  // Add lot_start event to session timeline
  const existingEvents = await db.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
  const maxOrder = existingEvents.reduce((max, e) => Math.max(max, e.sortOrder), 0);

  await db.insert(sessionEvents).values({
    sessionId,
    eventType: "lot_start",
    startedAt: now,
    isPlanned: false,
    lotEntryId: lot.id,
    sortOrder: maxOrder + 1,
  });

  await audit(db, req, "START_LOT", "lot", lot.id, { batchNumber, sessionId, productId });
  res.status(201).json(lot);
}));

// ─── Close a lot (update quantities) ──────────────────────────

lotsRouter.post("/:id/close", validate(closeLotSchema), asyncHandler(async (req, res) => {
  const { db, userId, userRole } = req;
  const { quantityProduced, quantityConforming, quantityRejected } = req.body;

  // H2: Operators may only close their own lots
  if (userRole === "operator") {
    const [existing] = await db.select({ operatorId: lotEntries.operatorId })
      .from(lotEntries).where(eq(lotEntries.id, String(req.params.id))).limit(1);
    if (!existing) { res.status(404).json({ error: "Lot introuvable" }); return; }
    if (existing.operatorId !== userId) { res.status(403).json({ error: "Accès interdit" }); return; }
  }

  const now = new Date();

  const [lot] = await db.update(lotEntries).set({
    quantityProduced: quantityProduced ?? 0,
    quantityConforming: quantityConforming ?? 0,
    quantityRejected: quantityRejected ?? 0,
    endedAt: now,
    status: "closed",
  }).where(eq(lotEntries.id, String(req.params.id))).returning();

  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  await audit(db, req, "CLOSE_LOT", "lot", lot.id, { quantityProduced, quantityConforming, quantityRejected });

  // Add lot_end event
  const existingEvents = await db.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, lot.sessionId));
  const maxOrder = existingEvents.reduce((max, e) => Math.max(max, e.sortOrder), 0);

  await db.insert(sessionEvents).values({
    sessionId: lot.sessionId,
    eventType: "lot_end",
    startedAt: now,
    endedAt: now,
    durationMinutes: 0,
    isPlanned: false,
    lotEntryId: lot.id,
    sortOrder: maxOrder + 1,
  });

  res.json(lot);
}));

// ─── Update lot quantities (while active) ─────────────────────

lotsRouter.patch("/:id", validate(updateLotSchema), asyncHandler(async (req, res) => {
  const { db } = req;
  const updates: Record<string, any> = {};
  if (req.body.quantityProduced !== undefined) updates.quantityProduced = req.body.quantityProduced;
  if (req.body.quantityConforming !== undefined) updates.quantityConforming = req.body.quantityConforming;
  if (req.body.quantityRejected !== undefined) updates.quantityRejected = req.body.quantityRejected;
  if (req.body.cadenceUsed !== undefined) updates.cadenceUsed = String(req.body.cadenceUsed);
  if (req.body.cadenceUnit !== undefined) updates.cadenceUnit = req.body.cadenceUnit;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucune mise à jour" });
    return;
  }

  const [lot] = await db.update(lotEntries).set(updates)
    .where(eq(lotEntries.id, String(req.params.id))).returning();
  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  res.json(lot);
}));

// ─── Add downtime to a lot ────────────────────────────────────

lotsRouter.post("/:id/downtimes", validate(addDowntimeSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { categoryId, durationMinutes, isShortStop, comment } = req.body;

  const now = new Date();
  const endedAt = new Date(now.getTime() + durationMinutes * 60_000);

  const [dt] = await db.insert(downtimeEvents).values({
    lotEntryId: String(req.params.id),
    categoryId,
    startedAt: now,
    endedAt,
    durationMinutes,
    status: "closed",
    isShortStop: isShortStop ?? null,
    comment,
    createdBy: userId,
  }).returning();

  res.status(201).json(dt);
}));

// ─── Get lot downtimes ────────────────────────────────────────
// Joins the category so consumers get famille/reason/isPlanned without a
// second request — same shape convention as GET /dashboard/downtime-log.

lotsRouter.get("/:id/downtimes", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select({
    id: downtimeEvents.id,
    lotEntryId: downtimeEvents.lotEntryId,
    categoryId: downtimeEvents.categoryId,
    startedAt: downtimeEvents.startedAt,
    endedAt: downtimeEvents.endedAt,
    durationMinutes: downtimeEvents.durationMinutes,
    comment: downtimeEvents.comment,
    famille: downtimeCategories.famille,
    reason: downtimeCategories.label,
    isPlanned: downtimeCategories.isPlanned,
  }).from(downtimeEvents)
    .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
    .where(eq(downtimeEvents.lotEntryId, String(req.params.id)));
  res.json(data);
}));

// ─── Supervisor validate/reject lot ───────────────────────────

lotsRouter.post("/:id/validate", requireRole("supervisor", "admin"), validate(validateLotSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { action, comment } = req.body; // action: "validate" | "reject"
  const status = action === "reject" ? "rejected" : "validated";

  const [lot] = await db.update(lotEntries).set({
    status,
    supervisorId: userId,
    supervisorComment: comment,
    validatedAt: new Date(),
  }).where(eq(lotEntries.id, String(req.params.id))).returning();

  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  await audit(db, req, action === "reject" ? "REJECT_LOT" : "VALIDATE_LOT", "lot", lot.id, { action, comment });
  res.json(lot);
}));
