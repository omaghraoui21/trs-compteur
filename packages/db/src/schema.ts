import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";

// ─── Enums ─────────────────────────────────────────────

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "closed",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "nettoyage",
  "vide_ligne",
  "remplissage",
  "pause",
  "chsb",     // Changement série Blistereuse
  "chsg",     // Changement série Géluleuse
  "apr",      // Arrêt programmé réglementaire
  "mqch",     // Mise en quarantaine / changement
  "lot_start",
  "lot_end",
  "custom",
]);

export const lotStatusEnum = pgEnum("lot_status", [
  "active",
  "closed",
  "submitted",
  "validated",
  "rejected",
]);

export const downtimeStatusEnum = pgEnum("dt_status", ["open", "closed"]);

// ─── Rooms ─────────────────────────────────────────────

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Equipments ────────────────────────────────────────

export const equipments = pgTable("equipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull().references(() => rooms.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  equipmentType: text("equipment_type"), // blistereuse | geluleuse
  trsObjective: numeric("trs_objective", { precision: 5, scale: 2 }).notNull().default("75"),
  defaultCadenceUnit: text("default_cadence_unit").notNull().default("u/h"), // u/h or u/min
  microStopThresholdMin: integer("micro_stop_threshold_min").notNull().default(5), // AA: seuil micro-arrêts
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Products ──────────────────────────────────────────

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  defaultCadence: numeric("default_cadence", { precision: 10, scale: 2 }),
  cadenceUnit: text("cadence_unit").notNull().default("u/h"),
  unit: text("unit").notNull().default("unités"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Users ─────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("operator"), // operator | supervisor | admin
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Downtime Categories ───────────────────────────────

export const downtimeCategories = pgTable("downtime_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  famille: text("famille").notNull(), // Panne équipement, Attente matière, Réglage, Contrôle qualité, Nettoyage, Autre
  isPlanned: boolean("is_planned").notNull().default(false),
  appliesToEquipmentType: text("applies_to_equipment_type"), // blistereuse | geluleuse | null (both)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Sessions (= Compteur Continu) ─────────────────────

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipments.id),
  roomId: uuid("room_id").notNull().references(() => rooms.id),
  operatorId: uuid("operator_id").notNull().references(() => users.id),
  sessionDate: date("session_date").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  status: sessionStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_sessions_date").on(t.sessionDate),
  index("idx_sessions_equipment").on(t.equipmentId),
  index("idx_sessions_status").on(t.status),
]);

// ─── Session Events (Timeline phases) ──────────────────

export const sessionEvents = pgTable("session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  eventType: eventTypeEnum("event_type").notNull(),
  label: text("label"),                          // Custom label for "custom" type
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),  // Calculated or manual
  isPlanned: boolean("is_planned").notNull().default(true),
  lotEntryId: uuid("lot_entry_id"),              // Links lot_start/lot_end to a lot
  sortOrder: integer("sort_order").notNull().default(0),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_session_events_session").on(t.sessionId),
  index("idx_session_events_type").on(t.eventType),
]);

// ─── Lot Entries (Production within a session) ─────────

export const lotEntries = pgTable("lot_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  batchNumber: text("batch_number").notNull(),
  lotOrder: integer("lot_order").notNull().default(1),  // 1st, 2nd, 3rd lot in session

  // Cadence — operator-entered, adjustable per lot
  cadenceUsed: numeric("cadence_used", { precision: 10, scale: 2 }).notNull(),
  cadenceUnit: text("cadence_unit").notNull().default("u/h"), // u/h or u/min

  // Quantities
  quantityProduced: integer("quantity_produced").notNull().default(0),
  quantityConforming: integer("quantity_conforming").notNull().default(0),
  quantityRejected: integer("quantity_rejected").notNull().default(0),

  // Timestamps
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  status: lotStatusEnum("status").notNull().default("active"),
  operatorId: uuid("operator_id").notNull().references(() => users.id),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  supervisorComment: text("supervisor_comment"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_lot_entries_session").on(t.sessionId),
  index("idx_lot_entries_product").on(t.productId),
  index("idx_lot_entries_status").on(t.status),
  index("idx_lot_entries_date_batch").on(t.batchNumber),
]);

// ─── Downtime Events (within a lot) ────────────────────

export const downtimeEvents = pgTable("downtime_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotEntryId: uuid("lot_entry_id").notNull().references(() => lotEntries.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => downtimeCategories.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull(),
  status: downtimeStatusEnum("status").notNull().default("closed"),
  comment: text("comment"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_downtime_events_lot").on(t.lotEntryId),
  index("idx_downtime_events_category").on(t.categoryId),
]);

// ─── Daily Summary (auto-generated from sessions) ──────

export const dailySummaries = pgTable("daily_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipments.id),
  summaryDate: date("summary_date").notNull(),

  tOpeningMin: integer("t_opening_min").notNull().default(0),       // tO
  tPlannedStopsMin: integer("t_planned_stops_min").notNull().default(0), // tAP
  tRequiredMin: integer("t_required_min").notNull().default(0),     // tR = tO - tAP
  tUnplannedStopsMin: integer("t_unplanned_stops_min").notNull().default(0),
  tFunctioningMin: integer("t_functioning_min").notNull().default(0), // tF

  totalProduced: integer("total_produced").notNull().default(0),
  totalConforming: integer("total_conforming").notNull().default(0),
  totalRejected: integer("total_rejected").notNull().default(0),

  lotCount: integer("lot_count").notNull().default(0),

  // Pre-computed TRS values
  trs: numeric("trs", { precision: 5, scale: 4 }),
  trg: numeric("trg", { precision: 5, scale: 4 }),
  disponibilite: numeric("disponibilite", { precision: 5, scale: 4 }),
  performance: numeric("performance", { precision: 5, scale: 4 }),
  qualite: numeric("qualite", { precision: 5, scale: 4 }),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("uq_daily_summary_equip_date").on(t.equipmentId, t.summaryDate),
  index("idx_daily_summaries_date").on(t.summaryDate),
]);

// ─── Product × Equipment Cadences ──────────────────────

export const productEquipmentCadences = pgTable("product_equipment_cadences", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  equipmentId: uuid("equipment_id").notNull().references(() => equipments.id),
  cadenceValue: numeric("cadence_value", { precision: 10, scale: 2 }).notNull(),
  cadenceUnit: text("cadence_unit").notNull().default("u/min"),
  trsObjective: numeric("trs_objective_product", { precision: 5, scale: 2 }), // Z: objectif TRS par produit×équipement
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("uq_product_equipment_cadence").on(t.productId, t.equipmentId),
]);
