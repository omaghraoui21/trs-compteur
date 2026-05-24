import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { rooms, equipments, products, downtimeCategories } from "@trs/db";

import { authenticate } from "../middleware";

export const refRouter = Router();
refRouter.use(authenticate);

refRouter.get("/rooms", async (req, res) => {
  const { db } = req;
  const data = await db.select().from(rooms).where(eq(rooms.isActive, true));
  res.json(data);
});

refRouter.get("/rooms/:roomId/equipments", async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments)
    .where(and(eq(equipments.roomId, String(req.params.roomId)), eq(equipments.isActive, true)));
  res.json(data);
});

refRouter.get("/equipments", async (req, res) => {
  const { db } = req;
  const data = await db.select().from(equipments).where(eq(equipments.isActive, true));
  res.json(data);
});

refRouter.get("/products", async (req, res) => {
  const { db } = req;
  const data = await db.select().from(products).where(eq(products.isActive, true));
  res.json(data);
});

refRouter.get("/downtime-categories", async (req, res) => {
  const { db } = req;
  const eqType = req.query.equipmentType as string | undefined;
  let data = await db.select().from(downtimeCategories).where(eq(downtimeCategories.isActive, true));
  if (eqType) {
    data = data.filter(c => !c.appliesToEquipmentType || c.appliesToEquipmentType === eqType);
  }
  res.json(data);
});
