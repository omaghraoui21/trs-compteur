import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { sessions, sessionEvents, lotEntries, downtimeEvents } from "@trs/db";
import { computeLotTrs, computeSessionTrs, diffMinutes } from "@trs/engine";
import { authenticate } from "../middleware";

export const sessionsRouter = Router();
sessionsRouter.use(authenticate);

// ─── List sessions (with optional date/equipment filter) ─────

sessionsRouter.get("/", async (req, res) => {
  const { db } = req;
  const { date, equipmentId } = req.query;
  let conditions = [];
  if (date) conditions.push(eq(sessions.sessionDate, date as string));
  if (equipmentId) conditions.push(eq(sessions.equipmentId, equipmentId as string));
  const data = await db.select().from(sessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.openedAt));
  res.json(data);
});

// ─── Get single session with full timeline ────────────────────

sessionsRouter.get("/:id", async (req, res) => {
  const { db } = req;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, String(req.params.id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const events = await db.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(sessionEvents.sortOrder);

  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.sessionId, session.id))
    .orderBy(lotEntries.lotOrder);

  // Fetch downtimes for all lots
  const lotIds = lots.map(l => l.id);
  let allDowntimes: (typeof downtimeEvents.$inferSelect)[] = [];
  for (const lotId of lotIds) {
    const dts = await db.select().from(downtimeEvents).where(eq(downtimeEvents.lotEntryId, lotId));
    allDowntimes.push(...dts);
  }

  res.json({ session, events, lots, downtimes: allDowntimes });
});

// ─── Open a new session (compteur) ────────────────────────────

sessionsRouter.post("/open", async (req, res) => {
  const { db, userId } = req;
  const { equipmentId, roomId } = req.body;
  if (!equipmentId || !roomId || !userId) {
    res.status(400).json({ error: "equipmentId, roomId requis" });
    return;
  }

  // Check no active session for this equipment
  const [existing] = await db.select().from(sessions)
    .where(and(eq(sessions.equipmentId, equipmentId), eq(sessions.status, "active")))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Session déjà active pour cet équipement", sessionId: existing.id });
    return;
  }

  const now = new Date();
  const sessionDate = now.toISOString().slice(0, 10);

  const [session] = await db.insert(sessions).values({
    equipmentId,
    roomId,
    operatorId: userId,
    sessionDate,
    openedAt: now,
    status: "active",
  }).returning();

  res.status(201).json(session);
});

// ─── Close a session ──────────────────────────────────────────

sessionsRouter.post("/:id/close", async (req, res) => {
  const { db } = req;
  const now = new Date();

  // Close any active lots first
  await db.update(lotEntries)
    .set({ status: "closed", endedAt: now })
    .where(and(eq(lotEntries.sessionId, String(req.params.id)), eq(lotEntries.status, "active")));

  // Close any open events
  const openEvents = await db.select().from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, String(req.params.id))));
  for (const ev of openEvents) {
    if (!ev.endedAt) {
      const dur = diffMinutes(ev.startedAt, now);
      await db.update(sessionEvents).set({ endedAt: now, durationMinutes: dur }).where(eq(sessionEvents.id, ev.id));
    }
  }

  const [session] = await db.update(sessions)
    .set({ status: "closed", closedAt: now })
    .where(eq(sessions.id, String(req.params.id)))
    .returning();

  res.json(session);
});

// ─── Add session event (phase) ────────────────────────────────

sessionsRouter.post("/:id/events", async (req, res) => {
  const { db } = req;
  const { eventType, label, durationMinutes, isPlanned, comment } = req.body;

  // Get max sort order
  const existing = await db.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, String(req.params.id)));
  const maxOrder = existing.reduce((max, e) => Math.max(max, e.sortOrder), 0);

  const now = new Date();
  const endedAt = durationMinutes ? new Date(now.getTime() + durationMinutes * 60_000) : undefined;

  const [event] = await db.insert(sessionEvents).values({
    sessionId: String(req.params.id),
    eventType,
    label,
    startedAt: now,
    endedAt,
    durationMinutes: durationMinutes || undefined,
    isPlanned: isPlanned ?? true,
    sortOrder: maxOrder + 1,
    comment,
  }).returning();

  res.status(201).json(event);
});

// ─── Get session TRS (computed) ───────────────────────────────

sessionsRouter.get("/:id/trs", async (req, res) => {
  const { db } = req;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, String(req.params.id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const closedAt = session.closedAt ?? new Date();

  // Get planned stops from session events
  const events = await db.select().from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.isPlanned, true)));
  const plannedStopsMin = events.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

  // Get lots with their downtimes
  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.sessionId, session.id))
    .orderBy(lotEntries.lotOrder);

  const lotResults = [];
  for (const lot of lots) {
    const dts = await db.select().from(downtimeEvents).where(eq(downtimeEvents.lotEntryId, lot.id));
    const lotTrs = computeLotTrs({
      cadence: Number(lot.cadenceUsed),
      cadenceUnit: lot.cadenceUnit as "u/h" | "u/min",
      produced: lot.quantityProduced,
      conforming: lot.quantityConforming,
      startedAt: lot.startedAt,
      endedAt: lot.endedAt ?? closedAt,
      downtimes: dts.map(d => ({
        durationMinutes: d.durationMinutes,
        isPlanned: false, // lot-level downtimes are unplanned
      })),
    });
    if (lotTrs) {
      lotResults.push({ ...lotTrs, produced: lot.quantityProduced, conforming: lot.quantityConforming, lotId: lot.id, batchNumber: lot.batchNumber });
    }
  }

  const sessionTrs = computeSessionTrs({
    openedAt: session.openedAt,
    closedAt,
    plannedStopsMin,
    lots: lotResults,
  });

  res.json({ session: sessionTrs, lots: lotResults });
});
