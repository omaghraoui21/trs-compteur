import { z } from "zod";
import { PHASE_CATEGORY_KEYS } from "@trs/engine";

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

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken requis"),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword: z.string().min(6, "Nouveau mot de passe : 6 caractères minimum"),
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
  isShortStop: z.boolean().optional(),
  comment: z.string().optional(),
});

export const validateLotSchema = z.object({
  action: z.enum(["validate", "reject"]),
  comment: z.string().optional(),
  // 21 CFR Part 11: signing requires re-authentication with the signer's password.
  password: z.string().min(1, "Mot de passe requis pour signer"),
});

// ─── Admin schemas (M3) ─────────────────────────────────────────

const equipmentType = z.enum(["blistereuse", "geluleuse"]);

export const createRoomSchema = z.object({
  code: z.string().min(1, "code requis"),
  name: z.string().min(1, "name requis"),
  description: z.string().optional(),
});
export const updateRoomSchema = createRoomSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createEquipmentSchema = z.object({
  code: z.string().min(1, "code requis"),
  name: z.string().min(1, "name requis"),
  roomId: z.string().uuid("roomId invalide"),
  equipmentType: equipmentType.optional(),
  trsObjective: z.string().optional(),
  defaultCadenceUnit: cadenceUnit.optional(),
  microStopThresholdMin: z.number().int().min(1).optional(),
});
export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createProductSchema = z.object({
  code: z.string().min(1, "code requis"),
  name: z.string().min(1, "name requis"),
  defaultCadence: z.string().optional(),
  cadenceUnit: cadenceUnit.optional(),
  unit: z.string().optional(),
});
export const updateProductSchema = createProductSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createDowntimeCategorySchema = z.object({
  code: z.string().min(1, "code requis"),
  label: z.string().min(1, "label requis"),
  famille: z.string().min(1, "famille requise"),
  isPlanned: z.boolean().optional(),
  appliesToEquipmentType: z.string().nullable().optional(),
});
export const updateDowntimeCategorySchema = createDowntimeCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

const phaseCategory = z.enum(PHASE_CATEGORY_KEYS as unknown as [string, ...string[]]);

export const createPhaseTemplateSchema = z.object({
  code: z.string().min(1, "code requis"),
  label: z.string().min(1, "label requis"),
  category: phaseCategory,
  eventType,
  isPlanned: z.boolean().optional(),
  requiresComment: z.boolean().optional(),
  appliesToEquipmentType: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export const updatePhaseTemplateSchema = createPhaseTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createCadenceSchema = z.object({
  productId: z.string().uuid("productId invalide"),
  equipmentId: z.string().uuid("equipmentId invalide"),
  cadenceValue: z.number().positive("cadenceValue doit être positive"),
  cadenceUnit: cadenceUnit.optional(),
  trsObjective: z.number().min(0).max(100).optional(),
});

// ─── Users (admin-only management) ──────────────────────────────
const userRole = z.enum(["operator", "supervisor", "admin"]);

export const createUserSchema = z.object({
  email: z.string().email("Email invalide"),
  displayName: z.string().min(1, "Nom requis"),
  password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
  role: userRole,
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: userRole.optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
});
