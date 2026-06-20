const BASE = "/api";

export const ACCESS_KEY = "trs_token";
export const REFRESH_KEY = "trs_refresh";

// M2: a single shared refresh promise so concurrent 401s collapse into one
// rotation call — otherwise the second request would replay an already-rotated
// token and trip server-side reuse detection, nuking the whole session.
let refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem(ACCESS_KEY, data.token);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, opts?: RequestInit, retried = false): Promise<T> {
  const token = localStorage.getItem(ACCESS_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });

  // Access token expired → try one transparent refresh + retry
  const isAuthCall = path === "/auth/login" || path === "/auth/refresh" || path === "/auth/logout";
  if (res.status === 401 && !retried && !isAuthCall && localStorage.getItem(REFRESH_KEY)) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    const ok = await refreshPromise;
    if (ok) return request<T>(path, opts, true);
    // Refresh failed (expired/revoked) → drop tokens; callers see the 401 below
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }

  if (!res.ok) {
    // A non-JSON error body means the request never reached our API — e.g. the
    // domain points at the wrong Vercel project, or a CDN/proxy served an HTML
    // error page. Surface that distinctly from a real server-side failure.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("API introuvable à cette adresse. Vérifie l'URL de l'application.");
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; refreshToken: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: (refreshToken: string) =>
    request<{ ok: boolean }>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  me: () => request<User>("/auth/me"),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }),

  // Ref data
  rooms: () => request<Room[]>("/ref/rooms"),
  equipments: (roomId?: string) => roomId ? request<Equipment[]>(`/ref/rooms/${roomId}/equipments`) : request<Equipment[]>("/ref/equipments"),
  products: () => request<Product[]>("/ref/products"),
  downtimeCategories: (eqType?: string) => request<DowntimeCategory[]>(`/ref/downtime-categories${eqType ? `?equipmentType=${eqType}` : ""}`),
  cadences: (equipmentId?: string) => request<ProductEquipmentCadence[]>(`/ref/cadences${equipmentId ? `?equipmentId=${equipmentId}` : ""}`),

  // Sessions
  sessions: (params?: { date?: string; equipmentId?: string }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set("date", params.date);
    if (params?.equipmentId) q.set("equipmentId", params.equipmentId);
    return request<Session[]>(`/sessions?${q}`);
  },
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  openSession: (equipmentId: string, roomId: string) =>
    request<Session>("/sessions/open", { method: "POST", body: JSON.stringify({ equipmentId, roomId }) }),
  closeSession: (id: string, notes?: string) =>
    request<Session>(`/sessions/${id}/close`, { method: "POST", body: JSON.stringify({ notes }) }),
  addEvent: (sessionId: string, data: AddEventInput) =>
    request<SessionEvent>(`/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify(data) }),
  sessionTrs: (id: string) => request<SessionTrsResponse>(`/sessions/${id}/trs`),

  // Lots
  startLot: (data: StartLotInput) =>
    request<LotEntry>("/lots", { method: "POST", body: JSON.stringify(data) }),
  closeLot: (id: string, data: CloseLotInput) =>
    request<LotEntry>(`/lots/${id}/close`, { method: "POST", body: JSON.stringify(data) }),
  updateLot: (id: string, data: Partial<CloseLotInput & { cadenceUsed: number; cadenceUnit: string }>) =>
    request<LotEntry>(`/lots/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  addDowntime: (lotId: string, data: AddDowntimeInput) =>
    request<LotDowntime>(`/lots/${lotId}/downtimes`, { method: "POST", body: JSON.stringify(data) }),
  // Session-level stop (inter-lot: changeover, cleaning, waiting — no active lot).
  addSessionDowntime: (sessionId: string, data: AddDowntimeInput) =>
    request<LotDowntime>(`/sessions/${sessionId}/downtimes`, { method: "POST", body: JSON.stringify(data) }),
  lotDowntimes: (lotId: string) => request<LotDowntime[]>(`/lots/${lotId}/downtimes`),
  deleteDowntime: (lotId: string, dtId: string) =>
    request<void>(`/lots/${lotId}/downtimes/${dtId}`, { method: "DELETE" }),
  sessionDowntimes: (sessionId: string) => request<LotDowntime[]>(`/sessions/${sessionId}/downtimes`),
  deleteSessionDowntime: (sessionId: string, dtId: string) =>
    request<void>(`/sessions/${sessionId}/downtimes/${dtId}`, { method: "DELETE" }),
  // Change the cadence (consigne) while a lot is running — logged for audit.
  changeCadence: (lotId: string, data: { newCadence: number; cadenceUnit?: string; reason?: string }) =>
    request<LotEntry>(`/lots/${lotId}/cadence`, { method: "POST", body: JSON.stringify(data) }),
  lotCadenceHistory: (lotId: string) => request<CadenceChange[]>(`/lots/${lotId}/cadence`),
  // 21 CFR Part 11: validation/rejection requires re-authentication (password).
  validateLot: (id: string, action: "validate" | "reject", password: string, comment?: string) =>
    request<LotEntry & { signature: ElectronicSignature }>(`/lots/${id}/validate`, { method: "POST", body: JSON.stringify({ action, comment, password }) }),
  // 21 CFR Part 11: supervisor correction of operator data with signed audit trail.
  correctLot: (id: string, data: CorrectLotInput) =>
    request<{ lot: LotEntry; signature: ElectronicSignature }>(`/lots/${id}/correct`, { method: "POST", body: JSON.stringify(data) }),
  lotSignatures: (id: string) => request<ElectronicSignature[]>(`/lots/${id}/signatures`),

  // Dashboard
  dashboardTrs: (equipmentId: string, from: string, to: string) =>
    request<DashboardTrsResponse>(`/dashboard/trs?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardPareto: (equipmentId: string, from: string, to: string) =>
    request<ParetoResponse>(`/dashboard/pareto?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardComparison: (from: string, to: string) =>
    request<ComparisonResponse>(`/dashboard/comparison?from=${from}&to=${to}`),
  dashboardByProduct: (equipmentId: string, from: string, to: string) =>
    request<ByProductResponse>(`/dashboard/by-product?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardSixLosses: (equipmentId: string, from: string, to: string) =>
    request<SixLossesResponse>(`/dashboard/six-losses?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardHeatmap: (equipmentId: string, from: string, to: string) =>
    request<HeatmapResponse>(`/dashboard/heatmap?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardDowntimeLog: (equipmentId: string, from: string, to: string) =>
    request<DowntimeLogResponse>(`/dashboard/downtime-log?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  pendingLots: (status?: "closed" | "validated" | "rejected" | "all") =>
    request<PendingLot[]>(`/dashboard/pending-lots${status ? `?status=${status}` : ""}`),
  pendingLotsCount: () => request<{ count: number }>("/dashboard/pending-lots/count"),

  // Admin CRUD
  admin: {
    // Rooms
    listRooms: () => request<AdminRoom[]>("/admin/rooms"),
    createRoom: (data: { code: string; name: string; description?: string }) =>
      request<AdminRoom>("/admin/rooms", { method: "POST", body: JSON.stringify(data) }),
    updateRoom: (id: string, data: Partial<{ code: string; name: string; description: string; isActive: boolean }>) =>
      request<AdminRoom>(`/admin/rooms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteRoom: (id: string) =>
      request<AdminRoom>(`/admin/rooms/${id}`, { method: "DELETE" }),

    // Equipments
    listEquipments: () => request<AdminEquipment[]>("/admin/equipments"),
    createEquipment: (data: { code: string; name: string; roomId: string; equipmentType?: string; trsObjective?: string; defaultCadenceUnit?: string; microStopThresholdMin?: number }) =>
      request<AdminEquipment>("/admin/equipments", { method: "POST", body: JSON.stringify(data) }),
    updateEquipment: (id: string, data: Partial<{ code: string; name: string; roomId: string; equipmentType: string; trsObjective: string; defaultCadenceUnit: string; microStopThresholdMin: number; isActive: boolean }>) =>
      request<AdminEquipment>(`/admin/equipments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteEquipment: (id: string) =>
      request<AdminEquipment>(`/admin/equipments/${id}`, { method: "DELETE" }),

    // Products
    listProducts: () => request<AdminProduct[]>("/admin/products"),
    createProduct: (data: { code: string; name: string; defaultCadence?: string; cadenceUnit?: string; unit?: string }) =>
      request<AdminProduct>("/admin/products", { method: "POST", body: JSON.stringify(data) }),
    updateProduct: (id: string, data: Partial<{ code: string; name: string; defaultCadence: string; cadenceUnit: string; unit: string; isActive: boolean }>) =>
      request<AdminProduct>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteProduct: (id: string) =>
      request<AdminProduct>(`/admin/products/${id}`, { method: "DELETE" }),

    // Downtime Categories
    listDowntimeCategories: () => request<AdminDowntimeCategory[]>("/admin/downtime-categories"),
    createDowntimeCategory: (data: { code: string; label: string; famille: string; isPlanned?: boolean; appliesToEquipmentType?: string }) =>
      request<AdminDowntimeCategory>("/admin/downtime-categories", { method: "POST", body: JSON.stringify(data) }),
    updateDowntimeCategory: (id: string, data: Partial<{ code: string; label: string; famille: string; isPlanned: boolean; appliesToEquipmentType: string | null; isActive: boolean }>) =>
      request<AdminDowntimeCategory>(`/admin/downtime-categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteDowntimeCategory: (id: string) =>
      request<AdminDowntimeCategory>(`/admin/downtime-categories/${id}`, { method: "DELETE" }),

    // Cadences
    listCadences: () => request<ProductEquipmentCadence[]>("/admin/cadences"),
    upsertCadence: (data: { productId: string; equipmentId: string; cadenceValue: number; cadenceUnit: string; trsObjective?: number }) =>
      request<ProductEquipmentCadence>("/admin/cadences", { method: "POST", body: JSON.stringify(data) }),
    deleteCadence: (id: string) =>
      request<ProductEquipmentCadence>(`/admin/cadences/${id}`, { method: "DELETE" }),

    // Users (admin-only)
    listUsers: () => request<AdminUser[]>("/admin/users"),
    createUser: (data: { email: string; displayName: string; password: string; role: string }) =>
      request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
    updateUser: (id: string, data: Partial<{ displayName: string; role: string; isActive: boolean }>) =>
      request<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    resetUserPassword: (id: string, password: string) =>
      request<AdminUser>(`/admin/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),

    auditLog: (params?: { entityType?: string; entityId?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.entityType) q.set("entityType", params.entityType);
      if (params?.entityId) q.set("entityId", params.entityId);
      if (params?.action) q.set("action", params.action);
      if (params?.from) q.set("from", params.from);
      if (params?.to) q.set("to", params.to);
      if (params?.limit != null) q.set("limit", String(params.limit));
      if (params?.offset != null) q.set("offset", String(params.offset));
      return request<AuditLogEntry[]>(`/admin/audit-log?${q}`);
    },
  },
};

// ─── Types ──────────────────────────────────────────────

export interface User { id: string; email: string; displayName: string; role: string }
export interface Room { id: string; code: string; name: string; description: string | null }
export interface Equipment { id: string; roomId: string; code: string; name: string; equipmentType: string | null; trsObjective: string; defaultCadenceUnit: string }
export interface Product { id: string; code: string; name: string; defaultCadence: string | null; cadenceUnit: string; unit: string }
export interface DowntimeCategory { id: string; code: string; label: string; famille: string; isPlanned: boolean; appliesToEquipmentType: string | null }

export interface Session { id: string; equipmentId: string; roomId: string; operatorId: string; sessionDate: string; openedAt: string; closedAt: string | null; status: string; notes: string | null }
export interface SessionEvent { id: string; sessionId: string; eventType: string; label: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null; isPlanned: boolean; lotEntryId: string | null; sortOrder: number; comment: string | null }
export interface LotEntry { id: string; sessionId: string; productId: string; batchNumber: string; lotOrder: number; cadenceUsed: string; cadenceUnit: string; quantityProduced: number; quantityConforming: number; quantityRejected: number; startedAt: string; endedAt: string | null; status: string; supervisorComment: string | null; validatedAt: string | null }
export interface DowntimeEvent { id: string; sessionId: string; lotEntryId: string | null; categoryId: string; startedAt: string; endedAt: string | null; durationMinutes: number; comment: string | null }
// Returned by GET /lots/:id/downtimes — category joined server-side (famille/reason/isPlanned).
export interface LotDowntime extends DowntimeEvent { famille: string; reason: string; isPlanned: boolean }

export interface SessionDetail { session: Session; events: SessionEvent[]; lots: LotEntry[]; downtimes: LotDowntime[] }
export interface TrsWarning { code: string; level: "error" | "warning"; message: string; field: string; value?: number }
export interface TrsAudit { tF_norme: number; tF_lots: number; tF_delta: number; formula: string }
export interface ReliabilityMetrics { breakdownCount: number; totalBreakdownMin: number; mtbf: number | null; mttr: number | null; availability: number | null }
export interface TrsMetrics { tT: number; tO: number; fermeture: number; tAP: number; tR: number; tF: number; tN: number; tU: number; nonQualiteMin: number; ecartCadenceMin: number; totalUnplannedMin: number; DO: number; TP: number; TQ: number; TRS: number; TRG: number; TEEP: number; utilisation: number; lotCount: number; totalProduced: number; totalConforming: number; totalRebut: number; downtimeByFamille: Record<string, number>; downtimeByNorme?: Record<string, number>; warnings?: TrsWarning[]; audit?: TrsAudit; reliability?: ReliabilityMetrics }
export interface LotTrs extends TrsMetrics {
  lotId: string;
  batchNumber?: string;
  productName?: string;
  productCode?: string;
  cadenceUsed?: number;
  cadenceUnit?: string;
  quantityProduced?: number;
  quantityConforming?: number;
  quantityRejected?: number;
  lotDurationMin?: number;
  plannedMin?: number;
  unplannedMin?: number;
  cadencePerMin?: number;
  nominalCadencePerMin?: number;
  ecartCadence?: number;
  rebut?: number;
}
export interface DailyTrs extends TrsMetrics { date: string; notes?: string; lots?: LotTrs[] }
export interface CadenceChange { id: string; lotEntryId: string; oldCadence: string; newCadence: string; cadenceUnit: string; reason: string | null; changedBy: string | null; changedAt: string }
export interface SessionTrsResponse { session: TrsMetrics; lots: LotTrs[]; aClasserMin?: number }
export interface DashboardTrsResponse { period: { from: string; to: string; equipmentId: string }; daily: (DailyTrs & { aClasserMin: number })[]; total: TrsMetrics & { aClasserMin: number } }
export interface ParetoItem { code: string; label: string; famille: string; isPlanned: boolean; isPhase: boolean; totalMin: number; count: number; pctOfTotal: number; cumulPct: number }
export interface ParetoResponse { pareto: ParetoItem[]; totalMin: number }
export interface ComparisonEquipment { equipmentId: string; equipmentName: string; equipmentCode: string; equipmentType: string; trsObjective: number; daily: DailyTrs[]; total: TrsMetrics }
export interface ComparisonResponse { period: { from: string; to: string }; equipments: ComparisonEquipment[] }

export interface PendingLot extends LotEntry {
  operatorName: string;
  sessionDate: string;
  sessionNotes: string | null;
  equipmentName: string;
  equipmentCode: string;
}

export interface AddEventInput { eventType: string; label?: string; durationMinutes?: number; isPlanned?: boolean; comment?: string }
export interface StartLotInput { sessionId: string; productId: string; batchNumber: string; cadenceUsed: number; cadenceUnit?: string }
export interface CloseLotInput { quantityProduced: number; quantityConforming: number; quantityRejected?: number }
export interface AddDowntimeInput { categoryId: string; durationMinutes: number; isShortStop?: boolean; comment?: string }
export interface CorrectLotInput {
  quantityProduced?: number; quantityConforming?: number; quantityRejected?: number;
  cadenceUsed?: number; cadenceUnit?: string;
  correctionReason: string; password: string;
}

// Admin types (include all fields, not just active)
export interface ElectronicSignature { id: string; userId: string | null; userEmail: string; userName: string; entityType: string; entityId: string; meaning: string; action: string; comment: string | null; ipAddress: string | null; signedAt: string }
export interface AuditLogEntry { id: string; actorId: string | null; actorEmail: string; action: string; entityType: string; entityId: string | null; payload: string | null; ipAddress: string | null; createdAt: string }
export interface AdminUser { id: string; email: string; displayName: string; role: string; isActive: boolean; createdAt: string }
export interface AdminRoom { id: string; code: string; name: string; description: string | null; isActive: boolean; createdAt: string }
export interface AdminEquipment { id: string; roomId: string; code: string; name: string; equipmentType: string | null; trsObjective: string; defaultCadenceUnit: string; microStopThresholdMin: number; isActive: boolean; createdAt: string }
export interface AdminProduct { id: string; code: string; name: string; defaultCadence: string | null; cadenceUnit: string; unit: string; isActive: boolean; createdAt: string }
export interface AdminDowntimeCategory { id: string; code: string; label: string; famille: string; isPlanned: boolean; appliesToEquipmentType: string | null; isActive: boolean; createdAt: string }
export interface ProductEquipmentCadence { id: string; productId: string; equipmentId: string; cadenceValue: string; cadenceUnit: string; trsObjective: string | null }

// W: By-Product aggregation
export interface ProductTrs { productId: string; productName: string; lotCount: number; totalProduced: number; totalConforming: number; totalRebut: number; totalDurationMin: number; totalUnplannedMin: number; tF: number; tN: number; tU: number; tR: number; avgCadencePerMin: number; DO: number; TP: number; TQ: number; TRS: number; trAllocated: boolean }
export interface ByProductResponse { period: { from: string; to: string; equipmentId: string }; periodTR?: number; periodTRS?: number; byProduct: ProductTrs[] }

// X: Six Big Losses
export interface SixBigLoss { category: string; label: string; oeeComponent: string; minutes: number; pctOfTotal: number }
export interface SixLossesResult { losses: SixBigLoss[]; totalLossMin: number; tT: number }
export interface DailySixLosses extends SixLossesResult { date: string }
export interface SixLossesResponse { period: { from: string; to: string; equipmentId: string }; total: SixLossesResult; daily: DailySixLosses[] }

// Y: Heatmap
export interface HeatmapDataPoint { date: string; TRS: number; DO: number; TP: number; TQ: number; lotCount: number }
export interface HeatmapResponse { period: { from: string; to: string; equipmentId: string }; heatmap: HeatmapDataPoint[] }

// Chronological downtime log
export interface DowntimeLogEntry { id: string; startedAt: string; durationMinutes: number; isPlanned: boolean; famille: string; reason: string; batchNumber: string; categoryCode: string }
export interface DowntimeLogResponse { period: { from: string; to: string; equipmentId: string }; log: DowntimeLogEntry[] }
