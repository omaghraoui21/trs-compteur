import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { rooms, equipments, products, downtimeCategories, productEquipmentCadences } from "@trs/db";

import { authenticate } from "../middleware";
import { asyncHandler } from "../lib/http";

export const refRouter = Router();
refRouter.use(authenticate);

refRouter.get("/rooms", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(rooms).where(eq(rooms.isActive, true));
  res.json(data);
}));

refRouter.get("/rooms/:roomId/equipments", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments)
    .where(and(eq(equipments.roomId, String(req.params.roomId)), eq(equipments.isActive, true)));
  res.json(data);
}));

refRouter.get("/equipments", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments).where(eq(equipments.isActive, true));
  res.json(data);
}));

refRouter.get("/products", asyncHandler(async (req, res) => {
  const { db } = req;
  const data = await db.select().from(products).where(eq(products.isActive, true));
  res.json(data);
}));

refRouter.get("/downtime-categories", asyncHandler(async (req, res) => {
  const { db } = req;
  const eqType = req.query.equipmentType as string | undefined;
  let data = await db.select().from(downtimeCategories).where(eq(downtimeCategories.isActive, true));
  if (eqType) {
    data = data.filter(c => !c.appliesToEquipmentType || c.appliesToEquipmentType === eqType);
  }
  res.json(data);
}));

refRouter.get("/cadences", asyncHandler(async (req, res) => {
  const { db } = req;
  const equipmentId = req.query.equipmentId as string | undefined;
  const data = equipmentId
    ? await db.select().from(productEquipmentCadences).where(eq(productEquipmentCadences.equipmentId, equipmentId))
    : await db.select().from(productEquipmentCadences);
  res.json(data);
}));
