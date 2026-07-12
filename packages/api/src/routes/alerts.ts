import { Router } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alertRules, alerts, equipments, lotEntries, sessions } from "@trs/db";
import { authenticate, requireRole } from "../middleware";
import { asyncHandler, HttpError } from "../lib/http";
import { publish } from "../lib/eventBus";

const TYPES = new Set(["trs_below", "downtime_duration", "session_stale", "validation_pending"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);

export const alertsRouter = Router();
alertsRouter.use(authenticate);

async function evaluateTimeRules(db: any) {
  const rules = await db.select().from(alertRules).where(eq(alertRules.isActive, true));
  const now = Date.now();

  for (const rule of rules) {
    const thresholdMinutes = Number(rule.threshold);
    if (rule.type === "session_stale") {
      const rows = await db.select({ session: sessions, equipmentName: equipments.name })
        .from(sessions).innerJoin(equipments, eq(sessions.equipmentId, equipments.id))
        .where(and(eq(sessions.status, "active"), rule.equipmentId ? eq(sessions.equipmentId, rule.equipmentId) : undefined));
      for (const row of rows) {
        if (now - row.session.openedAt.getTime() < thresholdMinutes * 60_000) continue;
        await db.execute(sql`INSERT INTO alerts (rule_id, equipment_id, session_id, entity_key, message, severity)
          VALUES (${rule.id}, ${row.session.equipmentId}, ${row.session.id}, ${`session:${row.session.id}`}, ${`Session ouverte depuis plus de ${thresholdMinutes} min sur ${row.equipmentName}`}, ${rule.severity})
          ON CONFLICT (rule_id, entity_key) WHERE acknowledged_at IS NULL DO NOTHING`);
      }
    }
    if (rule.type === "validation_pending") {
      const rows = await db.select({ lot: lotEntries, equipmentId: sessions.equipmentId, equipmentName: equipments.name })
        .from(lotEntries).innerJoin(sessions, eq(lotEntries.sessionId, sessions.id)).innerJoin(equipments, eq(sessions.equipmentId, equipments.id))
        .where(and(eq(lotEntries.status, "submitted"), rule.equipmentId ? eq(sessions.equipmentId, rule.equipmentId) : undefined));
      for (const row of rows) {
        const since = row.lot.endedAt ?? row.lot.startedAt;
        if (now - since.getTime() < thresholdMinutes * 60_000) continue;
        await db.execute(sql`INSERT INTO alerts (rule_id, equipment_id, session_id, lot_id, entity_key, message, severity)
          VALUES (${rule.id}, ${row.equipmentId}, ${row.lot.sessionId}, ${row.lot.id}, ${`lot:${row.lot.id}`}, ${`Lot ${row.lot.batchNumber} en attente de validation sur ${row.equipmentName}`}, ${rule.severity})
          ON CONFLICT (rule_id, entity_key) WHERE acknowledged_at IS NULL DO NOTHING`);
      }
    }
  }
}

alertsRouter.get("/", requireRole("supervisor", "admin"), asyncHandler(async (req, res) => {
  await evaluateTimeRules(req.db);
  const data = await req.db.select({ alert: alerts, equipmentName: equipments.name })
    .from(alerts).leftJoin(equipments, eq(alerts.equipmentId, equipments.id))
    .where(isNull(alerts.acknowledgedAt)).orderBy(desc(alerts.triggeredAt));
  res.json(data.map(({ alert, equipmentName }) => ({ ...alert, equipmentName })));
}));

alertsRouter.post("/:id/acknowledge", requireRole("supervisor", "admin"), asyncHandler(async (req, res) => {
  const [row] = await req.db.update(alerts).set({ acknowledgedAt: new Date(), acknowledgedBy: req.user!.id })
    .where(and(eq(alerts.id, String(req.params.id)), isNull(alerts.acknowledgedAt))).returning();
  if (!row) throw new HttpError(404, "Alerte introuvable ou déjà acquittée");
  publish("alert.acknowledged", { id: row.id });
  res.json(row);
}));

alertsRouter.get("/rules", requireRole("admin"), asyncHandler(async (req, res) => {
  const data = await req.db.select({ rule: alertRules, equipmentName: equipments.name })
    .from(alertRules).leftJoin(equipments, eq(alertRules.equipmentId, equipments.id)).orderBy(desc(alertRules.createdAt));
  res.json(data.map(({ rule, equipmentName }) => ({ ...rule, equipmentName })));
}));

alertsRouter.post("/rules", requireRole("admin"), asyncHandler(async (req, res) => {
  const { equipmentId, type, threshold, severity = "warning" } = req.body;
  if (!TYPES.has(type) || !SEVERITIES.has(severity) || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0) {
    throw new HttpError(400, "Règle d’alerte invalide");
  }
  const [row] = await req.db.insert(alertRules).values({ equipmentId: equipmentId || null, type, threshold: String(threshold), severity }).returning();
  res.status(201).json(row);
}));

alertsRouter.patch("/rules/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const updates: Record<string, unknown> = {};
  if (req.body.threshold !== undefined) updates.threshold = String(req.body.threshold);
  if (req.body.severity !== undefined && SEVERITIES.has(req.body.severity)) updates.severity = req.body.severity;
  if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
  if (req.body.equipmentId !== undefined) updates.equipmentId = req.body.equipmentId || null;
  const [row] = await req.db.update(alertRules).set(updates).where(eq(alertRules.id, String(req.params.id))).returning();
  if (!row) throw new HttpError(404, "Règle introuvable");
  res.json(row);
}));
