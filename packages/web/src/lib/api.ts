const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("trs_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<User>("/auth/me"),

  // Ref data
  rooms: () => request<Room[]>("/ref/rooms"),
  equipments: (roomId?: string) => roomId ? request<Equipment[]>(`/ref/rooms/${roomId}/equipments`) : request<Equipment[]>("/ref/equipments"),
  products: () => request<Product[]>("/ref/products"),
  downtimeCategories: (eqType?: string) => request<DowntimeCategory[]>(`/ref/downtime-categories${eqType ? `?equipmentType=${eqType}` : ""}`),

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
  closeSession: (id: string) =>
    request<Session>(`/sessions/${id}/close`, { method: "POST" }),
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
    request<any>(`/lots/${lotId}/downtimes`, { method: "POST", body: JSON.stringify(data) }),
  lotDowntimes: (lotId: string) => request<DowntimeEvent[]>(`/lots/${lotId}/downtimes`),
  validateLot: (id: string, action: "validate" | "reject", comment?: string) =>
    request<LotEntry>(`/lots/${id}/validate`, { method: "POST", body: JSON.stringify({ action, comment }) }),

  // Dashboard
  dashboardTrs: (equipmentId: string, from: string, to: string) =>
    request<DashboardTrsResponse>(`/dashboard/trs?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardPareto: (equipmentId: string, from: string, to: string) =>
    request<ParetoResponse>(`/dashboard/pareto?equipmentId=${equipmentId}&from=${from}&to=${to}`),
  dashboardComparison: (from: string, to: string) =>
    request<ComparisonResponse>(`/dashboard/comparison?from=${from}&to=${to}`),
  pendingLots: () => request<LotEntry[]>("/dashboard/pending-lots"),
};

// ─── Types ──────────────────────────────────────────────

export interface User { id: string; email: string; displayName: string; role: string }
export interface Room { id: string; code: string; name: string; description: string | null }
export interface Equipment { id: string; roomId: string; code: string; name: string; equipmentType: string | null; trsObjective: string; defaultCadenceUnit: string }
export interface Product { id: string; code: string; name: string; defaultCadence: string | null; cadenceUnit: string; unit: string }
export interface DowntimeCategory { id: string; code: string; label: string; famille: string; isPlanned: boolean; appliesToEquipmentType: string | null }

export interface Session { id: string; equipmentId: string; roomId: string; operatorId: string; sessionDate: string; openedAt: string; closedAt: string | null; status: string; notes: string | null }
export interface SessionEvent { id: string; sessionId: string; eventType: string; label: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null; isPlanned: boolean; lotEntryId: string | null; sortOrder: number; comment: string | null }
export interface LotEntry { id: string; sessionId: string; productId: string; batchNumber: string; lotOrder: number; cadenceUsed: string; cadenceUnit: string; quantityProduced: number; quantityConforming: number; quantityRejected: number; startedAt: string; endedAt: string | null; status: string }
export interface DowntimeEvent { id: string; lotEntryId: string; categoryId: string; startedAt: string; endedAt: string | null; durationMinutes: number; comment: string | null }

export interface SessionDetail { session: Session; events: SessionEvent[]; lots: LotEntry[]; downtimes: DowntimeEvent[] }
export interface TrsMetrics { tT: number; tO: number; fermeture: number; tAP: number; tR: number; tF: number; tN: number; tU: number; nonQualiteMin: number; ecartCadenceMin: number; totalUnplannedMin: number; DO: number; TP: number; TQ: number; TRS: number; TRG: number; lotCount: number; totalProduced: number; totalConforming: number; totalRebut: number; downtimeByFamille: Record<string, number> }
export interface DailyTrs extends TrsMetrics { date: string; notes?: string; lots?: any[] }
export interface SessionTrsResponse { session: TrsMetrics; lots: any[] }
export interface DashboardTrsResponse { period: { from: string; to: string; equipmentId: string }; daily: DailyTrs[]; total: TrsMetrics }
export interface ParetoItem { code: string; label: string; famille: string; isPlanned: boolean; totalMin: number; count: number; pctOfTotal: number; cumulPct: number }
export interface ParetoResponse { pareto: ParetoItem[]; totalMin: number }
export interface ComparisonEquipment { equipmentId: string; equipmentName: string; equipmentCode: string; equipmentType: string; trsObjective: number; daily: DailyTrs[]; total: TrsMetrics }
export interface ComparisonResponse { period: { from: string; to: string }; equipments: ComparisonEquipment[] }

export interface AddEventInput { eventType: string; label?: string; durationMinutes?: number; isPlanned?: boolean; comment?: string }
export interface StartLotInput { sessionId: string; productId: string; batchNumber: string; cadenceUsed: number; cadenceUnit?: string }
export interface CloseLotInput { quantityProduced: number; quantityConforming: number; quantityRejected?: number }
export interface AddDowntimeInput { categoryId: string; durationMinutes: number; comment?: string }
