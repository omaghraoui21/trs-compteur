// ─── Canonical mock objects used across all test files ───────────────────────

export const OPERATOR_USER = {
  id: "user-op-1",
  email: "operateur@dpi.local",
  displayName: "Opérateur Test",
  role: "operator",
};

export const SUPERVISOR_USER = {
  id: "user-sv-1",
  email: "superviseur@dpi.local",
  displayName: "Superviseur Test",
  role: "supervisor",
};

export const ROOM = {
  id: "room-1",
  code: "SP-01",
  name: "Salle de Production",
  description: null,
  isActive: true,
};

export const EQUIPMENT = {
  id: "equip-1",
  code: "BLI-01",
  name: "Blistereuse IMA TR135S",
  roomId: "room-1",
  equipmentType: "blistereuse",
  trsObjective: "75",
  defaultCadenceUnit: "u/min",
  microStopThresholdMin: 5,
  isActive: true,
};

export const PRODUCT = {
  id: "prod-1",
  code: "PROD-001",
  name: "Aeronide 200µg",
  defaultCadence: "120",
  cadenceUnit: "u/min",
  unit: "blister",
  isActive: true,
};

export const CADENCE = {
  id: "cad-1",
  productId: "prod-1",
  equipmentId: "equip-1",
  cadenceValue: "120",
  cadenceUnit: "u/min",
  trsObjective: "80",
};

export const DOWNTIME_CATEGORY = {
  id: "cat-1",
  code: "PANNE",
  label: "Panne machine",
  famille: "Panne équipement",
  isPlanned: false,
  appliesToEquipmentType: null,
  isActive: true,
};

export const SESSION = {
  id: "session-1",
  equipmentId: "equip-1",
  roomId: "room-1",
  operatorId: "user-op-1",
  sessionDate: "2026-06-07",
  openedAt: "2026-06-07T06:00:00.000Z",
  closedAt: null,
  status: "active",
  notes: null,
};

export const SESSION_DETAIL_EMPTY = {
  session: SESSION,
  events: [],
  lots: [],
  downtimes: [],
};

export const LOT_ACTIVE = {
  id: "lot-1",
  sessionId: "session-1",
  productId: "prod-1",
  batchNumber: "26013",
  lotOrder: 1,
  cadenceUsed: "120",
  cadenceUnit: "u/min",
  quantityProduced: 0,
  quantityConforming: 0,
  quantityRejected: 0,
  startedAt: "2026-06-07T08:00:00.000Z",
  endedAt: null,
  status: "active",
  supervisorId: null,
  supervisorAction: null,
  supervisorComment: null,
  validatedAt: null,
};

export const LOT_CLOSED = {
  ...LOT_ACTIVE,
  quantityProduced: 14400,
  quantityConforming: 14256,
  quantityRejected: 144,
  endedAt: "2026-06-07T10:00:00.000Z",
  status: "closed",
};

export const DOWNTIME_EVENT = {
  id: "dt-1",
  sessionId: "session-1",
  lotEntryId: "lot-1",
  categoryId: "cat-1",
  startedAt: "2026-06-07T09:00:00.000Z",
  endedAt: "2026-06-07T09:15:00.000Z",
  durationMinutes: 15,
  status: "closed",
  isShortStop: false,
  comment: null,
  createdBy: "user-op-1",
};

export const TRS_EMPTY = {
  session: {
    tO: 540, tR: 0, tF: 0, tN: 0, tU: 0,
    DO: 0, TP: 0, TQ: 0, TRS: 0, TRG: 0,
    lotCount: 0, totalProduced: 0, totalConforming: 0, totalRebut: 0,
    tAP: 0, fermeture: 0, ecartCadenceMin: 0, nonQualiteMin: 0,
    totalUnplannedMin: 0, plannedMin: 0, unplannedMin: 0,
    downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
    audit: { tF_norme: 0, tF_lots: 0, tF_delta: 0, formula: "" },
  },
  lots: [],
  aClasserMin: 0,
};

export const TRS_WITH_LOT = {
  session: {
    tT: 1440, tO: 540, fermeture: 900, tAP: 60, tR: 480, tF: 465,
    tN: 450, tU: 443, nonQualiteMin: 7, ecartCadenceMin: 15,
    totalUnplannedMin: 15, plannedMin: 0, unplannedMin: 0,
    DO: 465 / 480, TP: 450 / 465, TQ: 443 / 450,
    TRS: 443 / 480, TRG: 443 / 540,
    lotCount: 1, totalProduced: 14400, totalConforming: 14256, totalRebut: 144,
    downtimeByFamille: { "Panne équipement": 15 }, downtimeByNorme: { AB: 15 },
    warnings: [],
    audit: { tF_norme: 465, tF_lots: 465, tF_delta: 0, formula: "" },
  },
  lots: [{
    lotId: "lot-1", batchNumber: "26013", productName: "Aeronide 200µg",
    produced: 14400, conforming: 14256,
    tF: 465, tN: 450, tU: 443, lotDurationMin: 480,
    plannedMin: 0, unplannedMin: 15,
    TP: 450 / 465, TQ: 443 / 450, cadencePerMin: 120, nominalCadencePerMin: 120,
    ecartCadence: 15, rebut: 144,
    downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
  }],
  aClasserMin: 0,
};

// Pending lots for supervisor
export const PENDING_LOT = {
  ...LOT_CLOSED,
  supervisorId: null,
  supervisorAction: null,
};
