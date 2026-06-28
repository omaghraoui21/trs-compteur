import { Router } from "express";
import { eq, and, desc, count, max } from "drizzle-orm";
import { sessions, lotEntries, downtimeEvents, sessionEvents, downtimeCategories, electronicSignatures, lotCadenceChanges } from "@trs/db";
import { diffMinutes } from "@trs/engine";
import { authenticate, requireRole } from "../middleware";
import { asyncHandler, validate, HttpError, assertOperatorOwns } from "../lib/http";
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

  // Verify session exists + is active, check for an active lot, and check for
  // a duplicate batch number in the same session — all reads against indexed columns.
  const [[sessionRow], [activeLot], [dupBatch]] = await Promise.all([
    db.select({ id: sessions.id, status: sessions.status }).from(sessions).where(eq(sessions.id, sessionId)).limit(1),
    db.select({ id: lotEntries.id }).from(lotEntries)
      .where(and(eq(lotEntries.sessionId, sessionId), eq(lotEntries.status, "active")))
      .limit(1),
    db.select({ id: lotEntries.id }).from(lotEntries)
      .where(and(eq(lotEntries.sessionId, sessionId), eq(lotEntries.batchNumber, batchNumber)))
      .limit(1),
  ]);
  if (!sessionRow) { res.status(404).json({ error: "Session introuvable" }); return; }
  if (sessionRow.status !== "active") throw new HttpError(409, "Impossible de démarrer un lot dans une session fermée");
  if (activeLot) {
    res.status(409).json({ error: "Un lot est déjà actif dans cette session", lotId: activeLot.id });
    return;
  }
  if (dupBatch) {
    throw new HttpError(409, "Ce numéro de lot est déjà enregistré dans cette session");
  }

  // Use aggregates to avoid loading full row sets just for ordering values.
  const [[lotCountRow], [maxSortRow]] = await Promise.all([
    db.select({ n: count() }).from(lotEntries).where(eq(lotEntries.sessionId, sessionId)),
    db.select({ m: max(sessionEvents.sortOrder) }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)),
  ]);
  const lotOrder = (lotCountRow?.n ?? 0) + 1;
  const maxOrder = maxSortRow?.m ?? 0;

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

  const [existing] = await db.select({ operatorId: lotEntries.operatorId, status: lotEntries.status })
    .from(lotEntries).where(eq(lotEntries.id, String(req.params.id))).limit(1);
  if (!existing) { res.status(404).json({ error: "Lot introuvable" }); return; }
  // H2: Operators may only close their own lots
  assertOperatorOwns(userRole, userId, existing.operatorId);
  // Protect already-finalized lots — closing a validated/rejected lot would overwrite the supervisor's decision.
  if (existing.status !== "active") throw new HttpError(409, `Impossible de clôturer un lot en statut « ${existing.status} »`);

  const now = new Date();

  const [lot] = await db.update(lotEntries).set({
    quantityProduced: quantityProduced ?? 0,
    quantityConforming: quantityConforming ?? 0,
    quantityRejected: quantityRejected ?? 0,
    endedAt: now,
    status: "closed",
  }).where(eq(lotEntries.id, String(req.params.id))).returning();

  // Update is guaranteed to succeed — lot exists and is active (checked above).
  const closed = lot!;
  await audit(db, req, "CLOSE_LOT", "lot", closed.id, { quantityProduced, quantityConforming, quantityRejected });

  // Add lot_end event — use MAX() to avoid loading the full event list.
  const [maxSortRow] = await db.select({ m: max(sessionEvents.sortOrder) }).from(sessionEvents).where(eq(sessionEvents.sessionId, closed.sessionId));
  const maxOrder = maxSortRow?.m ?? 0;

  await db.insert(sessionEvents).values({
    sessionId: closed.sessionId,
    eventType: "lot_end",
    startedAt: now,
    endedAt: now,
    durationMinutes: 0,
    isPlanned: false,
    lotEntryId: closed.id,
    sortOrder: maxOrder + 1,
  });

  res.json(closed);
}));

// ─── Update lot quantities (while active) ─────────────────────

lotsRouter.patch("/:id", validate(updateLotSchema), asyncHandler(async (req, res) => {
  const { db, userId, userRole } = req;
  const lotId = String(req.params.id);

  const [existing] = await db.select({ status: lotEntries.status, operatorId: lotEntries.operatorId })
    .from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (existing.status !== "active") throw new HttpError(409, "Seuls les lots actifs peuvent être mis à jour via PATCH — utilisez POST /:id/correct pour les lots clôturés");
  assertOperatorOwns(userRole, userId, existing.operatorId);

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
  assertOperatorOwns(userRole, userId, lot.operatorId);

  const unit = cadenceUnit ?? lot.cadenceUnit;

  // A change row carries a single `cadenceUnit` that must describe BOTH its
  // oldCadence and newCadence, because effectiveLotCadence reconstructs the
  // lot's starting cadence from (oldCadence, cadenceUnit). When this change
  // also switches the unit, express the old cadence in the new unit so the row
  // stays internally consistent — otherwise the lot's initial cadence would be
  // read under the wrong unit (a 60× error in TP). No-op when the unit is
  // unchanged, which is the only case the operator UI produces.
  const oldCadenceInUnit =
    unit === lot.cadenceUnit
      ? Number(lot.cadenceUsed)
      : lot.cadenceUnit === "u/h"
        ? Number(lot.cadenceUsed) / 60   // u/h → u/min
        : Number(lot.cadenceUsed) * 60;  // u/min → u/h

  // The insert and update are independent — run in parallel.
  const [, [updated]] = await Promise.all([
    db.insert(lotCadenceChanges).values({
      lotEntryId: lotId,
      oldCadence: String(oldCadenceInUnit),
      newCadence: String(newCadence),
      cadenceUnit: unit,
      reason: reason ?? null,
      changedBy: userId,
    }),
    db.update(lotEntries)
      .set({ cadenceUsed: String(newCadence), cadenceUnit: unit })
      .where(eq(lotEntries.id, lotId)).returning(),
  ]);

  await audit(db, req, "CHANGE_CADENCE", "lot", lotId, { from: lot.cadenceUsed, to: newCadence, unit, reason });
  res.json(updated);
}));

// History of cadence changes for a lot (audit / supervisor view).
lotsRouter.get("/:id/cadence", asyncHandler(async (req, res) => {
  const { db } = req;
  const lotId = String(req.params.id);
  const [lot] = await db.select({ id: lotEntries.id }).from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  const rows = await db.select().from(lotCadenceChanges)
    .where(eq(lotCadenceChanges.lotEntryId, lotId))
    .orderBy(lotCadenceChanges.changedAt);
  res.json(rows);
}));

// ─── Add downtime to a lot ────────────────────────────────────

lotsRouter.post("/:id/downtimes", validate(addDowntimeSchema), asyncHandler(async (req, res) => {
  const { db, userId, userRole } = req;
  const { categoryId, durationMinutes, isShortStop, comment } = req.body;
  const lotId = String(req.params.id);

  const [lot] = await db.select({ id: lotEntries.id, status: lotEntries.status, operatorId: lotEntries.operatorId }).from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (lot.status !== "active" && lot.status !== "closed") {
    throw new HttpError(409, "Impossible d'ajouter un arrêt sur un lot déjà décidé par le superviseur");
  }
  assertOperatorOwns(userRole, userId, lot.operatorId, "Vous ne pouvez ajouter des arrêts que sur vos propres lots");

  const now = new Date();
  const endedAt = new Date(now.getTime() + durationMinutes * 60_000);

  const [dt] = await db.insert(downtimeEvents).values({
    lotEntryId: lotId,
    categoryId,
    startedAt: now,
    endedAt,
    durationMinutes,
    status: "closed",
    isShortStop: isShortStop ?? null,
    comment,
    createdBy: userId,
  }).returning();

  await audit(db, req, "ADD_DOWNTIME", "downtime", dt.id, { lotId, categoryId, durationMinutes });
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
  const { db, userId, userRole } = req;
  const lotId = String(req.params.id);
  const dtId = String(req.params.dtId);

  // Join with the lot so we can check ownership + lot status in one query.
  const [row] = await db.select({ id: downtimeEvents.id, lotEntryId: downtimeEvents.lotEntryId, lotStatus: lotEntries.status, createdBy: downtimeEvents.createdBy })
    .from(downtimeEvents)
    .innerJoin(lotEntries, eq(downtimeEvents.lotEntryId, lotEntries.id))
    .where(eq(downtimeEvents.id, dtId)).limit(1);
  if (!row) { res.status(404).json({ error: "Arrêt introuvable" }); return; }
  if (row.lotEntryId !== lotId) { res.status(403).json({ error: "Cet arrêt n'appartient pas à ce lot" }); return; }
  assertOperatorOwns(userRole, userId, row.createdBy, "Vous ne pouvez supprimer que vos propres arrêts");
  if (row.lotStatus !== "active" && row.lotStatus !== "closed") {
    throw new HttpError(409, "Impossible de supprimer un arrêt sur un lot déjà décidé par le superviseur");
  }

  await db.delete(downtimeEvents).where(eq(downtimeEvents.id, dtId));
  await audit(db, req, "DELETE_DOWNTIME", "downtime", dtId, { lotId });
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

  // Re-auth and lot status check in parallel — both reads are independent.
  const [signer, [existing]] = await Promise.all([
    reauthSigner(db, userId!, password),
    db.select({ id: lotEntries.id, status: lotEntries.status }).from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1),
  ]);
  if (!existing) { res.status(404).json({ error: "Lot introuvable" }); return; }
  if (existing.status !== "closed") {
    const desc = existing.status === "validated" ? "déjà validé"
      : existing.status === "rejected" ? "déjà rejeté"
      : `en statut « ${existing.status} »`;
    throw new HttpError(409, `Ce lot est ${desc} — seuls les lots clôturés peuvent être validés ou rejetés`);
  }

  const [lot] = await db.update(lotEntries).set({
    status,
    supervisorId: userId,
    supervisorComment: comment,
    validatedAt: new Date(),
  }).where(eq(lotEntries.id, lotId)).returning();

  const signature = await recordSignature(db, req, signer, {
    entityType: "lot", entityId: lot.id,
    meaning: action === "reject" ? "Rejet du lot" : "Validation du lot",
    action, comment: comment ?? null,
  });

  await audit(db, req, action === "reject" ? "REJECT_LOT" : "VALIDATE_LOT", "lot", lot.id, { action, comment, signatureId: signature.id });
  res.json({ lot, signature });
}));

// ─── Electronic signatures for a lot (Part 11 manifestation) ──
lotsRouter.get("/:id/signatures", asyncHandler(async (req, res) => {
  const { db } = req;
  const lotId = String(req.params.id);
  const [lot] = await db.select({ id: lotEntries.id }).from(lotEntries).where(eq(lotEntries.id, lotId)).limit(1);
  if (!lot) { res.status(404).json({ error: "Lot introuvable" }); return; }
  const rows = await db.select().from(electronicSignatures)
    .where(and(eq(electronicSignatures.entityType, "lot"), eq(electronicSignatures.entityId, lotId)))
    .orderBy(desc(electronicSignatures.signedAt));
  res.json(rows);
}));
