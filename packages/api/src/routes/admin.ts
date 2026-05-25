import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { rooms, equipments, products, downtimeCategories, productEquipmentCadences } from "@trs/db";
import { authenticate, requireRole } from "../middleware";

export const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole("admin", "supervisor"));

// ─── Rooms CRUD ─────────────────────────────────────────

adminRouter.get("/rooms", async (req, res) => {
  const data = await req.db.select().from(rooms).orderBy(rooms.name);
  res.json(data);
});

adminRouter.post("/rooms", async (req, res) => {
  const { code, name, description } = req.body;
  if (!code || !name) { res.status(400).json({ error: "code et name requis" }); return; }
  const [row] = await req.db.insert(rooms).values({ code, name, description }).returning();
  res.status(201).json(row);
});

adminRouter.patch("/rooms/:id", async (req, res) => {
  const { code, name, description, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(rooms).set(updates).where(eq(rooms.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Local introuvable" }); return; }
  res.json(row);
});

adminRouter.delete("/rooms/:id", async (req, res) => {
  const [row] = await req.db.update(rooms).set({ isActive: false }).where(eq(rooms.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Local introuvable" }); return; }
  res.json(row);
});

// ─── Equipments CRUD ────────────────────────────────────

adminRouter.get("/equipments", async (req, res) => {
  const data = await req.db.select().from(equipments).orderBy(equipments.name);
  res.json(data);
});

adminRouter.post("/equipments", async (req, res) => {
  const { code, name, roomId, equipmentType, trsObjective, defaultCadenceUnit, microStopThresholdMin } = req.body;
  if (!code || !name || !roomId) { res.status(400).json({ error: "code, name et roomId requis" }); return; }
  const [row] = await req.db.insert(equipments).values({
    code, name, roomId, equipmentType,
    trsObjective: trsObjective || "75",
    defaultCadenceUnit: defaultCadenceUnit || "u/min",
    microStopThresholdMin: microStopThresholdMin ?? 5,
  }).returning();
  res.status(201).json(row);
});

adminRouter.patch("/equipments/:id", async (req, res) => {
  const { code, name, roomId, equipmentType, trsObjective, defaultCadenceUnit, isActive, microStopThresholdMin } = req.body;
  const updates: Record<string, unknown> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (roomId !== undefined) updates.roomId = roomId;
  if (equipmentType !== undefined) updates.equipmentType = equipmentType;
  if (trsObjective !== undefined) updates.trsObjective = trsObjective;
  if (defaultCadenceUnit !== undefined) updates.defaultCadenceUnit = defaultCadenceUnit;
  if (microStopThresholdMin !== undefined) updates.microStopThresholdMin = Number(microStopThresholdMin);
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(equipments).set(updates).where(eq(equipments.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Equipement introuvable" }); return; }
  res.json(row);
});

adminRouter.delete("/equipments/:id", async (req, res) => {
  const [row] = await req.db.update(equipments).set({ isActive: false }).where(eq(equipments.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Equipement introuvable" }); return; }
  res.json(row);
});

// ─── Products CRUD ──────────────────────────────────────

adminRouter.get("/products", async (req, res) => {
  const data = await req.db.select().from(products).orderBy(products.name);
  res.json(data);
});

adminRouter.post("/products", async (req, res) => {
  const { code, name, defaultCadence, cadenceUnit, unit } = req.body;
  if (!code || !name) { res.status(400).json({ error: "code et name requis" }); return; }
  const [row] = await req.db.insert(products).values({
    code, name,
    defaultCadence: defaultCadence || null,
    cadenceUnit: cadenceUnit || "u/min",
    unit: unit || "unités",
  }).returning();
  res.status(201).json(row);
});

adminRouter.patch("/products/:id", async (req, res) => {
  const { code, name, defaultCadence, cadenceUnit, unit, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (defaultCadence !== undefined) updates.defaultCadence = defaultCadence;
  if (cadenceUnit !== undefined) updates.cadenceUnit = cadenceUnit;
  if (unit !== undefined) updates.unit = unit;
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(products).set(updates).where(eq(products.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Produit introuvable" }); return; }
  res.json(row);
});

adminRouter.delete("/products/:id", async (req, res) => {
  const [row] = await req.db.update(products).set({ isActive: false }).where(eq(products.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Produit introuvable" }); return; }
  res.json(row);
});

// ─── Downtime Categories CRUD ───────────────────────────

adminRouter.get("/downtime-categories", async (req, res) => {
  const data = await req.db.select().from(downtimeCategories).orderBy(downtimeCategories.famille, downtimeCategories.label);
  res.json(data);
});

adminRouter.post("/downtime-categories", async (req, res) => {
  const { code, label, famille, isPlanned, appliesToEquipmentType } = req.body;
  if (!code || !label || !famille) { res.status(400).json({ error: "code, label et famille requis" }); return; }
  const [row] = await req.db.insert(downtimeCategories).values({
    code, label, famille,
    isPlanned: isPlanned ?? false,
    appliesToEquipmentType: appliesToEquipmentType || null,
  }).returning();
  res.status(201).json(row);
});

adminRouter.patch("/downtime-categories/:id", async (req, res) => {
  const { code, label, famille, isPlanned, appliesToEquipmentType, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (code !== undefined) updates.code = code;
  if (label !== undefined) updates.label = label;
  if (famille !== undefined) updates.famille = famille;
  if (isPlanned !== undefined) updates.isPlanned = isPlanned;
  if (appliesToEquipmentType !== undefined) updates.appliesToEquipmentType = appliesToEquipmentType || null;
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(downtimeCategories).set(updates).where(eq(downtimeCategories.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Categorie introuvable" }); return; }
  res.json(row);
});

adminRouter.delete("/downtime-categories/:id", async (req, res) => {
  const [row] = await req.db.update(downtimeCategories).set({ isActive: false }).where(eq(downtimeCategories.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Categorie introuvable" }); return; }
  res.json(row);
});

// ─── Product × Equipment Cadences CRUD ──────────────────

adminRouter.get("/cadences", async (req, res) => {
  const data = await req.db.select().from(productEquipmentCadences);
  res.json(data);
});

adminRouter.post("/cadences", async (req, res) => {
  const { productId, equipmentId, cadenceValue, cadenceUnit } = req.body;
  if (!productId || !equipmentId || !cadenceValue) {
    res.status(400).json({ error: "productId, equipmentId et cadenceValue requis" }); return;
  }
  const { trsObjective } = req.body;
  const [row] = await req.db.insert(productEquipmentCadences).values({
    productId, equipmentId,
    cadenceValue: String(cadenceValue),
    cadenceUnit: cadenceUnit || "u/min",
    trsObjective: trsObjective != null ? String(trsObjective) : null,
  }).onConflictDoUpdate({
    target: [productEquipmentCadences.productId, productEquipmentCadences.equipmentId],
    set: {
      cadenceValue: String(cadenceValue),
      cadenceUnit: cadenceUnit || "u/min",
      trsObjective: trsObjective != null ? String(trsObjective) : null,
    },
  }).returning();
  res.status(201).json(row);
});

adminRouter.delete("/cadences/:id", async (req, res) => {
  const [row] = await req.db.delete(productEquipmentCadences).where(eq(productEquipmentCadences.id, req.params.id)).returning();
  if (!row) { res.status(404).json({ error: "Cadence introuvable" }); return; }
  res.json(row);
});
