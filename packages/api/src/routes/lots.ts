import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { lotEntries, downtimeEvents, sessionEvents, downtimeCategories, electronicSignatures, lotCadenceChanges } from "@trs/db";
import { diffMinutes } from "@trs/engine";
import { authenticate, requireRole } from "../middleware";
import { asyncHandler, validate, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { reauthSigner, recordSignature } from "../lib/sign";
import { startLotSchema, closeLotSchema, updateLotSchema, addDowntimeSchema, validateLotSchema, changeCadenceSchema, correctLotSchema } from "../schemas";

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
  const { db, userId, userRole } = req;
  const lotId = String(req.params.id);

  const [existing] = await db.select().from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (existing.status !== "active") throw new HttpError(409, "Seuls les lots actifs peuvent être mis à jour via PATCH — utilisez POST /:id/correct pour les lots clôturés");
  if (userRole === "operator" && existing.operatorId !== userId) { res.status(403).json({ error: "Accès interdit" }); return; }

  const updates: Partial<{ quantityProduced: number; quantityConforming: number; quantityRejected: number; cadenceUsed: string; cadenceUnit: string }> = {};
  if (req.body.quantityProduced !== undefined) updates.quantityProduced = req.body.quantityProduced;
  if (req.body.quantityConforming !== undefined) updates.quantityConforming = req.body.quantityConforming;
  if (req.body.quantityRejected !== undefined) updates.quantityRejected = req.body.quantityRejected;
  if (req.body.cadenceUsed !== undefined) updates.cadenceUsed = String(req.body.cadenceUsed);
  if (req.body.cadenceUnit !== undefined) updates.cadenceUnit = req.body.cadenceUnit;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucune mise à jour" });
    return;
  }

  const [lot] = await db.update(lotEntries).set(updates).where(eq(lotEntries.id, lotId)).returning();
  await audit(db, req, "UPDATE_LOT", "lot", lotId, { updates });
  res.json(lot);
}));

// ─── Change cadence during a lot (logged history) ────────────
// The consigne can be adjusted while producing. We update the lot's current
// cadence AND append an immutable history row, so TRS uses a time-weighted
// nominal cadence and the supervisor can audit every change.

lotsRouter.post("/:id/cadence", validate(changeCadenceSchema), asyncHandler(async (req, res) => {
  const { db, userId, userRole } = req;
  const { newCadence, cadenceUnit, reason } = req.body;
  const lotId = String(req.params.id);

  const [lot] = await db.select().from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (lot.status !== "active") throw new HttpError(409, "La cadence ne peut être modifiée que sur un lot en cours");
  if (userRole === "operator" && lot.operatorId !== userId) { res.status(403).json({ error: "Accès interdit" }); return; }

  const unit = cadenceUnit ?? lot.cadenceUnit;

  await db.insert(lotCadenceChanges).values({
    lotEntryId: lotId,
    oldCadence: String(lot.cadenceUsed),
    newCadence: String(newCadence),
    cadenceUnit: unit,
    reason: reason ?? null,
    changedBy: userId,
  });

  const [updated] = await db.update(lotEntries)
    .set({ cadenceUsed: String(newCadence), cadenceUnit: unit })
    .where(eq(lotEntries.id, lotId)).returning();

  await audit(db, req, "CHANGE_CADENCE", "lot", lotId, { from: lot.cadenceUsed, to: newCadence, unit, reason });
  res.json(updated);
}));

// History of cadence changes for a lot (audit / supervisor view).
lotsRouter.get("/:id/cadence", asyncHandler(async (req, res) => {
  const { db } = req;
  const rows = await db.select().from(lotCadenceChanges)
    .where(eq(lotCadenceChanges.lotEntryId, String(req.params.id)))
    .orderBy(lotCadenceChanges.changedAt);
  res.json(rows);
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
    sessionId: downtimeEvents.sessionId,
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

// ─── Delete a downtime from a lot ────────────────────────────

lotsRouter.delete("/:id/downtimes/:dtId", asyncHandler(async (req, res) => {
  const { db } = req;
  const lotId = String(req.params.id);
  const dtId = String(req.params.dtId);

  const [dt] = await db.select({ id: downtimeEvents.id, lotEntryId: downtimeEvents.lotEntryId })
    .from(downtimeEvents).where(eq(downtimeEvents.id, dtId)).limit(1);
  if (!dt) { res.status(404).json({ error: "Arrêt introuvable" }); return; }
  if (dt.lotEntryId !== lotId) { res.status(403).json({ error: "Cet arrêt n'appartient pas à ce lot" }); return; }

  await audit(db, req, "DELETE_DOWNTIME", "downtime", dtId, { lotId });
  await db.delete(downtimeEvents).where(eq(downtimeEvents.id, dtId));
  res.status(204).send();
}));

// ─── Supervisor correct lot data (21 CFR Part 11 signed amendment) ─────
// Allows supervisors to fix operator data-entry errors before validation.
// Original values are preserved in the audit trail payload.

lotsRouter.post("/:id/correct", requireRole("supervisor", "admin"), validate(correctLotSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { quantityProduced, quantityConforming, quantityRejected, cadenceUsed, cadenceUnit, correctionReason, password } = req.body;
  const lotId = String(req.params.id);

  // Re-authenticate the signer and load the lot in parallel — independent reads.
  const [signer, [original]] = await Promise.all([
    reauthSigner(db, userId!, password),
    db.select().from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1),
  ]);
  if (!original) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (original.status !== "closed") throw new HttpError(409, "Seuls les lots clôturés peuvent être corrigés");

  const updates: Partial<{ quantityProduced: number; quantityConforming: number; quantityRejected: number; cadenceUsed: string; cadenceUnit: string }> = {};
  if (quantityProduced !== undefined) updates.quantityProduced = quantityProduced;
  if (quantityConforming !== undefined) updates.quantityConforming = quantityConforming;
  if (quantityRejected !== undefined) updates.quantityRejected = quantityRejected;
  if (cadenceUsed !== undefined) updates.cadenceUsed = String(cadenceUsed);
  if (cadenceUnit !== undefined) updates.cadenceUnit = cadenceUnit;

  if (Object.keys(updates).length === 0) throw new HttpError(400, "Aucune valeur à corriger");

  // Coherence must hold against the MERGED (stored + incoming) values, not just
  // the fields present in this request. A partial correction (e.g. only
  // quantityConforming) would otherwise bypass the schema refine and persist
  // quantityConforming > quantityProduced.
  const mergedProduced = quantityProduced ?? original.quantityProduced;
  const mergedConforming = quantityConforming ?? original.quantityConforming;
  if (mergedConforming > mergedProduced) {
    throw new HttpError(400, "La quantité conforme ne peut pas dépasser la quantité produite");
  }

  const [lot] = await db.update(lotEntries).set(updates).where(eq(lotEntries.id, lotId)).returning();

  const signature = await recordSignature(db, req, signer, {
    entityType: "lot", entityId: lot.id,
    meaning: "Correction des données du lot", action: "correct", comment: correctionReason,
  });

  const originalValues = {
    quantityProduced: original.quantityProduced,
    quantityConforming: original.quantityConforming,
    quantityRejected: original.quantityRejected,
    cadenceUsed: original.cadenceUsed,
  };
  await audit(db, req, "CORRECT_LOT", "lot", lot.id, { originalValues, newValues: updates, correctionReason, signatureId: signature.id });
  res.json({ lot, signature });
}));

// ─── Supervisor validate/reject lot ───────────────────────────

lotsRouter.post("/:id/validate", requireRole("supervisor", "admin"), validate(validateLotSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { action, comment, password } = req.body; // action: "validate" | "reject"
  const status = action === "reject" ? "rejected" : "validated";
  const lotId = String(req.params.id);

  // 21 CFR Part 11: re-authenticate the signer at the moment of signing.
  const signer = await reauthSigner(db, userId!, password);

  const [lot] = await db.update(lotEntries).set({
    status,
    supervisorId: userId,
    supervisorComment: comment,
    validatedAt: new Date(),
  }).where(eq(lotEntries.id, lotId)).returning();

  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }

  const signature = await recordSignature(db, req, signer, {
    entityType: "lot", entityId: lot.id,
    meaning: action === "reject" ? "Rejet du lot" : "Validation du lot",
    action, comment: comment ?? null,
  });

  await audit(db, req, action === "reject" ? "REJECT_LOT" : "VALIDATE_LOT", "lot", lot.id, { action, comment, signatureId: signature.id });
  res.json({ ...lot, signature });
}));

// ─── Electronic signatures for a lot (Part 11 manifestation) ──
lotsRouter.get("/:id/signatures", asyncHandler(async (req, res) => {
  const { db } = req;
  const rows = await db.select().from(electronicSignatures)
    .where(and(eq(electronicSignatures.entityType, "lot"), eq(electronicSignatures.entityId, String(req.params.id))))
    .orderBy(desc(electronicSignatures.signedAt));
  res.json(rows);
}));
