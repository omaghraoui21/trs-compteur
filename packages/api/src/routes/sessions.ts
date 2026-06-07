import { Router } from "express";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { sessions, sessionEvents, lotEntries, downtimeEvents, downtimeCategories, lotCadenceChanges } from "@trs/db";
import { computeLotTrs, computeSessionTrs, diffMinutes } from "@trs/engine";
import { authenticate } from "../middleware";
import { asyncHandler, validate, validateQuery } from "../lib/http";
import { audit } from "../lib/audit";
import { effectiveLotCadence } from "../lib/cadence";
import { groupBy, splitPlannedUnplanned } from "../lib/group";
import { openSessionSchema, addEventSchema, addDowntimeSchema, sessionListQuerySchema } from "../schemas";

export const sessionsRouter = Router();
sessionsRouter.use(authenticate);

// ─── List sessions (with optional date/equipment filter) ─────

sessionsRouter.get("/", validateQuery(sessionListQuerySchema), asyncHandler(async (req, res) => {
  const { db } = req;
  const { date, equipmentId } = req.query;
  let conditions = [];
  if (date) conditions.push(eq(sessions.sessionDate, date as string));
  if (equipmentId) conditions.push(eq(sessions.equipmentId, equipmentId as string));
  const data = await db.select().from(sessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.openedAt));
  res.json(data);
}));

// ─── Get single session with full timeline ────────────────────

sessionsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { db } = req;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, String(req.params.id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const events = await db.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(sessionEvents.sortOrder);

  const lots = await db.select().from(lotEntries)
    .where(eq(lotEntries.sessionId, session.id))
    .orderBy(lotEntries.lotOrder);

  // Downtimes attached to this session's lots (during production) …
  const lotIds = lots.map(l => l.id);
  const lotDowntimes = lotIds.length > 0
    ? await db.select().from(downtimeEvents).where(inArray(downtimeEvents.lotEntryId, lotIds))
    : [];
  // … plus session-level downtimes (inter-lot: changeover, cleaning, waiting).
  const sessionDowntimes = await db.select().from(downtimeEvents)
    .where(eq(downtimeEvents.sessionId, session.id));

  res.json({ session, events, lots, downtimes: [...lotDowntimes, ...sessionDowntimes] });
}));

// ─── Open a new session (compteur) ────────────────────────────

sessionsRouter.post("/open", validate(openSessionSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { equipmentId, roomId } = req.body;
  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }

  // Check no active session for this equipment
  const [existing] = await db.select().from(sessions)
    .where(and(eq(sessions.equipmentId, equipmentId), eq(sessions.status, "active")))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Session déjà active pour cet équipement", sessionId: existing.id });
    return;
  }

  const now = new Date();
  // Shift date must follow the plant's local calendar day, not UTC — otherwise a
  // night shift opened just after local midnight is misdated. en-CA yields
  // YYYY-MM-DD. Configure the plant timezone via APP_TIMEZONE (default Paris).
  const tz = process.env.APP_TIMEZONE || "Europe/Paris";
  const sessionDate = now.toLocaleDateString("en-CA", { timeZone: tz });

  const [session] = await db.insert(sessions).values({
    equipmentId,
    roomId,
    operatorId: userId,
    sessionDate,
    openedAt: now,
    status: "active",
  }).returning();

  await audit(db, req, "OPEN_SESSION", "session", session.id, { equipmentId, roomId });
  res.status(201).json(session);
}));

// ─── Close a session ──────────────────────────────────────────

sessionsRouter.post("/:id/close", asyncHandler(async (req, res) => {
  const { db, userId, userRole } = req;
  const now = new Date();

  // H1: Operators may only close their own sessions
  if (userRole === "operator") {
    const [session] = await db.select({ operatorId: sessions.operatorId })
      .from(sessions).where(eq(sessions.id, String(req.params.id))).limit(1);
    if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }
    if (session.operatorId !== userId) { res.status(403).json({ error: "Accès interdit" }); return; }
  }

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

  if (session) await audit(db, req, "CLOSE_SESSION", "session", session.id, {});
  res.json(session);
}));

// ─── Add session event (phase) ────────────────────────────────

sessionsRouter.post("/:id/events", validate(addEventSchema), asyncHandler(async (req, res) => {
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
}));

// ─── Add a SESSION-LEVEL downtime (inter-lot, no active lot) ──────────
// Used for changeover / cleaning / waiting that happen between lots. The
// operator records a stop classified planned/unplanned exactly like a
// lot-level one, but it attaches to the session instead of a lot.

sessionsRouter.post("/:id/downtimes", validate(addDowntimeSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { categoryId, durationMinutes, isShortStop, comment } = req.body;
  const sessionId = String(req.params.id);

  const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const now = new Date();
  const endedAt = new Date(now.getTime() + durationMinutes * 60_000);

  const [dt] = await db.insert(downtimeEvents).values({
    sessionId,
    lotEntryId: null,
    categoryId,
    startedAt: now,
    endedAt,
    durationMinutes,
    status: "closed",
    isShortStop: isShortStop ?? null,
    comment,
    createdBy: userId,
  }).returning();

  await audit(db, req, "ADD_SESSION_DOWNTIME", "downtime", dt.id, { sessionId, categoryId, durationMinutes });
  res.status(201).json(dt);
}));

// ─── Get session TRS (computed) ───────────────────────────────

sessionsRouter.get("/:id/trs", asyncHandler(async (req, res) => {
  const { db } = req;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, String(req.params.id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const closedAt = session.closedAt ?? new Date();

  // Three independent reads — run them concurrently:
  //  1. session-level stops (inter-lot), category-joined for the planned/unplanned split
  //  2. legacy planned phases (sessionEvents) — still count toward tAP during transition
  //  3. lots (with their lot-level downtimes fetched below)
  const [sessionDts, events, lots] = await Promise.all([
    db.select({
      durationMinutes: downtimeEvents.durationMinutes,
      isPlanned: downtimeCategories.isPlanned,
    }).from(downtimeEvents)
      .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
      .where(and(eq(downtimeEvents.sessionId, session.id), isNull(downtimeEvents.lotEntryId))),
    db.select().from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.isPlanned, true))),
    db.select().from(lotEntries)
      .where(eq(lotEntries.sessionId, session.id))
      .orderBy(lotEntries.lotOrder),
  ]);

  const { plannedMin: sessionPlannedMin, unplannedMin: sessionUnplannedMin } = splitPlannedUnplanned(sessionDts);
  const legacyPhasePlannedMin = events.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);
  const plannedStopsMin = sessionPlannedMin + legacyPhasePlannedMin;

  // Two batched lot-level reads (downtimes + cadence changes), run concurrently.
  const lotIds2 = lots.map(l => l.id);
  const [allDts, cadenceChanges] = lotIds2.length > 0
    ? await Promise.all([
        db.select({
          lotEntryId: downtimeEvents.lotEntryId,
          durationMinutes: downtimeEvents.durationMinutes,
          famille: downtimeCategories.famille,
          isPlanned: downtimeCategories.isPlanned,
        }).from(downtimeEvents)
          .innerJoin(downtimeCategories, eq(downtimeEvents.categoryId, downtimeCategories.id))
          .where(inArray(downtimeEvents.lotEntryId, lotIds2)),
        db.select().from(lotCadenceChanges).where(inArray(lotCadenceChanges.lotEntryId, lotIds2)),
      ])
    : [[], []];

  const dtsByLot = groupBy(allDts.filter(d => d.lotEntryId), d => d.lotEntryId!);
  const changesByLot = groupBy(cadenceChanges, c => c.lotEntryId);

  const lotResults = [];
  let lotsDurationMin = 0;
  for (const lot of lots) {
    const dts = dtsByLot.get(lot.id) ?? [];
    const eff = effectiveLotCadence(lot, changesByLot.get(lot.id));
    const lotTrs = computeLotTrs({
      cadence: eff.initialCadence,
      cadenceUnit: eff.initialUnit,
      cadenceChanges: eff.cadenceChanges,
      produced: lot.quantityProduced,
      conforming: lot.quantityConforming,
      startedAt: lot.startedAt,
      endedAt: lot.endedAt ?? closedAt,
      downtimes: dts.map(d => ({
        durationMinutes: d.durationMinutes,
        isPlanned: d.isPlanned,
        famille: d.famille,
      })),
    });
    if (lotTrs) {
      lotsDurationMin += lotTrs.lotDurationMin;
      lotResults.push({ ...lotTrs, produced: lot.quantityProduced, conforming: lot.quantityConforming, lotId: lot.id, batchNumber: lot.batchNumber });
    }
  }

  const sessionTrs = computeSessionTrs({
    openedAt: session.openedAt,
    closedAt,
    plannedStopsMin,
    unplannedStopsMin: sessionUnplannedMin,
    lots: lotResults,
  });

  // « À classer » — session time covered neither by a lot nor by a declared
  // session-level stop. Must tend to 0; surfaced so the operator/supervisor
  // can assign every minute a reason (Reason Codes model).
  const aClasserMin = Math.max(0, Math.round(sessionTrs.tO - lotsDurationMin - sessionPlannedMin - sessionUnplannedMin));

  res.json({ session: sessionTrs, lots: lotResults, aClasserMin });
}));
