import { Router } from "express";
import { eq, and, or, isNull, asc } from "drizzle-orm";
import { rooms, equipments, products, downtimeCategories, productEquipmentCadences } from "@trs/db";

import { authenticate } from "../middleware";
import { asyncHandler } from "../lib/http";

export const refRouter = Router();
refRouter.use(authenticate);

refRouter.get("/rooms", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(rooms).where(eq(rooms.isActive, true)).orderBy(asc(rooms.name));
  res.json(data);
}));

refRouter.get("/rooms/:roomId/equipments", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments)
    .where(and(eq(equipments.roomId, String(req.params.roomId)), eq(equipments.isActive, true)))
    .orderBy(asc(equipments.name));
  res.json(data);
}));

refRouter.get("/equipments", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments).where(eq(equipments.isActive, true)).orderBy(asc(equipments.name));
  res.json(data);
}));

refRouter.get("/products", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name));
  res.json(data);
}));

refRouter.get("/downtime-categories", asyncHandler(async (req, res) => {
  const { db } = req;
  const { equipmentType: eqType } = req.query as { equipmentType?: string };
  const typeFilter = eqType
    ? or(isNull(downtimeCategories.appliesToEquipmentType), eq(downtimeCategories.appliesToEquipmentType, eqType))
    : undefined;
  const data = await db.select().from(downtimeCategories)
    .where(and(eq(downtimeCategories.isActive, true), typeFilter))
    .orderBy(asc(downtimeCategories.famille), asc(downtimeCategories.label));
  res.json(data);
}));

refRouter.get("/cadences", asyncHandler(async (req, res) => {
  const { db } = req;
  const { equipmentId } = req.query as { equipmentId?: string };
  const data = equipmentId
    ? await db.select().from(productEquipmentCadences).where(eq(productEquipmentCadences.equipmentId, equipmentId))
    : await db.select().from(productEquipmentCadences);
  res.json(data);
}));
