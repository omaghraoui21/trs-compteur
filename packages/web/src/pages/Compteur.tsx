import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, type Room, type Equipment, type Session, type SessionDetail, type Product, type DowntimeCategory, type PhaseTemplate, type ProductEquipmentCadence, type SessionTrsResponse, type TrsMetrics, type LotEntry } from "@/lib/api";
import { fmtDuration, fmtPct, trsColor, PHASE_CATEGORY_KEYS, PHASE_CATEGORY_LABELS } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { Onboarding } from "@/components/Onboarding";
import { RateGauge } from "@/components/RateGauge";
import { Timer, Play, Square, Plus, ChevronLeft, AlertTriangle, Clock, Package, Gauge, TrendingUp, TrendingDown, StopCircle, Zap, CheckCircle, XCircle, Wrench, Droplets, RotateCcw, Cpu } from "lucide-react";
import { ListSkeleton } from "@/components/Skeleton";

type View = "pick-room" | "pick-equip" | "timeline" | "new-lot" | "add-phase" | "add-downtime";

// ─── Touch-friendly class constants (U2) ─────────────────
const BTN_PRIMARY = "min-h-[48px] text-base font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition active:scale-95";
const BTN_ICON = "h-6 w-6";

// Unified accent palette — one consistent visual language for every machine
// (Blistereuse, Géluleuse, …). The machine is identified by its NAME/badge text,
// not by colour, so the shop-floor UI reads the same on every line.
// Kept as a function (rather than a const) so all existing call sites are unchanged.
function equipmentAccent(_type?: string | null) {
  return {
    badge: "bg-blue-100 text-blue-700",
    btnOpen: "bg-blue-600 text-white hover:bg-blue-700",
    timerText: "text-blue-700",
    timerBg: "bg-blue-50 border-blue-200",
    cardBorder: "hover:border-blue-400",
  };
}

const EVENT_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  lot_start:    Play,
  lot_end:      Square,
  nettoyage:    Droplets,
  vide_ligne:   Droplets,
  remplissage:  Droplets,
  pause:        Clock,
  chsb:         Wrench,
  chsg:         Wrench,
  apr:          RotateCcw,
  mqch:         Wrench,
  custom:       Plus,
};

function ValidationBadge({ status }: { status: string }) {
  if (status === "validated") return (
    <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0">
      <CheckCircle className="h-3 w-3" /> Validé
    </span>
  );
  if (status === "rejected") return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium shrink-0">
      <XCircle className="h-3 w-3" /> Rejeté
    </span>
  );
  // "closed" = awaiting supervisor validation
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
      <Clock className="h-3 w-3" /> En attente
    </span>
  );
}

function useFlash(): [boolean, () => void] {
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useCallback(() => {
    navigator.vibrate?.([30]);
    if (timerRef.current) clearTimeout(timerRef.current);
    setFlashing(true);
    timerRef.current = setTimeout(() => setFlashing(false), 500);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return [flashing, trigger];
}

// ─── Reusable error card with a Réessayer button ─────────
function RetryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const isServer = /erreur serveur/i.test(message) || /^HTTP 5/.test(message);
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-6 text-center max-w-md mx-auto mt-6">
      <AlertTriangle className="h-9 w-9 text-red-500 mx-auto mb-3" />
      <p className="text-base font-semibold text-gray-800 mb-1">Connexion serveur impossible</p>
      <p className="text-sm text-gray-500 mb-5">
        {isServer ? "Vérifie ta connexion internet, puis réessaie." : message}
      </p>
      <button
        onClick={onRetry}
        className="w-full bg-blue-600 text-white min-h-[48px] rounded-xl font-semibold text-base active:scale-95 transition hover:bg-blue-700"
      >
        Réessayer
      </button>
    </div>
  );
}

export default function CompteurPage() {
  const [view, setView] = useState<View>("pick-room");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [equipmentsList, setEquipmentsList] = useState<Equipment[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<DowntimeCategory[]>([]);
  const [phaseTemplates, setPhaseTemplates] = useState<PhaseTemplate[]>([]);
  const [cadences, setCadences] = useState<ProductEquipmentCadence[]>([]);
  const [trsData, setTrsData] = useState<SessionTrsResponse | null>(null);
  const [trsStale, setTrsStale] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [prefillProductId, setPrefillProductId] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [bootError, setBootError] = useState("");
  const toast = useToast();

  // Load reference data (rooms + products) on mount, with a retry path so a
  // transient server/network error shows a "Réessayer" button instead of a
  // dead-end empty screen.
  const loadBootstrap = useCallback(() => {
    setBootError("");
    Promise.all([api.rooms(), api.products()])
      .then(([r, p]) => { setRooms(r); setProducts(p); })
      .catch((err) => setBootError(err.message || "Erreur serveur"));
  }, []);
  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  // Timer for active session
  useEffect(() => {
    if (!activeSession || activeSession.status !== "active") return;
    const start = new Date(activeSession.openedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [activeSession]);

  // Live TRS poll — 30 s while a lot is active
  useEffect(() => {
    if (!activeSession || activeSession.status !== "active") return;
    const hasActiveLot = detail?.lots.some(l => l.status === "active") ?? false;
    if (!hasActiveLot) return;
    const poll = async () => {
      try {
        setTrsData(await api.sessionTrs(activeSession.id));
        setTrsStale(false);
      } catch {
        // Don't toast on every 30s tick; flag the live badge as stale instead.
        setTrsStale(true);
      }
    };
    const iv = setInterval(poll, 30_000);
    return () => clearInterval(iv);
  }, [activeSession, detail]);

  const loadDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    try {
      const [d, t] = await Promise.all([api.session(sessionId), api.sessionTrs(sessionId)]);
      setDetail(d);
      setTrsData(t);
      setTrsStale(false);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Check for active session on equipment select
  const handleEquipmentSelect = async (eq: Equipment) => {
    setSelectedEquipment(eq);
    try {
      const [cats, phases, cads] = await Promise.all([
        api.downtimeCategories(eq.equipmentType ?? undefined),
        api.phaseTemplates(eq.equipmentType ?? undefined),
        api.cadences(eq.id),
      ]);
      setCategories(cats);
      setPhaseTemplates(phases);
      setCadences(cads);

      // Check for existing active session
      const allSessions = await api.sessions({ equipmentId: eq.id });
      const active = allSessions.find(s => s.status === "active");
      if (active) {
        setActiveSession(active);
        await loadDetail(active.id);
      }
      setView("timeline");
    } catch (err: any) {
      toast.error(err.message || "Chargement de l'équipement échoué");
    }
  };

  const handleOpenSession = async () => {
    if (!selectedEquipment || !selectedRoom) return;
    try {
      const session = await api.openSession(selectedEquipment.id, selectedRoom.id);
      setActiveSession(session);
      await loadDetail(session.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCloseSession = () => {
    if (!activeSession) return;
    setShowCloseModal(true);
  };

  const handleConfirmClose = async () => {
    if (!activeSession) return;
    setShowCloseModal(false);
    try {
      await api.closeSession(activeSession.id);
      setActiveSession(null);
      setDetail(null);
      setTrsData(null);
      setView("pick-room");
    } catch (err: any) {
      toast.error(err.message || "Fermeture du compteur échouée");
    }
  };

  const fmtElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // ─── Room Picker (U2: touch-friendly) ──────────────────

  if (view === "pick-room") {
    return (
      <div className="max-w-lg mx-auto">
        <Onboarding />
        <h2 className="text-xl font-bold mb-4">Choisir le local</h2>
        {bootError ? (
          <RetryError message={bootError} onRetry={loadBootstrap} />
        ) : rooms.length === 0 ? (
          <ListSkeleton rows={3} />
        ) : (
        <div className="grid gap-3">
          {rooms.map(r => (
            <button
              key={r.id}
              onClick={() => {
                setSelectedRoom(r);
                api.equipments(r.id).then(setEquipmentsList);
                setView("pick-equip");
              }}
              className={`bg-white rounded-xl border p-5 text-left hover:border-blue-500 hover:shadow transition ${BTN_PRIMARY.includes("min-h") ? "min-h-[56px]" : ""}`}
            >
              <div className="font-semibold text-lg">{r.name}</div>
              <div className="text-sm text-gray-500">{r.code}</div>
            </button>
          ))}
        </div>
        )}
      </div>
    );
  }

  // ─── Equipment Picker (U2: touch-friendly) ─────────────

  if (view === "pick-equip") {
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={() => setView("pick-room")} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
          <ChevronLeft className="h-4 w-4" /> Retour
        </button>
        <h2 className="text-xl font-bold mb-4">{selectedRoom?.name} — Equipement</h2>
        <div className="grid gap-3">
          {equipmentsList.map(eq => {
            const accent = equipmentAccent(eq.equipmentType);
            return (
              <button
                key={eq.id}
                onClick={() => handleEquipmentSelect(eq)}
                className={`bg-white rounded-xl border p-5 text-left hover:shadow-md transition min-h-[56px] ${accent.cardBorder}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${accent.timerBg}`}>
                    <Cpu className={`h-5 w-5 ${accent.timerText}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lg leading-tight">{eq.name}</div>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                      <span className="font-mono text-xs">{eq.code}</span>
                      {eq.equipmentType && (
                        <span className={`capitalize text-xs px-2 py-0.5 rounded-full font-medium ${accent.badge}`}>
                          {eq.equipmentType}
                        </span>
                      )}
                      <span className="text-xs">Obj. {eq.trsObjective}%</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Sub-views ─────────────────────────────────────────

  if (view === "new-lot" && activeSession) {
    return <NewLotForm
      session={activeSession}
      products={products}
      cadences={cadences}
      equipmentId={selectedEquipment?.id || ""}
      defaultCadenceUnit={selectedEquipment?.defaultCadenceUnit || "u/min"}
      previousLots={detail?.lots || []}
      prefillProductId={prefillProductId}
      onCreated={() => { setPrefillProductId(""); loadDetail(activeSession.id); setView("timeline"); }}
      onBack={() => { setPrefillProductId(""); setView("timeline"); }}
    />;
  }

  if (view === "add-downtime" && activeSession && detail) {
    // A stop attaches to the active lot if one is running (during production),
    // otherwise to the session (inter-lot: changeover, cleaning, waiting).
    const activeLot = detail.lots.find(l => l.status === "active");
    return <AddDowntimeForm
      lotId={activeLot?.id}
      sessionId={activeSession.id}
      categories={categories}
      onAdded={() => { loadDetail(activeSession.id); setView("timeline"); }}
      onBack={() => setView("timeline")}
    />;
  }

  // ─── Timeline View (U2, U6, U8) ───────────────────────

  const activeLot = detail?.lots.find(l => l.status === "active");
  const sessionTrs = trsData?.session;
  const activeLotProduct = activeLot ? products.find(p => p.id === activeLot.productId) : null;
  // Reference (setpoint) cadence for the active lot, from product × equipment
  // ref data already loaded — drives the live rate gauge & current-order table.
  const setpointRef = activeLot && selectedEquipment
    ? cadences.find(c => c.productId === activeLot.productId && c.equipmentId === selectedEquipment.id)
    : undefined;
  const setpointCadence = setpointRef ? Number(setpointRef.cadenceValue) : undefined;
  // "Phase actuelle" = production if a lot is running, else the most recent
  // recorded phase, else idle.
  const lastPhase = [...(detail?.events ?? [])].reverse()
    .find(e => e.eventType !== "lot_start" && e.eventType !== "lot_end");
  const currentActivity = activeLot
    ? "Production en cours"
    : lastPhase
      ? (lastPhase.label || lastPhase.eventType.replace(/_/g, " "))
      : "En attente";

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => { setView("pick-room"); setActiveSession(null); setDetail(null); }}
        className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>

      {(() => {
        const accent = equipmentAccent(selectedEquipment?.equipmentType);
        return (
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${accent.timerBg}`}>
                <Cpu className={`h-5 w-5 ${accent.timerText}`} />
              </div>
              <div>
                <h2 className="text-xl font-bold leading-tight flex items-center gap-2">
                  {selectedEquipment?.name}
                  {selectedEquipment?.equipmentType && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${accent.badge}`}>
                      {selectedEquipment.equipmentType}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-gray-500">{selectedRoom?.name}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Big status card: timer + active lot + current phase */}
      {activeSession && activeSession.status === "active" && (
        <div className="bg-white rounded-2xl border shadow-sm p-5 mb-4">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Session ouverte</div>
            <div className="text-5xl sm:text-6xl font-mono font-bold text-green-700 tabular-nums leading-none">
              {fmtElapsed(elapsed)}
            </div>
            {trsData && trsData.session.lotCount > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5">
                <span className="text-sm font-bold px-3 py-1 rounded-full"
                  style={{ backgroundColor: trsColor(trsData.session.TRS) + "22", color: trsColor(trsData.session.TRS) }}>
                  TRS {fmtPct(trsData.session.TRS)}
                </span>
                <span className="text-xs text-gray-400">en direct</span>
                {trsStale && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600" title="La mise à jour automatique a échoué — valeur possiblement périmée">
                    <AlertTriangle className="h-3.5 w-3.5" /> hors ligne
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-[11px] text-gray-400 mb-0.5">Lot en cours</div>
              {activeLot ? (
                <>
                  <div className="font-bold text-base leading-tight truncate">{activeLot.batchNumber}</div>
                  <div className="text-xs text-gray-500 truncate">{activeLotProduct?.name ?? ""}</div>
                </>
              ) : (
                <div className="text-sm text-gray-400 font-medium">Aucun lot actif</div>
              )}
            </div>
            <div className={`rounded-xl p-3 ${activeLot ? "bg-green-50" : "bg-gray-50"}`}>
              <div className="text-[11px] text-gray-400 mb-0.5">Phase actuelle</div>
              <div className={`font-semibold text-base leading-tight truncate ${activeLot ? "text-green-700" : "text-gray-700"}`}>
                {currentActivity}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live rate gauge + current-order table (Line-Performance style) */}
      {activeSession && activeSession.status === "active" && activeLot && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="lg:col-span-1">
            <RateGauge
              value={Number(activeLot.cadenceUsed)}
              max={setpointCadence}
              label="Cadence actuelle"
              unit={activeLot.cadenceUnit}
            />
          </div>
          <div className="lg:col-span-2 bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Package className="h-4 w-4 text-green-600" />
              <h3 className="font-semibold text-sm">Commande en cours</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
                    <th className="px-4 py-2 font-medium">Lot</th>
                    <th className="px-4 py-2 font-medium">Produit</th>
                    <th className="px-4 py-2 font-medium">État</th>
                    <th className="px-4 py-2 font-medium">Début</th>
                    <th className="px-4 py-2 font-medium text-right">Consigne</th>
                    <th className="px-4 py-2 font-medium text-right">Produits</th>
                    <th className="px-4 py-2 font-medium text-right">Conformes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-green-50/70 border-t">
                    <td className="px-4 py-2.5 font-bold">{activeLot.batchNumber}</td>
                    <td className="px-4 py-2.5 truncate max-w-[12rem]">{activeLotProduct?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> En production
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(activeLot.startedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {setpointCadence != null ? `${setpointCadence} ${activeLot.cadenceUnit}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{activeLot.quantityProduced.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{activeLot.quantityConforming.toLocaleString("fr-FR")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {!activeSession && (
        <button onClick={handleOpenSession}
          className={`w-full ${equipmentAccent(selectedEquipment?.equipmentType).btnOpen} ${BTN_PRIMARY} text-lg`}>
          <Play className={BTN_ICON} /> Ouvrir le compteur
        </button>
      )}

      {activeSession && !detail && detailLoading && <ListSkeleton rows={4} />}

      {activeSession && detail && (
        <>
          {/* U6: Session Timeline Bar */}
          <SessionTimelineBar detail={detail} session={activeSession} />

          {/* Events timeline */}
          <div className="bg-white rounded-xl border shadow-sm mb-4">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">Timeline</h3>
              <span className="text-xs text-gray-400">{detail.events.length} événements</span>
            </div>
            <div className="divide-y max-h-72 overflow-y-auto">
              {detail.events.map(ev => {
                const lot = detail.lots.find(l => l.id === ev.lotEntryId);
                const product = lot ? products.find(p => p.id === lot.productId) : null;
                const Icon = EVENT_TYPE_ICON[ev.eventType] ?? Plus;
                const isLotLifecycle = ev.eventType === "lot_start" || ev.eventType === "lot_end";
                const iconCls = isLotLifecycle
                  ? ev.eventType === "lot_start" ? "text-green-600 bg-green-50" : "text-blue-600 bg-blue-50"
                  : ev.isPlanned ? "text-amber-600 bg-amber-50" : "text-gray-500 bg-gray-50";
                const label = ev.eventType === "lot_start" ? `Lot ${lot?.batchNumber ?? "?"} démarré`
                  : ev.eventType === "lot_end" ? `Lot ${lot?.batchNumber ?? "?"} clôturé`
                  : ev.label || ev.eventType.replace(/_/g, " ");
                return (
                  <div key={ev.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg shrink-0 ${iconCls}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{label}</div>
                      {product && <div className="text-xs text-gray-400 truncate">{product.name}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-400">
                        {new Date(ev.startedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {ev.durationMinutes != null && (
                        <div className="text-xs font-medium text-gray-600">{ev.durationMinutes} min</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {detail.events.length === 0 && (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">Aucun événement enregistré</div>
              )}
            </div>
          </div>

          {/* Active lot card (U4: real-time validation) */}
          {activeLot && (
            <ActiveLotCard
              lot={activeLot}
              products={products}
              categories={categories}
              sessionId={activeSession.id}
              onUpdate={() => loadDetail(activeSession.id)}
              onAddDowntime={() => setView("add-downtime")}
            />
          )}

          {/* Closed lots summary */}
          {detail.lots.filter(l => l.status !== "active").length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm mb-4">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">Lots clôturés</h3>
              </div>
              <div className="divide-y">
                {detail.lots.filter(l => l.status !== "active").map(lot => {
                  const product = products.find(p => p.id === lot.productId);
                  const lotTrs = trsData?.lots?.find(t => t.lotId === lot.id);
                  const rejectQty = lot.quantityProduced - lot.quantityConforming;
                  return (
                    <div key={lot.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold truncate">Lot {lot.batchNumber}</span>
                          {product && <span className="text-gray-400 text-xs truncate">{product.name}</span>}
                        </div>
                        <ValidationBadge status={lot.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="font-medium text-gray-700">{lot.quantityProduced}</span> produits
                        </span>
                        <span className="flex items-center gap-1 text-green-700">
                          <CheckCircle className="h-3 w-3" /> {lot.quantityConforming} conformes
                        </span>
                        {rejectQty > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="h-3 w-3" /> {rejectQty} rebuts
                          </span>
                        )}
                        {lotTrs && (
                          <span className="ml-auto font-medium" style={{ color: trsColor(lotTrs.TP) }}>
                            TP {fmtPct(lotTrs.TP)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Session TRS summary + U8: historical reference */}
          {sessionTrs && sessionTrs.lotCount > 0 && (
            <TrsSummaryCard sessionTrs={sessionTrs} equipmentId={selectedEquipment?.id || ""} trsObjective={Number(selectedEquipment?.trsObjective || 75)} />
          )}

          {/* « À classer » — temps de session non couvert par un lot ni par un
              arrêt déclaré. On incite l'opérateur à le qualifier (modèle Reason Codes). */}
          {trsData?.aClasserMin != null && trsData.aClasserMin > 1 && (
            <button onClick={() => setView("add-downtime")}
              className="w-full mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 transition">
              <span className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">{fmtDuration(trsData.aClasserMin)} à classer</span>
              </span>
              <span className="text-xs text-amber-700">Déclarer l'arrêt →</span>
            </button>
          )}

          {/* Actions (U2: large touch targets) */}
          <div className="flex gap-3 mb-8">
            <button onClick={() => setView("add-downtime")}
              className={`flex-1 bg-orange-50 text-orange-700 ${BTN_PRIMARY} hover:bg-orange-100`}>
              <AlertTriangle className={BTN_ICON} /> Déclarer un arrêt
            </button>
            {!activeLot && (() => {
              const closedLots = detail.lots.filter(l => l.status !== "active");
              const lastLot = closedLots[closedLots.length - 1];
              return lastLot ? (
                <button
                  onClick={() => { setPrefillProductId(lastLot.productId); setView("new-lot"); }}
                  className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700`}
                >
                  <Zap className={BTN_ICON} /> Lot suivant
                </button>
              ) : (
                <button onClick={() => setView("new-lot")}
                  className={`flex-1 bg-green-50 text-green-700 ${BTN_PRIMARY} hover:bg-green-100`}>
                  <Package className={BTN_ICON} /> Nouveau lot
                </button>
              );
            })()}
            <button onClick={handleCloseSession}
              className={`flex-1 bg-red-50 text-red-700 ${BTN_PRIMARY} hover:bg-red-100`}>
              <Square className={BTN_ICON} /> Fermer
            </button>
          </div>
        </>
      )}
      {showCloseModal && activeSession && (
        <EndOfShiftModal
          trsData={trsData}
          hasActiveLot={!!activeLot}
          trsObjective={Number(selectedEquipment?.trsObjective || 75)}
          onConfirm={handleConfirmClose}
          onCancel={() => setShowCloseModal(false)}
        />
      )}
    </div>
  );
}

// ─── U6: Session Timeline Bar ────────────────────────────

function SessionTimelineBar({ detail, session }: { detail: SessionDetail; session: Session }) {
  const segments = useMemo(() => {
    const openedAt = new Date(session.openedAt).getTime();
    const now = session.closedAt ? new Date(session.closedAt).getTime() : Date.now();
    const totalMs = Math.max(now - openedAt, 1);

    type Segment = { start: number; end: number; type: "phase" | "lot" | "downtime" | "gap"; label: string };
    const segs: Segment[] = [];

    // Events = phases
    for (const ev of detail.events) {
      if (ev.eventType === "lot_start" || ev.eventType === "lot_end") continue;
      const start = new Date(ev.startedAt).getTime();
      const dur = (ev.durationMinutes || 0) * 60_000;
      const end = ev.endedAt ? new Date(ev.endedAt).getTime() : start + dur;
      segs.push({ start, end, type: ev.isPlanned ? "phase" : "phase", label: ev.label || ev.eventType.replace("_", " ") });
    }

    // Lots = green (active production)
    for (const lot of detail.lots) {
      const start = new Date(lot.startedAt).getTime();
      const end = lot.endedAt ? new Date(lot.endedAt).getTime() : now;
      segs.push({ start, end, type: "lot", label: `Lot ${lot.batchNumber}` });
    }

    // Downtimes = red
    for (const dt of detail.downtimes) {
      const start = new Date(dt.startedAt).getTime();
      const dur = dt.durationMinutes * 60_000;
      const end = dt.endedAt ? new Date(dt.endedAt).getTime() : start + dur;
      segs.push({ start, end, type: "downtime", label: "Arrêt" });
    }

    // Sort by start time
    segs.sort((a, b) => a.start - b.start);

    return segs.map(seg => ({
      ...seg,
      leftPct: ((seg.start - openedAt) / totalMs) * 100,
      widthPct: Math.max(((seg.end - seg.start) / totalMs) * 100, 0.5),
    }));
  }, [detail, session]);

  if (segments.length === 0) return null;

  const colorMap = { phase: "bg-amber-400", lot: "bg-green-500", downtime: "bg-red-500", gap: "bg-gray-300" };

  return (
    <div className="mb-4">
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${colorMap[seg.type]} opacity-80`}
            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
            title={seg.label}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500" /> Production</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-400" /> Phase</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500" /> Arrêt</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-200" /> Inter-lots</span>
      </div>
    </div>
  );
}

// ─── U8: TRS Summary with Historical Reference ──────────

function TrsSummaryCard({ sessionTrs, equipmentId, trsObjective }: { sessionTrs: TrsMetrics | undefined; equipmentId: string; trsObjective: number }) {
  const [avg30, setAvg30] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!equipmentId) return;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);
    api.dashboardTrs(equipmentId, fromStr, toStr)
      .then(data => {
        if (data.total && data.total.TRS > 0) setAvg30(data.total.TRS);
      })
      .catch((err) => toast.error(err.message || "Chargement de la moyenne 30j échoué"));
  }, [equipmentId]);

  if (!sessionTrs) return null;
  const currentTRS = sessionTrs.TRS;
  const trend = avg30 != null ? currentTRS - avg30 : null;

  return (
    <div className="bg-white rounded-xl border shadow-sm mb-4 p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4" /> TRS Consolide Session
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {[
          { label: "TRS", value: sessionTrs.TRS, hero: true },
          { label: "TRG", value: sessionTrs.TRG, hero: true },
          { label: "DO",  value: sessionTrs.DO,  hero: false },
          { label: "TP",  value: sessionTrs.TP,  hero: false },
          { label: "TQ",  value: sessionTrs.TQ,  hero: false },
        ].map(item => {
          const color = trsColor(item.value);
          return (
            <div key={item.label} className="bg-gray-50 rounded-lg p-2.5">
              <div className="text-xs text-gray-500 mb-1">{item.label}</div>
              <div className="text-lg font-bold" style={{ color }}>{fmtPct(item.value)}</div>
              <div className="h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(item.value * 100, 100)}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* U8: Historical reference + objective */}
      <div className="flex items-center gap-4 mt-3 text-xs">
        <span className="text-gray-500">tO: {fmtDuration(sessionTrs.tO)}</span>
        <span className="text-gray-500">tR: {fmtDuration(sessionTrs.tR)}</span>
        <span className="text-gray-500">Lots: {sessionTrs.lotCount}</span>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs">
        <span className="text-gray-500">Objectif: <span className="font-medium text-blue-700">{trsObjective}%</span></span>
        {avg30 != null && (
          <span className="flex items-center gap-1 text-gray-500">
            Moy. 30j: <span className="font-medium">{fmtPct(avg30)}</span>
            {trend != null && trend > 0 && <TrendingUp className="h-3.5 w-3.5 text-green-600" />}
            {trend != null && trend < 0 && <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Active Lot Card (U2 touch, U4 real-time validation) ─

function ActiveLotCard({ lot, products, categories, sessionId, onUpdate, onAddDowntime }: {
  lot: LotEntry; products: Product[]; categories: DowntimeCategory[]; sessionId: string;
  onUpdate: () => void; onAddDowntime: () => void;
}) {
  const product = products.find(p => p.id === lot.productId);
  const [produced, setProduced] = useState(String(lot.quantityProduced));
  const [conforming, setConforming] = useState(String(lot.quantityConforming));
  const [closing, setClosing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [flashClose, triggerFlashClose] = useFlash();
  const toast = useToast();

  // Cadence can be adjusted mid-lot (logged for audit + time-weighted TRS).
  const [editingCadence, setEditingCadence] = useState(false);
  const [newCadence, setNewCadence] = useState("");
  const [cadenceReason, setCadenceReason] = useState("");
  const [savingCadence, setSavingCadence] = useState(false);

  const handleChangeCadence = async () => {
    const val = Number(newCadence);
    if (!(val > 0)) { toast.error("Cadence invalide"); return; }
    setSavingCadence(true);
    try {
      await api.changeCadence(lot.id, { newCadence: val, cadenceUnit: lot.cadenceUnit, reason: cadenceReason.trim() || undefined });
      toast.success(`Cadence mise à jour : ${val} ${lot.cadenceUnit}`);
      setEditingCadence(false); setNewCadence(""); setCadenceReason("");
      onUpdate();
    } catch (err: any) {
      toast.error(err.message || "Échec du changement de cadence");
    }
    setSavingCadence(false);
  };

  // U4: Real-time validation warnings
  const warnings = useMemo(() => {
    const w: { level: "error" | "warning"; msg: string }[] = [];
    const prod = Number(produced);
    const conf = Number(conforming);
    if (conf > prod && prod > 0) w.push({ level: "error", msg: `Conforme (${conf}) > Produit (${prod})` });
    if (prod === 0 && conforming !== "") w.push({ level: "warning", msg: "Production nulle" });
    if (Number(lot.cadenceUsed) <= 0) w.push({ level: "error", msg: "Cadence absente ou nulle" });
    const rejectRate = prod > 0 ? (prod - conf) / prod : 0;
    if (rejectRate > 0.05 && prod > 0) w.push({ level: "warning", msg: `Taux rebut eleve: ${(rejectRate * 100).toFixed(1)}%` });
    return w;
  }, [produced, conforming, lot.cadenceUsed]);

  const errors = warnings.filter(w => w.level === "error");
  const warns = warnings.filter(w => w.level === "warning");

  const handleClose = async () => {
    // U4: Show confirmation dialog with warnings
    if (warnings.length > 0 && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    triggerFlashClose();
    setClosing(true);
    try {
      await api.closeLot(lot.id, {
        quantityProduced: Number(produced),
        quantityConforming: Number(conforming),
        quantityRejected: Math.max(0, Number(produced) - Number(conforming)),
      });
      onUpdate();
    } catch (err: any) {
      toast.error(err.message || "Échec de la clôture du lot");
    }
    setClosing(false);
    setShowConfirm(false);
  };

  return (
    <div className="bg-green-50 rounded-xl border-2 border-green-300 shadow-sm mb-4 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-green-800 flex items-center gap-2">
          <Play className="h-5 w-5" /> Lot actif: {lot.batchNumber}
        </h3>
        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">En cours</span>
      </div>

      <div className="flex items-center gap-2 text-sm text-green-700 mb-3 flex-wrap">
        <span>{product?.name} · Cadence: <span className="font-semibold tabular-nums">{lot.cadenceUsed} {lot.cadenceUnit}</span></span>
        {!editingCadence && (
          <button onClick={() => { setEditingCadence(true); setNewCadence(String(lot.cadenceUsed)); }}
            className="inline-flex items-center gap-1 text-xs text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 hover:bg-blue-50">
            <Gauge className="h-3.5 w-3.5" /> Modifier
          </button>
        )}
      </div>

      {editingCadence && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
          <div className="text-xs font-medium text-blue-800">Nouvelle cadence ({lot.cadenceUnit})</div>
          <div className="flex gap-2">
            <input type="number" inputMode="numeric" min="1" value={newCadence} onChange={e => setNewCadence(e.target.value)}
              className="w-28 border rounded-lg px-3 py-2 text-base" autoFocus />
            <input value={cadenceReason} onChange={e => setCadenceReason(e.target.value)} placeholder="Motif (optionnel)"
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setEditingCadence(false); setNewCadence(""); setCadenceReason(""); }}
              className="px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Annuler</button>
            <button onClick={handleChangeCadence} disabled={savingCadence || !(Number(newCadence) > 0)}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {savingCadence ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* U4: Real-time validation banners */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
          {errors.map((e, i) => <div key={i} className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {e.msg}</div>)}
        </div>
      )}
      {warns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          {warns.map((w, i) => <div key={i} className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {w.msg}</div>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Qte produite (NPR)</label>
          <input type="number" value={produced} onChange={e => setProduced(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" inputMode="numeric" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Qte conforme (NPB)</label>
          <input type="number" value={conforming} onChange={e => setConforming(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" inputMode="numeric" />
        </div>
      </div>

      {/* U4: Confirmation dialog */}
      {showConfirm && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
          <p className="text-sm font-medium text-amber-800 mb-2">Attention — clôturer malgré les alertes ?</p>
          {warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">• {w.msg}</div>)}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setShowConfirm(false)} className={`flex-1 border border-gray-300 text-gray-700 ${BTN_PRIMARY} hover:bg-gray-50`}>Annuler</button>
            <button onClick={handleClose} className={`flex-1 bg-amber-600 text-white ${BTN_PRIMARY} hover:bg-amber-700`}>Confirmer</button>
          </div>
        </div>
      )}

      {/* U2: Large touch buttons */}
      <div className="flex gap-2">
        <button onClick={onAddDowntime}
          className={`flex-1 bg-orange-100 text-orange-700 ${BTN_PRIMARY} hover:bg-orange-200`}>
          <AlertTriangle className={BTN_ICON} /> Arret
        </button>
        {!showConfirm && (
          <button onClick={handleClose} disabled={closing}
            className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 ${flashClose ? "btn-flash" : ""}`}>
            <Square className={BTN_ICON} /> Clôturer lot
          </button>
        )}
      </div>
    </div>
  );
}

// ─── New Lot Form (U3: prefill, U5: cadence from ref) ───

function NewLotForm({ session, products, cadences, equipmentId, defaultCadenceUnit, previousLots, prefillProductId, onCreated, onBack }: {
  session: Session; products: Product[]; cadences: ProductEquipmentCadence[];
  equipmentId: string; defaultCadenceUnit: string; previousLots: LotEntry[];
  prefillProductId?: string;
  onCreated: () => void; onBack: () => void;
}) {
  // U3: Auto-suggest batch number from previous lots
  const suggestedBatch = useMemo(() => {
    if (previousLots.length === 0) return "";
    const lastBatch = previousLots[previousLots.length - 1]?.batchNumber || "";
    const match = lastBatch.match(/^(\D*)(\d+)$/);
    if (match) return `${match[1]}${String(Number(match[2]) + 1)}`;
    return "";
  }, [previousLots]);

  const [productId, setProductId] = useState(prefillProductId ?? "");
  const [batch, setBatch] = useState(suggestedBatch);
  const [cadence, setCadence] = useState("");
  const [cadenceUnit, setCadenceUnit] = useState(defaultCadenceUnit);
  const [refCadence, setRefCadence] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [flashStart, triggerFlashStart] = useFlash();

  // U5: Auto-fill cadence from product×equipment reference
  useEffect(() => {
    if (!productId) { setRefCadence(null); return; }
    const ref = cadences.find(c => c.productId === productId && c.equipmentId === equipmentId);
    if (ref) {
      setCadence(ref.cadenceValue);
      setCadenceUnit(ref.cadenceUnit);
      setRefCadence(ref.cadenceValue);
    } else {
      // Fallback to product default
      const p = products.find(pp => pp.id === productId);
      if (p?.defaultCadence) {
        setCadence(p.defaultCadence);
        setCadenceUnit(p.cadenceUnit);
      }
      setRefCadence(null);
    }
  }, [productId, products, cadences, equipmentId]);

  // U5: Cadence deviation warning (>20% from reference)
  const cadenceWarning = useMemo(() => {
    if (!refCadence || !cadence) return null;
    const ref = Number(refCadence);
    const current = Number(cadence);
    if (ref <= 0) return null;
    const deviation = Math.abs(current - ref) / ref;
    if (deviation > 0.2) return `Ecart de ${(deviation * 100).toFixed(0)}% vs cadence theorique (${refCadence} ${cadenceUnit})`;
    return null;
  }, [cadence, refCadence, cadenceUnit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !batch || !cadence) return;
    triggerFlashStart();
    setLoading(true);
    setError("");
    try {
      await api.startLot({
        sessionId: session.id,
        productId,
        batchNumber: batch,
        cadenceUsed: Number(cadence),
        cadenceUnit,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Package className="h-5 w-5" /> Nouveau lot
      </h2>

      {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Produit</label>
          <select value={productId} onChange={e => setProductId(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" required>
            <option value="">Choisir...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">N de lot</label>
          <input value={batch} onChange={e => setBatch(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" placeholder={suggestedBatch || "26019"} required />
          {suggestedBatch && batch === suggestedBatch && (
            <p className="text-xs text-blue-600 mt-1">Auto-suggere: {suggestedBatch}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cadence</label>
            <input type="number" value={cadence} onChange={e => setCadence(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base" placeholder="120" required inputMode="numeric" />
            {refCadence && (
              <p className="text-xs text-green-600 mt-1">Ref: {refCadence} {cadenceUnit}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unite</label>
            <select value={cadenceUnit} onChange={e => setCadenceUnit(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </div>

        {/* U5: Cadence deviation warning */}
        {cadenceWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">{cadenceWarning}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          className={`w-full bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none ${flashStart ? "btn-flash" : ""}`}>
          {loading ? "Démarrage…" : "Démarrer le lot"}
        </button>
      </form>
    </div>
  );
}

// ─── Add Phase Form ──────────────────────────────────────

const QUICK_DURATIONS = [5, 10, 15, 30, 60];

// Per-category color theme so the picker reads at a glance. Phases are loaded
// from the DB (phase_templates), equipment-specific, so Blistereuse and
// Géluleuse share one UI but show only their own phases (e.g. CHSB vs CHSG).
const PHASE_CATEGORY_THEME: Record<string, { tab: string; phase: string }> = {
  production:     { tab: "bg-green-600 text-white border-green-600",   phase: "border-green-500 bg-green-50 text-green-800 font-semibold" },
  nettoyage:      { tab: "bg-blue-600 text-white border-blue-600",     phase: "border-blue-500 bg-blue-50 text-blue-800 font-semibold" },
  changement:     { tab: "bg-violet-600 text-white border-violet-600", phase: "border-violet-500 bg-violet-50 text-violet-800 font-semibold" },
  arret_planifie: { tab: "bg-orange-500 text-white border-orange-500", phase: "border-orange-500 bg-orange-50 text-orange-800 font-semibold" },
};

function AddPhaseForm({ sessionId, phases, onAdded, onBack }: {
  sessionId: string;
  phases: PhaseTemplate[];
  onAdded: () => void;
  onBack: () => void;
}) {
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Group active phases by category, ordered.
  const categories = useMemo(() => {
    const grouped = phases.reduce<Record<string, PhaseTemplate[]>>((acc, p) => {
      (acc[p.category] ||= []).push(p);
      return acc;
    }, {});
    return PHASE_CATEGORY_KEYS.filter(k => grouped[k]?.length).map(k => ({ key: k, phases: grouped[k] }));
  }, [phases]);

  const [catKey, setCatKey] = useState(categories[0]?.key ?? "production");
  const cat = categories.find(c => c.key === catKey) ?? categories[0];
  const theme = PHASE_CATEGORY_THEME[catKey] ?? PHASE_CATEGORY_THEME.production;
  const selected = cat?.phases.find(p => p.id === selectedId) ?? null;
  const canSubmit = selected !== null && duration !== "" && Number(duration) > 0 &&
    (!selected.requiresComment || comment.trim() !== "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    setLoading(true);
    try {
      await api.addEvent(sessionId, {
        eventType: selected.eventType,
        label: selected.eventType === "custom" ? selected.label : undefined,
        durationMinutes: Number(duration),
        isPlanned: selected.isPlanned,
        comment: comment.trim() || undefined,
      });
      onAdded();
    } catch (err: any) {
      toast.error(err.message || "Échec de l'ajout de la phase");
    }
    setLoading(false);
  };

  if (categories.length === 0) {
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
          <ChevronLeft className="h-4 w-4" /> Retour
        </button>
        <div className="bg-white rounded-xl border p-6 text-center text-gray-500 text-sm">
          Aucune phase configurée pour cet équipement.<br />
          Ajoutez-en dans Configuration → Phases.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-28">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5" /> Ajouter une phase
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Category tabs */}
        <div className="flex overflow-x-auto gap-1.5 pb-1">
          {categories.map((c) => {
            const t = PHASE_CATEGORY_THEME[c.key] ?? PHASE_CATEGORY_THEME.production;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => { setCatKey(c.key); setSelectedId(null); }}
                className={`shrink-0 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                  catKey === c.key ? t.tab : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {PHASE_CATEGORY_LABELS[c.key as keyof typeof PHASE_CATEGORY_LABELS] ?? c.key}
              </button>
            );
          })}
        </div>

        {/* Phase grid */}
        <div className="bg-white rounded-xl border p-3">
          <div className="grid grid-cols-2 gap-2">
            {cat?.phases.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`border rounded-lg px-3 py-3.5 text-sm text-left transition min-h-[52px] leading-snug ${
                  selectedId === p.id ? theme.phase : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="bg-white rounded-xl border p-3 space-y-2">
          <label className="block text-sm font-medium">Durée (minutes)</label>
          <div className="flex gap-2 flex-wrap">
            {QUICK_DURATIONS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(String(d))}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition min-w-[48px] ${
                  duration === String(d) ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 hover:bg-gray-50"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <input
            type="number"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base"
            placeholder="Autre durée…"
            inputMode="numeric"
            min="1"
          />
        </div>

        {/* Comment */}
        <div className="bg-white rounded-xl border p-3">
          <label className="block text-sm font-medium mb-1">
            Commentaire {selected?.requiresComment ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">(optionnel)</span>}
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-base resize-none"
            placeholder={selected?.requiresComment ? "Obligatoire pour cette phase" : ""}
          />
        </div>

        {/* Submit — sticky above tab bar on mobile, inline on desktop */}
        <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] inset-x-0 px-4 lg:static lg:px-0 z-30">
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className={`w-full bg-blue-600 text-white ${BTN_PRIMARY} hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none shadow-lg lg:shadow-none`}
          >
            {loading ? "Ajout…" : "Ajouter la phase"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Add Downtime Form (U1: timer auto, U2: large buttons) ─

function AddDowntimeForm({ lotId, sessionId, categories, onAdded, onBack }: {
  lotId?: string; sessionId: string; categories: DowntimeCategory[]; onAdded: () => void; onBack: () => void;
}) {
  const [catId, setCatId] = useState("");
  const [flashDowntime, triggerFlashDowntime] = useFlash();
  const toast = useToast();
  const [mode, setMode] = useState<"manual" | "timer">("manual");
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const [shortStop, setShortStop] = useState(false);
  const [loading, setLoading] = useState(false);

  // U1: Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setTimerStart(Date.now());
    setTimerRunning(true);
    setTimerElapsed(0);
    timerRef.current = setInterval(() => {
      setTimerElapsed(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (timerStart) {
      const elapsedMin = Math.ceil((Date.now() - timerStart) / 60_000);
      setDuration(String(elapsedMin));
    }
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Two top-level sections — Non planifié then Planifié — each grouped by famille.
  const sections = useMemo(() => {
    const build = (planned: boolean) => {
      const grouped: Record<string, DowntimeCategory[]> = {};
      for (const c of categories) {
        if (c.isPlanned !== planned) continue;
        (grouped[c.famille] ??= []).push(c);
      }
      return Object.entries(grouped);
    };
    return [
      { planned: false, title: "Arrêts non planifiés", hint: "Pannes, attentes, utilités, qualité…", familles: build(false) },
      { planned: true, title: "Arrêts planifiés", hint: "Changement de série, nettoyage, pause, maintenance préventive…", familles: build(true) },
    ];
  }, [categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catId || !duration) return;
    triggerFlashDowntime();
    setLoading(true);
    try {
      const payload = {
        categoryId: catId,
        durationMinutes: Number(duration),
        isShortStop: shortStop ? true : undefined,
        comment: comment || undefined,
      };
      // During production → attach to the lot; between lots → attach to the session.
      if (lotId) await api.addDowntime(lotId, payload);
      else await api.addSessionDowntime(sessionId, payload);
      onAdded();
    } catch (err: any) {
      toast.error(err.message || "Échec de l'ajout de l'arrêt");
    }
    setLoading(false);
  };

  const fmtTimerElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" /> Déclarer un arrêt
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        {lotId
          ? "Pendant la production — rattaché au lot en cours."
          : "Hors production — rattaché à la session (inter-lots)."}
      </p>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        {/* Two clear sections: NON planifié (red) then planifié (orange).
            The famille is a sub-group within each. */}
        {sections.map(section => section.familles.length > 0 && (
          <div key={section.title} className={`rounded-xl border p-3 ${section.planned ? "border-amber-200 bg-amber-50/40" : "border-red-200 bg-red-50/40"}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`h-2.5 w-2.5 rounded-full ${section.planned ? "bg-amber-500" : "bg-red-500"}`} />
              <span className={`text-sm font-bold ${section.planned ? "text-amber-800" : "text-red-800"}`}>{section.title}</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">{section.hint}</p>
            {section.familles.map(([famille, cats]) => (
              <div key={famille} className="mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{famille}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {cats.map(c => {
                    const sel = catId === c.id;
                    const selCls = section.planned
                      ? "border-amber-500 bg-amber-100 text-amber-800 font-medium"
                      : "border-red-500 bg-red-100 text-red-800 font-medium";
                    return (
                      <button key={c.id} type="button" onClick={() => setCatId(c.id)}
                        className={`border rounded-lg px-2.5 py-3 text-sm text-left transition min-h-[44px] bg-white ${sel ? selCls : "hover:bg-gray-50"}`}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* U1: Mode selector (manual vs timer) */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("manual")}
            className={`flex-1 border rounded-lg py-2.5 text-sm font-medium transition ${mode === "manual" ? "border-blue-500 bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}>
            Saisie manuelle
          </button>
          <button type="button" onClick={() => setMode("timer")}
            className={`flex-1 border rounded-lg py-2.5 text-sm font-medium transition ${mode === "timer" ? "border-blue-500 bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}>
            Chronomètre
          </button>
        </div>

        {mode === "manual" ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium">Durée (minutes)</label>
            <div className="flex gap-2 flex-wrap">
              {QUICK_DURATIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(String(d))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition min-w-[48px] ${
                    duration === String(d) ? "bg-orange-500 text-white border-orange-500" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base" placeholder="Autre durée…" inputMode="numeric" min="1" />
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl font-mono font-bold text-orange-700 mb-3">{fmtTimerElapsed(timerElapsed)}</div>
            {!timerRunning ? (
              <button type="button" onClick={startTimer}
                className={`bg-orange-500 text-white ${BTN_PRIMARY} w-full hover:bg-orange-600`}>
                <Play className={BTN_ICON} /> Démarrer le chrono
              </button>
            ) : (
              <button type="button" onClick={stopTimer}
                className={`bg-red-600 text-white ${BTN_PRIMARY} w-full hover:bg-red-700`}>
                <StopCircle className={BTN_ICON} /> Arrêter ({fmtTimerElapsed(timerElapsed)})
              </button>
            )}
            {duration && !timerRunning && (
              <p className="text-sm text-green-600 mt-2">Durée capturée : {duration} min</p>
            )}
          </div>
        )}

        {/* Micro-arrêt override: forces this stop into the Performance bucket (TP)
            regardless of duration, per the TPM six-big-losses classification. */}
        <label className="flex items-center gap-3 border rounded-lg px-3 py-3 cursor-pointer min-h-[48px]">
          <input type="checkbox" checked={shortStop} onChange={e => setShortStop(e.target.checked)}
            className="h-5 w-5 accent-orange-500" />
          <span className="text-sm">
            <span className="font-medium">Micro-arrêt</span>
            <span className="text-gray-500"> — perte de performance (TP)</span>
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium mb-1">Commentaire</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" />
        </div>
        <button type="submit" disabled={loading || !catId || !duration}
          className={`w-full bg-orange-500 text-white ${BTN_PRIMARY} hover:bg-orange-600 disabled:opacity-50 ${flashDowntime ? "btn-flash" : ""}`}>
          Enregistrer l'arrêt
        </button>
      </form>
    </div>
  );
}

// ─── End-of-Shift Summary Modal ──────────────────────────

function EndOfShiftModal({ trsData, hasActiveLot, trsObjective, onConfirm, onCancel }: {
  trsData: SessionTrsResponse | null;
  hasActiveLot: boolean;
  trsObjective: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const s = trsData?.session;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-6 shadow-xl">
        <h2 className="text-lg font-bold mb-1">Fermer le compteur ?</h2>
        <p className="text-sm text-gray-500 mb-4">Résumé de la session en cours</p>

        {hasActiveLot && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm text-amber-700">Un lot est en cours — il sera clôturé automatiquement.</span>
          </div>
        )}

        {s && s.lotCount > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center mb-4">
              {([
                { label: "TRS", value: s.TRS, colored: true },
                { label: "DO", value: s.DO, colored: false },
                { label: "TP", value: s.TP, colored: false },
                { label: "TQ", value: s.TQ, colored: false },
                { label: "Lots", raw: String(s.lotCount) },
                { label: "Durée", raw: fmtDuration(s.tO) },
              ] as { label: string; value?: number; raw?: string; colored?: boolean }[]).map(item => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-500">{item.label}</div>
                  <div className="text-base font-bold"
                    style={{ color: item.colored ? trsColor(item.value!) : undefined }}>
                    {item.value != null ? fmtPct(item.value) : item.raw}
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>TRS vs objectif ({trsObjective}%)</span>
                <span style={{ color: trsColor(s.TRS) }}>{fmtPct(s.TRS)}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${Math.min(s.TRS * 100, 100)}%`, backgroundColor: trsColor(s.TRS) }} />
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gray-50 rounded-lg p-4 mb-4 text-center text-sm text-gray-500">
            Aucune donnée TRS — session sans lots
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onCancel}
            className={`flex-1 border border-gray-300 text-gray-700 ${BTN_PRIMARY} hover:bg-gray-50`}>
            Annuler
          </button>
          <button onClick={onConfirm}
            className={`flex-1 bg-red-600 text-white ${BTN_PRIMARY} hover:bg-red-700`}>
            <Square className="h-4 w-4" /> Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
