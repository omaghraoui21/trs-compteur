import { z } from "zod";

const cadenceUnit = z.enum(["u/min", "u/h"]);

const eventType = z.enum([
  "nettoyage",
  "vide_ligne",
  "remplissage",
  "pause",
  "chsb",
  "chsg",
  "apr",
  "mqch",
  "lot_start",
  "lot_end",
  "custom",
]);

export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const openSessionSchema = z.object({
  equipmentId: z.string().uuid("equipmentId invalide"),
  roomId: z.string().uuid("roomId invalide"),
});

export const addEventSchema = z.object({
  eventType,
  label: z.string().optional(),
  durationMinutes: z.number().min(0, "Durée invalide").optional(),
  isPlanned: z.boolean().optional(),
  comment: z.string().optional(),
});

export const startLotSchema = z.object({
  sessionId: z.string().uuid("sessionId invalide"),
  productId: z.string().uuid("productId invalide"),
  batchNumber: z.string().min(1, "Numéro de lot requis"),
  cadenceUsed: z.number().positive("Cadence doit être positive"),
  cadenceUnit: cadenceUnit.optional(),
});

const quantityFields = {
  quantityProduced: z.number().int().min(0, "Quantité produite invalide"),
  quantityConforming: z.number().int().min(0, "Quantité conforme invalide"),
  quantityRejected: z.number().int().min(0, "Quantité rejetée invalide").optional(),
};

export const closeLotSchema = z
  .object(quantityFields)
  .refine((d) => d.quantityConforming <= d.quantityProduced, {
    message: "La quantité conforme ne peut pas dépasser la quantité produite",
    path: ["quantityConforming"],
  });

export const updateLotSchema = z
  .object({
    quantityProduced: z.number().int().min(0, "Quantité produite invalide").optional(),
    quantityConforming: z.number().int().min(0, "Quantité conforme invalide").optional(),
    quantityRejected: z.number().int().min(0, "Quantité rejetée invalide").optional(),
    cadenceUsed: z.number().positive("Cadence doit être positive").optional(),
    cadenceUnit: cadenceUnit.optional(),
  })
  .refine(
    (d) =>
      d.quantityProduced === undefined ||
      d.quantityConforming === undefined ||
      d.quantityConforming <= d.quantityProduced,
    {
      message: "La quantité conforme ne peut pas dépasser la quantité produite",
      path: ["quantityConforming"],
    },
  );

export const addDowntimeSchema = z.object({
  categoryId: z.string().uuid("categoryId invalide"),
  durationMinutes: z.number().positive("Durée doit être positive"),
  comment: z.string().optional(),
});

export const validateLotSchema = z.object({
  action: z.enum(["validate", "reject"]),
  comment: z.string().optional(),
});
