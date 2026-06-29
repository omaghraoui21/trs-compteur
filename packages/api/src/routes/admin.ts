import { Router } from "express";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { rooms, equipments, products, downtimeCategories, productEquipmentCadences, users, auditLog } from "@trs/db";
import { authenticate, requireRole } from "../middleware";
import { asyncHandler, validate, validateQuery, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import {
  createRoomSchema, updateRoomSchema,
  createEquipmentSchema, updateEquipmentSchema,
  createProductSchema, updateProductSchema,
  createDowntimeCategorySchema, updateDowntimeCategorySchema,
  createCadenceSchema,
  createUserSchema, updateUserSchema, resetPasswordSchema,
  auditLogQuerySchema,
} from "../schemas";

export const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole("admin", "supervisor"));

// ─── Rooms CRUD ─────────────────────────────────────────

adminRouter.get("/rooms", asyncHandler(async (req, res) => {
  const data = await req.db.select().from(rooms).orderBy(rooms.name);
  res.json(data);
}));

adminRouter.post("/rooms", validate(createRoomSchema), asyncHandler(async (req, res) => {
  const { code, name, description } = req.body;
  const [row] = await req.db.insert(rooms).values({ code, name, description }).returning();
  await audit(req.db, req, "CREATE_ROOM", "room", row.id, { code, name });
  res.status(201).json(row);
}));

adminRouter.patch("/rooms/:id", validate(updateRoomSchema), asyncHandler(async (req, res) => {
  const { code, name, description, isActive } = req.body;
  const updates: Partial<{ code: string; name: string; description: string; isActive: boolean }> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(rooms).set(updates).where(eq(rooms.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Local introuvable" }); return; }
  await audit(req.db, req, "UPDATE_ROOM", "room", row.id, updates);
  res.json(row);
}));

adminRouter.delete("/rooms/:id", asyncHandler(async (req, res) => {
  const [row] = await req.db.update(rooms).set({ isActive: false }).where(eq(rooms.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Local introuvable" }); return; }
  await audit(req.db, req, "DEACTIVATE_ROOM", "room", row.id, {});
  res.json(row);
}));

// ─── Equipments CRUD ────────────────────────────────────

adminRouter.get("/equipments", asyncHandler(async (req, res) => {
  const data = await req.db.select().from(equipments).orderBy(equipments.name);
  res.json(data);
}));

adminRouter.post("/equipments", validate(createEquipmentSchema), asyncHandler(async (req, res) => {
  const { code, name, roomId, equipmentType, trsObjective, defaultCadenceUnit, microStopThresholdMin } = req.body;
  const [row] = await req.db.insert(equipments).values({
    code, name, roomId, equipmentType,
    trsObjective: trsObjective || "75",
    defaultCadenceUnit: defaultCadenceUnit || "u/min",
    microStopThresholdMin: microStopThresholdMin ?? 5,
  }).returning();
  await audit(req.db, req, "CREATE_EQUIPMENT", "equipment", row.id, { code, name });
  res.status(201).json(row);
}));

adminRouter.patch("/equipments/:id", validate(updateEquipmentSchema), asyncHandler(async (req, res) => {
  const { code, name, roomId, equipmentType, trsObjective, defaultCadenceUnit, isActive, microStopThresholdMin } = req.body;
  const updates: Partial<{ code: string; name: string; roomId: string; equipmentType: string; trsObjective: string; defaultCadenceUnit: string; isActive: boolean; microStopThresholdMin: number }> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (roomId !== undefined) updates.roomId = roomId;
  if (equipmentType !== undefined) updates.equipmentType = equipmentType;
  if (trsObjective !== undefined) updates.trsObjective = trsObjective;
  if (defaultCadenceUnit !== undefined) updates.defaultCadenceUnit = defaultCadenceUnit;
  if (microStopThresholdMin !== undefined) updates.microStopThresholdMin = Number(microStopThresholdMin);
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(equipments).set(updates).where(eq(equipments.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Equipement introuvable" }); return; }
  await audit(req.db, req, "UPDATE_EQUIPMENT", "equipment", row.id, updates);
  res.json(row);
}));

adminRouter.delete("/equipments/:id", asyncHandler(async (req, res) => {
  const [row] = await req.db.update(equipments).set({ isActive: false }).where(eq(equipments.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Equipement introuvable" }); return; }
  await audit(req.db, req, "DEACTIVATE_EQUIPMENT", "equipment", row.id, {});
  res.json(row);
}));

// ─── Products CRUD ──────────────────────────────────────

adminRouter.get("/products", asyncHandler(async (req, res) => {
  const data = await req.db.select().from(products).orderBy(products.name);
  res.json(data);
}));

adminRouter.post("/products", validate(createProductSchema), asyncHandler(async (req, res) => {
  const { code, name, defaultCadence, cadenceUnit, unit } = req.body;
  const [row] = await req.db.insert(products).values({
    code, name,
    defaultCadence: defaultCadence || null,
    cadenceUnit: cadenceUnit || "u/min",
    unit: unit || "unités",
  }).returning();
  await audit(req.db, req, "CREATE_PRODUCT", "product", row.id, { code, name });
  res.status(201).json(row);
}));

adminRouter.patch("/products/:id", validate(updateProductSchema), asyncHandler(async (req, res) => {
  const { code, name, defaultCadence, cadenceUnit, unit, isActive } = req.body;
  const updates: Partial<{ code: string; name: string; defaultCadence: string; cadenceUnit: string; unit: string; isActive: boolean }> = {};
  if (code !== undefined) updates.code = code;
  if (name !== undefined) updates.name = name;
  if (defaultCadence !== undefined) updates.defaultCadence = defaultCadence;
  if (cadenceUnit !== undefined) updates.cadenceUnit = cadenceUnit;
  if (unit !== undefined) updates.unit = unit;
  if (isActive !== undefined) updates.isActive = isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(products).set(updates).where(eq(products.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Produit introuvable" }); return; }
  await audit(req.db, req, "UPDATE_PRODUCT", "product", row.id, updates);
  res.json(row);
}));

adminRouter.delete("/products/:id", asyncHandler(async (req, res) => {
  const [row] = await req.db.update(products).set({ isActive: false }).where(eq(products.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Produit introuvable" }); return; }
  await audit(req.db, req, "DEACTIVATE_PRODUCT", "product", row.id, {});
  res.json(row);
}));

// ─── Downtime Categories CRUD ───────────────────────────

adminRouter.get("/downtime-categories", asyncHandler(async (req, res) => {
  const data = await req.db.select().from(downtimeCategories).orderBy(downtimeCategories.famille, downtimeCategories.label);
  res.json(data);
}));

adminRouter.post("/downtime-categories", validate(createDowntimeCategorySchema), asyncHandler(async (req, res) => {
  const { code, label, famille, isPlanned, appliesToEquipmentType } = req.body;
  const [row] = await req.db.insert(downtimeCategories).values({
    code, label, famille,
    isPlanned: isPlanned ?? false,
    appliesToEquipmentType: appliesToEquipmentType || null,
  }).returning();
  await audit(req.db, req, "CREATE_DOWNTIME_CATEGORY", "downtimeCategory", row.id, { code, label, famille });
  res.status(201).json(row);
}));

adminRouter.patch("/downtime-categories/:id", validate(updateDowntimeCategorySchema), asyncHandler(async (req, res) => {
  const { code, label, famille, isPlanned, appliesToEquipmentType, isActive, isFavorite, favoriteOrder } = req.body;
  const updates: Partial<{ code: string; label: string; famille: string; isPlanned: boolean; appliesToEquipmentType: string | null; isActive: boolean; isFavorite: boolean; favoriteOrder: number | null }> = {};
  if (code !== undefined) updates.code = code;
  if (label !== undefined) updates.label = label;
  if (famille !== undefined) updates.famille = famille;
  if (isPlanned !== undefined) updates.isPlanned = isPlanned;
  if (appliesToEquipmentType !== undefined) updates.appliesToEquipmentType = appliesToEquipmentType || null;
  if (isActive !== undefined) updates.isActive = isActive;
  if (isFavorite !== undefined) updates.isFavorite = isFavorite;
  if (favoriteOrder !== undefined) updates.favoriteOrder = favoriteOrder;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucune mise à jour" }); return; }
  const [row] = await req.db.update(downtimeCategories).set(updates).where(eq(downtimeCategories.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Categorie introuvable" }); return; }
  await audit(req.db, req, "UPDATE_DOWNTIME_CATEGORY", "downtimeCategory", row.id, updates);
  res.json(row);
}));

adminRouter.delete("/downtime-categories/:id", asyncHandler(async (req, res) => {
  const [row] = await req.db.update(downtimeCategories).set({ isActive: false }).where(eq(downtimeCategories.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Categorie introuvable" }); return; }
  await audit(req.db, req, "DEACTIVATE_DOWNTIME_CATEGORY", "downtimeCategory", row.id, {});
  res.json(row);
}));

// ─── Product × Equipment Cadences CRUD ──────────────────

adminRouter.get("/cadences", asyncHandler(async (req, res) => {
  const data = await req.db.select().from(productEquipmentCadences);
  res.json(data);
}));

adminRouter.post("/cadences", validate(createCadenceSchema), asyncHandler(async (req, res) => {
  const { productId, equipmentId, cadenceValue, cadenceUnit, trsObjective } = req.body;
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
  await audit(req.db, req, "UPSERT_CADENCE", "cadence", row.id, { productId, equipmentId, cadenceValue });
  res.status(201).json(row);
}));

adminRouter.delete("/cadences/:id", asyncHandler(async (req, res) => {
  const [row] = await req.db.delete(productEquipmentCadences).where(eq(productEquipmentCadences.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Cadence introuvable" }); return; }
  await audit(req.db, req, "DELETE_CADENCE", "cadence", row.id, {});
  res.json(row);
}));

// ─── Users (admin-only) ─────────────────────────────────
// The router already requires admin|supervisor; user management is stricter
// (admin only). Passwords are never returned. Self-lockout is prevented.

const adminOnly = requireRole("admin");
const publicUser = {
  id: users.id, email: users.email, displayName: users.displayName,
  role: users.role, isActive: users.isActive, createdAt: users.createdAt,
};

adminRouter.get("/users", adminOnly, asyncHandler(async (req, res) => {
  const rows = await req.db.select(publicUser).from(users).orderBy(users.createdAt);
  res.json(rows);
}));

adminRouter.post("/users", adminOnly, validate(createUserSchema), asyncHandler(async (req, res) => {
  const { email, displayName, password, role } = req.body;
  const [existing] = await req.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new HttpError(409, "Cet email est déjà utilisé");
  const passwordHash = await bcrypt.hash(password, 10);
  const [row] = await req.db.insert(users).values({ email, displayName, passwordHash, role }).returning(publicUser);
  await audit(req.db, req, "CREATE_USER", "user", row.id, { email, role });
  res.status(201).json(row);
}));

adminRouter.patch("/users/:id", adminOnly, validate(updateUserSchema), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (Object.keys(req.body).length === 0) throw new HttpError(400, "Aucune mise à jour");
  // Guard against self-lockout: an admin cannot demote or deactivate themselves.
  if (id === req.userId) {
    if (req.body.isActive === false) throw new HttpError(400, "Vous ne pouvez pas désactiver votre propre compte");
    if (req.body.role && req.body.role !== "admin") throw new HttpError(400, "Vous ne pouvez pas changer votre propre rôle");
  }
  const [row] = await req.db.update(users).set(req.body).where(eq(users.id, id)).returning(publicUser);
  if (!row) throw new HttpError(404, "Utilisateur introuvable");
  await audit(req.db, req, "UPDATE_USER", "user", id, req.body);
  res.json(row);
}));

adminRouter.post("/users/:id/password", adminOnly, validate(resetPasswordSchema), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const passwordHash = await bcrypt.hash(req.body.password, 10);
  const [row] = await req.db.update(users).set({ passwordHash }).where(eq(users.id, id)).returning(publicUser);
  if (!row) throw new HttpError(404, "Utilisateur introuvable");
  await audit(req.db, req, "RESET_PASSWORD", "user", id, {});
  res.json(row);
}));

// ─── Audit log viewer (admin + supervisor read-only, GMP traceability) ──────
adminRouter.get("/audit-log", validateQuery(auditLogQuerySchema), asyncHandler(async (req, res) => {
  const { entityType, entityId, action, from, to, limit: limitQ, offset: offsetQ } = req.query as {
    entityType?: string; entityId?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number;
  };
  const limit = limitQ ?? 50;
  const offset = offsetQ ?? 0;

  const filters: ReturnType<typeof and>[] = [];
  if (entityType) filters.push(eq(auditLog.entityType, entityType));
  if (entityId) filters.push(eq(auditLog.entityId, entityId));
  if (action) filters.push(eq(auditLog.action, action));
  if (from) filters.push(gte(auditLog.createdAt, new Date(from + "T00:00:00Z")));
  if (to) filters.push(lte(auditLog.createdAt, new Date(to + "T23:59:59Z")));

  const rows = await req.db
    .select()
    .from(auditLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
}));
