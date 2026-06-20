import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, type Room, type Equipment, type Session, type SessionDetail, type Product, type DowntimeCategory, type ProductEquipmentCadence, type SessionTrsResponse, type TrsMetrics, type LotEntry, type LotDowntime } from "@/lib/api";
import { fmtDuration, fmtPct, fmtNumber, trsColor, diffMinutes } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { useActiveSession } from "@/lib/sessionContext";
import { Onboarding } from "@/components/Onboarding";
import { RateGauge } from "@/components/RateGauge";
import { Timer, Play, Square, Plus, ChevronLeft, AlertTriangle, Clock, Package, Gauge, TrendingUp, TrendingDown, StopCircle, Zap, CheckCircle, XCircle, Wrench, Droplets, RotateCcw, Cpu, Loader2, Trash2 } from "lucide-react";
import { ListSkeleton } from "@/components/Skeleton";
import BackButton from "@/components/BackButton";

type View = "pick-room" | "pick-equip" | "timeline" | "new-lot" | "add-downtime";

// ─── Touch-friendly class constants (U2) ─────────────────
const BTN_PRIMARY = "min-h-[60px] text-base font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition active:scale-95";
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
      <CheckCircle className="h-3 w-3" aria-hidden="true" /> Validé
    </span>
  );
  if (status === "rejected") return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium shrink-0">
      <XCircle className="h-3 w-3" aria-hidden="true" /> Rejeté
    </span>
  );
  // "closed" = awaiting supervisor validation
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
      <Clock className="h-3 w-3" aria-hidden="true" /> En attente
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
      <AlertTriangle className="h-9 w-9 text-red-500 mx-auto mb-3" aria-hidden="true" />
      <p className="text-base font-semibold text-gray-800 mb-1">Connexion serveur impossible</p>
      <p className="text-sm text-gray-500 mb-5">
        {isServer ? "Vérifie ta connexion internet, puis réessaie." : message}
      </p>
      <button
        onClick={onRetry}
        className="w-full bg-blue-600 text-white min-h-[60px] rounded-xl font-semibold text-base active:scale-95 transition hover:bg-blue-700"
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
  const [cadences, setCadences] = useState<ProductEquipmentCadence[]>([]);
  const [trsData, setTrsData] = useState<SessionTrsResponse | null>(null);
  const [trsStale, setTrsStale] = useState(false);
  const [trsRefreshing, setTrsRefreshing] = useState(false);
  const [sessionDts, setSessionDts] = useState<LotDowntime[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [prefillProductId, setPrefillProductId] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [sessionNotes, setSessionNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [bootError, setBootError] = useState("");
  const toast = useToast();
  const sessionCtx = useActiveSession();

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

  const refreshTrs = useCallback(async () => {
    if (!activeSession || trsRefreshing) return;
    setTrsRefreshing(true);
    try {
      setTrsData(await api.sessionTrs(activeSession.id));
      setTrsStale(false);
    } catch {
      setTrsStale(true);
    } finally {
      setTrsRefreshing(false);
    }
  }, [activeSession, trsRefreshing]);

  const loadDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    try {
      const [d, t] = await Promise.all([api.session(sessionId), api.sessionTrs(sessionId)]);
      setDetail(d);
      setTrsData(t);
      setSessionDts(d.downtimes.filter(dt => !dt.lotEntryId));
      setTrsStale(false);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Check for active session on equipment select
  const handleEquipmentSelect = async (eq: Equipment) => {
    setSelectedEquipment(eq);
    try {
      const [cats, cads] = await Promise.all([
        api.downtimeCategories(eq.equipmentType ?? undefined),
        api.cadences(eq.id),
      ]);
      setCategories(cats);
      setCadences(cads);

      // Fetch only active sessions for this equipment (server-side filter avoids
      // loading the full session history on every equipment selection).
      const [active] = await api.sessions({ equipmentId: eq.id, status: "active" });
      if (active) {
        setActiveSession(active);
        sessionCtx.set({ name: eq.name, openedAt: new Date(active.openedAt) });
        try {
          await loadDetail(active.id);
        } catch {
          // Session detail unavailable (e.g. pending DB migration).
          // Clear stale state so the operator can start a new session.
          setActiveSession(null);
          sessionCtx.set(null);
          toast.error("Session précédente inaccessible — veuillez contacter l'administrateur.");
        }
      } else {
        // No active session on this equipment — clear any stale badge from a
        // previous equipment selection or from a different user's session.
        sessionCtx.set(null);
      }
      setView("timeline");
    } catch (err: any) {
      toast.error(err.message || "Chargement de l'équipement échoué");
    }
  };

  const handleOpenSession = async () => {
    if (!selectedEquipment || !selectedRoom || openingSession) return;
    setOpeningSession(true);
    setError("");
    try {
      const session = await api.openSession(selectedEquipment.id, selectedRoom.id);
      setActiveSession(session);
      sessionCtx.set({ name: selectedEquipment.name, openedAt: new Date(session.openedAt) });
      await loadDetail(session.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOpeningSession(false);
    }
  };

  const handleCloseSession = () => {
    if (!activeSession) return;
    setShowCloseModal(true);
  };

  const handleConfirmClose = async () => {
    if (!activeSession) return;
    setIsClosing(true);
    try {
      await api.closeSession(activeSession.id, sessionNotes || undefined);
      setActiveSession(null);
      setDetail(null);
      setTrsData(null);
      sessionCtx.set(null);
      setShowCloseModal(false);
      setSessionNotes("");
      setView("pick-room");
    } catch (err: any) {
      toast.error(err.message || "Fermeture du compteur échouée");
      setShowCloseModal(false);
    } finally {
      setIsClosing(false);
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
                setEquipmentsList([]);
                setView("pick-equip");
                api.equipments(r.id)
                  .then(setEquipmentsList)
                  .catch((err: any) => {
                    toast.error(err.message || "Impossible de charger les équipements");
                    setView("pick-room");
                  });
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
        <BackButton onClick={() => setView("pick-room")} />
        <h2 className="text-xl font-bold mb-4">{selectedRoom?.name} — Équipement</h2>
        {equipmentsList.length === 0 ? (
          <ListSkeleton rows={3} />
        ) : (
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
        )}
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
      equipmentId={selectedEquipment?.id || ""}
      categories={categories}
      aClasserMin={trsData?.aClasserMin}
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
      <BackButton onClick={() => { setView("pick-room"); setActiveSession(null); setDetail(null); sessionCtx.set(null); }} />

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
              <div className="mt-2 inline-flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
                <span className="text-sm font-bold px-3 py-1 rounded-full"
                  style={{ backgroundColor: trsColor(trsData.session.TRS) + "22", color: trsColor(trsData.session.TRS) }}>
                  TRS {fmtPct(trsData.session.TRS)}
                </span>
                {!trsStale && <span className="h-2 w-2 rounded-full bg-green-400 motion-safe:animate-pulse shrink-0" aria-hidden="true" />}
                <span className="text-xs text-gray-400">en direct</span>
                {trsStale && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> hors ligne
                    <button
                      onClick={refreshTrs}
                      disabled={trsRefreshing}
                      aria-label="Actualiser le TRS"
                      title="Actualiser le TRS"
                      className="ml-0.5 p-0.5 rounded hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 disabled:opacity-50"
                    >
                      <RotateCcw className={`h-3 w-3 ${trsRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                    </button>
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
                  <div className="font-bold text-base leading-tight truncate" title={activeLot.batchNumber}>{activeLot.batchNumber}</div>
                  <div className="text-xs text-gray-500 truncate" title={activeLotProduct?.name}>{activeLotProduct?.name ?? ""}</div>
                </>
              ) : (
                <div className="text-sm text-gray-400 font-medium">Aucun lot actif</div>
              )}
            </div>
            <div className={`rounded-xl p-3 transition-colors duration-300 ${activeLot ? "bg-green-50" : "bg-gray-50"}`}>
              <div className="text-[11px] text-gray-400 mb-0.5">Activité</div>
              <div className={`font-semibold text-base leading-tight truncate transition-colors duration-300 ${activeLot ? "text-green-700" : "text-gray-700"}`}>
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
              <Package className="h-4 w-4 text-green-600" aria-hidden="true" />
              <h3 className="font-semibold text-sm">Commande en cours</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
                    <th scope="col" className="px-4 py-2 font-medium">Lot</th>
                    <th scope="col" className="px-4 py-2 font-medium">Produit</th>
                    <th scope="col" className="px-4 py-2 font-medium">État</th>
                    <th scope="col" className="px-4 py-2 font-medium">Début</th>
                    <th scope="col" className="px-4 py-2 font-medium text-right">Consigne</th>
                    <th scope="col" className="px-4 py-2 font-medium text-right">Produits</th>
                    <th scope="col" className="px-4 py-2 font-medium text-right">Conformes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-green-50/70 border-t">
                    <td className="px-4 py-2.5 font-bold">{activeLot.batchNumber}</td>
                    <td className="px-4 py-2.5 truncate max-w-[12rem]">{activeLotProduct?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" /> En production
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(activeLot.startedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {setpointCadence != null ? `${setpointCadence} ${activeLot.cadenceUnit}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtNumber(activeLot.quantityProduced)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{fmtNumber(activeLot.quantityConforming)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {error && <div role="alert" className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {!activeSession && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-start gap-2.5">
            <Timer className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold">Aucune session active</p>
              <p className="text-blue-700 mt-0.5">Ouvre le compteur pour commencer à enregistrer tes lots et arrêts. La session démarre le chronomètre et calcule le TRS en temps réel.</p>
            </div>
          </div>
          <button
            onClick={handleOpenSession}
            disabled={openingSession}
            aria-busy={openingSession}
            className={`w-full ${equipmentAccent(selectedEquipment?.equipmentType).btnOpen} ${BTN_PRIMARY} text-lg disabled:opacity-60`}
          >
            {openingSession
              ? <><Loader2 className={`${BTN_ICON} animate-spin`} aria-hidden="true" /> Ouverture…</>
              : <><Play className={BTN_ICON} aria-hidden="true" /> Ouvrir le compteur</>}
          </button>
        </div>
      )}

      {activeSession && !detail && detailLoading && <ListSkeleton rows={4} />}

      {activeSession && detail && (
        <>
          {/* TAED live status — 4 métriques toujours visibles en tête de session */}
          <LiveSessionBar elapsed={elapsed} sessionTrs={sessionTrs} aClasserMin={trsData?.aClasserMin ?? 0} />

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
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
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
                        <div className="text-xs font-medium text-gray-600">{fmtDuration(ev.durationMinutes)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {detail.events.length === 0 && (
                <div className="px-4 py-6 text-center text-gray-400 text-sm">
                  {diffMinutes(activeSession?.openedAt ? new Date(activeSession.openedAt) : new Date(), new Date()) < 2
                    ? "Démarrage en cours — les événements apparaîtront ici."
                    : "Aucun événement. Les lots et arrêts enregistrés apparaîtront ici."}
                </div>
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
          {detail.lots.filter(l => l.status !== "active").length > 0 && (() => {
            const closedLotsAll = detail.lots.filter(l => l.status !== "active");
            const totalProd = closedLotsAll.reduce((s, l) => s + l.quantityProduced, 0);
            const totalConf = closedLotsAll.reduce((s, l) => s + l.quantityConforming, 0);
            const tqSession = totalProd > 0 ? (totalConf / totalProd) : null;
            return (
            <div className="bg-white rounded-xl border shadow-sm mb-4">
              <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-semibold text-sm">Lots clôturés</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  <span className="font-medium text-gray-700">{closedLotsAll.length} lot{closedLotsAll.length > 1 ? "s" : ""}</span>
                  <span className="text-green-700 font-medium">{fmtNumber(totalProd)} produits</span>
                  {tqSession !== null && (
                    <span className="font-semibold px-2 py-0.5 rounded-full text-[10px]"
                      style={{ backgroundColor: trsColor(tqSession) + "22", color: trsColor(tqSession) }}>
                      TQ {fmtPct(tqSession)}
                    </span>
                  )}
                </div>
              </div>
              <div className="divide-y">
                {detail.lots.filter(l => l.status !== "active").map(lot => {
                  const product = products.find(p => p.id === lot.productId);
                  const lotTrs = trsData?.lots?.find(t => t.lotId === lot.id);
                  const rejectQty = lot.quantityProduced - lot.quantityConforming;
                  const lotDuration = lot.endedAt ? fmtDuration(diffMinutes(lot.startedAt, lot.endedAt)) : null;
                  return (
                    <div key={lot.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold truncate">Lot {lot.batchNumber}</span>
                          {product && <span className="text-gray-400 text-xs truncate">{product.name}</span>}
                          {lotDuration && (
                            <span className="text-gray-300 text-xs flex items-center gap-0.5 shrink-0">
                              <Clock className="h-3 w-3" aria-hidden="true" />{lotDuration}
                            </span>
                          )}
                        </div>
                        <ValidationBadge status={lot.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <span className="font-medium text-gray-700">{fmtNumber(lot.quantityProduced)}</span> produits
                        </span>
                        <span className="flex items-center gap-1 text-green-700">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" /> {fmtNumber(lot.quantityConforming)} conformes
                        </span>
                        {rejectQty > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="h-3 w-3" aria-hidden="true" /> {fmtNumber(rejectQty)} rebuts
                          </span>
                        )}
                        {lotTrs && (
                          <span className="ml-auto inline-flex items-center gap-1.5">
                            <span className="text-xs font-medium text-gray-400">TP {fmtPct(lotTrs.TP)}</span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: trsColor(lotTrs.TP * lotTrs.TQ) + "22", color: trsColor(lotTrs.TP * lotTrs.TQ) }}>
                              TRS {fmtPct(lotTrs.TP * lotTrs.TQ)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* « À classer » — temps non couvert par un lot ou un arrêt déclaré.
              ≥ 10 min → bannière rouge urgente en tête ; 1-9 min → rappel amber. */}
          {trsData?.aClasserMin != null && trsData.aClasserMin > 1 && (
            <AClasserBanner
              minutes={trsData.aClasserMin}
              onDeclare={() => setView("add-downtime")}
              categories={categories}
              equipmentId={selectedEquipment?.id || ""}
              sessionId={activeSession.id}
              onQualified={() => loadDetail(activeSession.id)}
            />
          )}

          {/* Session-level declared stops (inter-lot) — with inline delete */}
          {sessionDts.length > 0 && (
            <DeclaredDowntimesList
              title="Arrêts de la session"
              downtimes={sessionDts}
              onDelete={async (dtId) => {
                try {
                  await api.deleteSessionDowntime(activeSession.id, dtId);
                  await loadDetail(activeSession.id);
                } catch (err: any) {
                  toast.error(err.message || "Échec de la suppression");
                }
              }}
            />
          )}

          {/* Session TRS summary + U8: historical reference */}
          {sessionTrs && sessionTrs.lotCount > 0 && (
            <TrsSummaryCard sessionTrs={sessionTrs} equipmentId={selectedEquipment?.id || ""} trsObjective={Number(selectedEquipment?.trsObjective || 75)} />
          )}

          {/* Actions (U2: large touch targets) */}
          {(() => {
            const urgentUnclassified = (trsData?.aClasserMin ?? 0) >= 10;
            const closedLots = detail.lots.filter(l => l.status !== "active");
            const lastClosedLot = closedLots[closedLots.length - 1];
            return (
              <div className="flex gap-3 mb-8">
                {urgentUnclassified ? (
                  <button onClick={() => setView("add-downtime")}
                    className={`flex-1 bg-red-600 text-white ${BTN_PRIMARY} hover:bg-red-700`}>
                    <AlertTriangle className={BTN_ICON} aria-hidden="true" /> Classez le temps non couvert
                  </button>
                ) : (
                  <>
                    <button onClick={() => setView("add-downtime")}
                      className={`flex-1 bg-orange-50 text-orange-700 ${BTN_PRIMARY} hover:bg-orange-100`}>
                      <AlertTriangle className={BTN_ICON} aria-hidden="true" /> Déclarer un arrêt
                    </button>
                    {!activeLot && (lastClosedLot ? (
                      <button
                        onClick={() => { setPrefillProductId(lastClosedLot.productId); setView("new-lot"); }}
                        className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700`}>
                        <Zap className={BTN_ICON} aria-hidden="true" /> Lot suivant
                      </button>
                    ) : (
                      <button onClick={() => setView("new-lot")}
                        className={`flex-1 bg-green-50 text-green-700 ${BTN_PRIMARY} hover:bg-green-100`}>
                        <Package className={BTN_ICON} aria-hidden="true" /> Nouveau lot
                      </button>
                    ))}
                  </>
                )}
                <button onClick={handleCloseSession}
                  aria-label="Fermer la session"
                  className={`flex-1 bg-red-50 text-red-700 ${BTN_PRIMARY} hover:bg-red-100`}>
                  <Square className={BTN_ICON} aria-hidden="true" /> Fermer
                </button>
              </div>
            );
          })()}
        </>
      )}
      {showCloseModal && activeSession && (
        <EndOfShiftModal
          trsData={trsData}
          hasActiveLot={!!activeLot}
          aClasserMin={trsData?.aClasserMin ?? 0}
          trsObjective={Number(selectedEquipment?.trsObjective || 75)}
          isClosing={isClosing}
          notes={sessionNotes}
          onNotesChange={setSessionNotes}
          onConfirm={handleConfirmClose}
          onCancel={() => setShowCloseModal(false)}
        />
      )}
    </div>
  );
}

// ─── TAED live status row ─────────────────────────────────
// Always-visible 4-metric strip: Durée / Lots / TRS / À classer.
// Inspired by the TAED (Target-Actual-Efficiency-Downtime) framework
// from Vorne/OEE.com — gives the operator a one-glance shift picture.

type Severity = "ok" | "warn" | "urgent";

const SEV_BORDER: Record<Severity, string> = {
  ok:     "bg-white border-gray-200",
  warn:   "border-amber-300 bg-amber-50",
  urgent: "border-red-300 bg-red-50",
};
const SEV_COLOR: Record<Severity, string | undefined> = {
  ok:     undefined,
  warn:   "#92400e",
  urgent: "#b91c1c",
};

function LiveSessionBar({ elapsed, sessionTrs, aClasserMin }: {
  elapsed: number;
  sessionTrs: TrsMetrics | undefined;
  aClasserMin: number;
}) {
  const dur = elapsed > 60 ? fmtDuration(Math.floor(elapsed / 60)) : elapsed > 0 ? `${elapsed}s` : "—";
  const trs = sessionTrs?.TRS;
  const lots = sessionTrs?.lotCount ?? 0;
  const sev: Severity = aClasserMin >= 10 ? "urgent" : aClasserMin > 1 ? "warn" : "ok";

  const metrics: Array<{ label: string; value: string; color?: string; sev?: Severity }> = [
    { label: "Durée", value: dur },
    { label: "Lots",  value: lots > 0 ? String(lots) : "—" },
    { label: "TRS",   value: trs != null ? fmtPct(trs) : "—", color: trs != null ? trsColor(trs) : undefined },
    { label: "Non classé", value: sev === "ok" ? "—" : fmtDuration(aClasserMin), sev },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      {metrics.map(m => (
        <div key={m.label} className={`rounded-xl border px-2 py-4 text-center ${SEV_BORDER[m.sev ?? "ok"]}`}>
          <div className="text-[10px] text-gray-500 uppercase tracking-wide leading-tight">{m.label}</div>
          <div className="text-xl font-bold mt-0.5 leading-tight tabular-nums"
            style={{ color: m.sev ? SEV_COLOR[m.sev] : m.color }}>
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── « À classer » banner + quick-qualify (Vorne post-gap pattern) ─
// Below 5 min: a plain reminder that opens the full declare form.
// At ≥ 5 min with known recent categories: expands inline so the operator
// classifies the whole gap in one tap, without leaving the timeline.

function AClasserBanner({ minutes, onDeclare, categories, equipmentId, sessionId, onQualified }: {
  minutes: number;
  onDeclare: () => void;
  categories: DowntimeCategory[];
  equipmentId: string;
  sessionId: string;
  onQualified: () => void;
}) {
  const urgent = minutes >= 10;
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [selecting, setSelecting] = useState(false);

  // Split like AddDowntimeForm: localStorage read only on equipmentId change,
  // category lookup only on recentIds/categories change.
  const recentIds = useMemo(() => getRecentDowntimes(equipmentId), [equipmentId]);
  const recentCats = useMemo(
    () => recentIds.map(id => categories.find(c => c.id === id)).filter(Boolean) as DowntimeCategory[],
    [recentIds, categories],
  );
  const canQuickQualify = minutes >= 2 && recentCats.length > 0;

  const quickQualify = async (categoryId: string) => {
    if (selecting) return;
    setSelecting(true);
    try {
      await api.addSessionDowntime(sessionId, { categoryId, durationMinutes: Math.round(minutes) });
      saveRecentDowntime(equipmentId, categoryId);
      toast.success("Temps classé");
      onQualified();
    } catch (err: any) {
      toast.error(err.message || "Échec du classement");
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className={`w-full mb-4 rounded-xl border transition ${
      urgent ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
    }`}>
      <button onClick={() => (canQuickQualify ? setExpanded(e => !e) : onDeclare())}
        aria-expanded={canQuickQualify ? expanded : undefined}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition rounded-xl ${
          urgent ? "hover:bg-red-100" : "hover:bg-amber-100"
        }`}>
        <span className={`flex items-center gap-2 ${urgent ? "text-red-800" : "text-amber-800"}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${urgent ? "text-red-600" : ""}`} aria-hidden="true" />
          <span className={`text-sm ${urgent ? "font-bold" : "font-medium"}`}>
            {fmtDuration(minutes)} de temps non classé
            {urgent && " — à déclarer avant fermeture"}
          </span>
        </span>
        <span className={`text-xs shrink-0 ${urgent ? "text-red-700 font-semibold" : "text-amber-700"}`}>
          {canQuickQualify ? (expanded ? "Réduire ▲" : "Classer ▾") : "Déclarer →"}
        </span>
      </button>

      {canQuickQualify && expanded && (
        <div className={`px-4 pb-4 border-t ${urgent ? "border-red-200" : "border-amber-200"}`}>
          <p className="text-xs text-gray-600 mt-3 mb-2">Classer ces {fmtDuration(minutes)} en un tap :</p>
          <div className={`grid gap-2 ${recentGridCols(recentCats.length)}`}>
            {recentCats.map(c => (
              <button key={c.id} type="button" disabled={selecting} onClick={() => quickQualify(c.id)}
                className="border border-gray-200 bg-white rounded-lg px-2 py-3 text-sm text-center min-h-[60px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition">
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onDeclare}
            className="mt-3 text-sm text-blue-600 font-medium">
            Autre arrêt / saisie détaillée →
          </button>
        </div>
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

    type Segment = { start: number; end: number; type: "planned" | "lot" | "unplanned"; label: string };
    const segs: Segment[] = [];

    // Legacy planned phases (sessionEvents) still surface as planned stops.
    for (const ev of detail.events) {
      if (ev.eventType === "lot_start" || ev.eventType === "lot_end") continue;
      const start = new Date(ev.startedAt).getTime();
      const dur = (ev.durationMinutes || 0) * 60_000;
      const end = ev.endedAt ? new Date(ev.endedAt).getTime() : start + dur;
      segs.push({ start, end, type: ev.isPlanned ? "planned" : "unplanned", label: ev.label || ev.eventType.replace(/_/g, " ") });
    }

    // Lots = green (line running / production)
    for (const lot of detail.lots) {
      const start = new Date(lot.startedAt).getTime();
      const end = lot.endedAt ? new Date(lot.endedAt).getTime() : now;
      segs.push({ start, end, type: "lot", label: `Lot ${lot.batchNumber}` });
    }

    // Declared stops — amber if planned, red if unplanned.
    for (const dt of detail.downtimes) {
      const start = new Date(dt.startedAt).getTime();
      const dur = dt.durationMinutes * 60_000;
      const end = dt.endedAt ? new Date(dt.endedAt).getTime() : start + dur;
      segs.push({ start, end, type: dt.isPlanned ? "planned" : "unplanned", label: dt.isPlanned ? "Arrêt planifié" : "Arrêt non planifié" });
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

  const colorMap = { planned: "bg-amber-400", lot: "bg-green-500", unplanned: "bg-red-500" };

  return (
    <div className="mb-4" role="region" aria-label="Frise temporelle de la session">
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden" role="img" aria-label="Barre de temps — vert : production, orange : arrêt planifié, rouge : arrêt non planifié">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${colorMap[seg.type]} opacity-80`}
            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
            title={seg.label}
            aria-label={seg.label}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500" aria-hidden="true">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500" /> Production</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-400" /> Arrêt planifié</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500" /> Arrêt non planifié</span>
      </div>
    </div>
  );
}

// ─── U8: TRS Summary with Historical Reference ──────────

function TrsSummaryCard({ sessionTrs, equipmentId, trsObjective }: { sessionTrs: TrsMetrics | undefined; equipmentId: string; trsObjective: number }) {
  const [avg30, setAvg30] = useState<number | null>(null);

  useEffect(() => {
    if (!equipmentId) return;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);
    // Non-critical: if the 30-day fetch fails (no history yet, minor network
    // hiccup), the trend arrow simply won't show — no toast noise for operators.
    api.dashboardTrs(equipmentId, fromStr, toStr)
      .then(data => {
        if (data.total && data.total.TRS > 0) setAvg30(data.total.TRS);
      })
      .catch(() => {});
  }, [equipmentId]);

  if (!sessionTrs) return null;
  const currentTRS = sessionTrs.TRS;
  const trend = avg30 != null ? currentTRS - avg30 : null;

  return (
    <div className="bg-white rounded-xl border shadow-sm mb-4 p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4" aria-hidden="true" /> TRS consolidé — Session
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
            {trend != null && trend > 0 && <TrendingUp className="h-3.5 w-3.5 text-green-600" aria-label="En hausse vs. 30j" />}
            {trend != null && trend < 0 && <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-label="En baisse vs. 30j" />}
          </span>
        )}
      </div>
      {sessionTrs.reliability && sessionTrs.reliability.breakdownCount > 0 && (
        <div className="flex items-center gap-4 mt-2 text-xs border-t pt-2">
          <span className="text-gray-500">
            Pannes: <span className="font-medium text-red-600">{sessionTrs.reliability.breakdownCount}</span>
          </span>
          {sessionTrs.reliability.mtbf != null && (
            <span className="text-gray-500">
              MTBF: <span className="font-medium">{fmtDuration(Math.round(sessionTrs.reliability.mtbf))}</span>
            </span>
          )}
          {sessionTrs.reliability.mttr != null && (
            <span className="text-gray-500">
              MTTR: <span className="font-medium">{fmtDuration(Math.round(sessionTrs.reliability.mttr))}</span>
            </span>
          )}
        </div>
      )}
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

  const [lotDts, setLotDts] = useState<LotDowntime[]>([]);
  const fetchLotDts = useCallback(async () => {
    try { setLotDts(await api.lotDowntimes(lot.id)); } catch { /* non-critical */ }
  }, [lot.id]);
  useEffect(() => { fetchLotDts(); }, [fetchLotDts]);

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
    if (rejectRate > 0.05 && prod > 0) w.push({ level: "warning", msg: `Taux de rebut élevé : ${(rejectRate * 100).toFixed(1)}%` });
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
          <Play className="h-5 w-5" aria-hidden="true" /> Lot actif: {lot.batchNumber}
        </h3>
        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">En cours</span>
      </div>

      <div className="flex items-center gap-2 text-sm text-green-700 mb-3 flex-wrap">
        <span>{product?.name} · Cadence: <span className="font-semibold tabular-nums">{lot.cadenceUsed} {lot.cadenceUnit}</span></span>
        {!editingCadence && (
          <button onClick={() => { setEditingCadence(true); setNewCadence(String(lot.cadenceUsed)); }}
            className="inline-flex items-center gap-1 text-xs text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 hover:bg-blue-50">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" /> Modifier
          </button>
        )}
      </div>

      {editingCadence && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
          <div className="text-xs font-medium text-blue-800">Nouvelle cadence ({lot.cadenceUnit})</div>
          <div className="flex gap-2">
            <input aria-label={`Nouvelle cadence en ${lot.cadenceUnit}`} type="number" inputMode="numeric" min="1" value={newCadence} onChange={e => setNewCadence(e.target.value)}
              className="w-28 border rounded-lg px-3 py-2 text-base" autoFocus />
            <input aria-label="Motif de modification de cadence" value={cadenceReason} onChange={e => setCadenceReason(e.target.value)} placeholder="Motif (optionnel)"
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
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
          {errors.map((e, i) => <div key={i} className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {e.msg}</div>)}
        </div>
      )}
      {warns.length > 0 && (
        <div role="status" className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          {warns.map((w, i) => <div key={i} className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {w.msg}</div>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label htmlFor={`lot-produced-${lot.id}`} className="block text-xs text-gray-600 mb-1">Qté produite (NPR)</label>
          <input id={`lot-produced-${lot.id}`} type="number" value={produced} onChange={e => setProduced(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" inputMode="numeric" min="0" />
        </div>
        <div>
          <label htmlFor={`lot-conforming-${lot.id}`} className="block text-xs text-gray-600 mb-1">Qté conforme (NPB)</label>
          <input id={`lot-conforming-${lot.id}`} type="number" value={conforming} onChange={e => setConforming(e.target.value)}
            aria-invalid={errors.some(e => e.msg.startsWith("Conforme"))}
            className={`w-full border rounded-lg px-3 py-3 text-base ${errors.some(e => e.msg.startsWith("Conforme")) ? "border-red-400" : ""}`}
            inputMode="numeric" min="0" />
        </div>
      </div>

      {/* Declared lot stops with inline delete */}
      {lotDts.length > 0 && (
        <div className="mb-3">
          <DeclaredDowntimesList
            title="Arrêts du lot"
            downtimes={lotDts}
            onDelete={async (dtId) => {
              try {
                await api.deleteDowntime(lot.id, dtId);
                await fetchLotDts();
                onUpdate();
              } catch (err: any) {
                toast.error(err.message || "Échec de la suppression");
              }
            }}
          />
        </div>
      )}

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
          <AlertTriangle className={BTN_ICON} aria-hidden="true" /> Arrêt
        </button>
        {!showConfirm && (
          <button onClick={handleClose} disabled={closing}
            className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 ${flashClose ? "btn-flash" : ""}`}>
            <Square className={BTN_ICON} aria-hidden="true" /> Clôturer lot
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
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [flashStart, triggerFlashStart] = useFlash();

  // Warn if batch number was already used in this session
  const batchDuplicate = useMemo(
    () => batch !== "" && previousLots.some(l => l.batchNumber === batch),
    [previousLots, batch],
  );

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

  // U5: Cadence warnings — absolute range check + deviation from reference
  const cadenceWarning = useMemo(() => {
    if (!cadence) return null;
    const current = Number(cadence);
    const maxReasonable = cadenceUnit === "u/h" ? 300_000 : 5_000;
    if (current > maxReasonable) return `Cadence anormalement élevée (${current} ${cadenceUnit}) — vérifiez la saisie.`;
    if (refCadence) {
      const ref = Number(refCadence);
      if (ref > 0) {
        const deviation = Math.abs(current - ref) / ref;
        if (deviation > 0.2) return `Écart de ${(deviation * 100).toFixed(0)}% vs cadence théorique (${refCadence} ${cadenceUnit})`;
      }
    }
    return null;
  }, [cadence, refCadence, cadenceUnit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !batch || !cadence) return;
    // Show confirmation step for first lot or when cadence deviates >20%
    if (previousLots.length === 0 || cadenceWarning) {
      setStep("confirm");
      return;
    }
    submitLot();
  };

  const submitLot = async () => {
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
      setStep("form");
    }
    setLoading(false);
  };

  // ─── Confirmation step (premier lot ou déviation cadence) ────
  if (step === "confirm") {
    const selectedProduct = products.find(p => p.id === productId);
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Package className="h-5 w-5" aria-hidden="true" /> Confirmer le démarrage
        </h2>
        <div className="bg-white rounded-xl border p-4 mb-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Produit</span>
            <span className="font-semibold">{selectedProduct?.name ?? productId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">N° de lot</span>
            <span className="font-semibold font-mono">{batch}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Cadence</span>
            <span className="font-semibold">{cadence} {cadenceUnit}</span>
          </div>
          {cadenceWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
              <p className="text-xs text-amber-700">{cadenceWarning}</p>
            </div>
          )}
        </div>
        {error && <div role="alert" className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}
        <div className="flex gap-3">
          <button onClick={() => setStep("form")}
            aria-label="Retour au formulaire"
            className={`flex-1 border border-gray-300 text-gray-700 ${BTN_PRIMARY} hover:bg-gray-50`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Modifier
          </button>
          <button onClick={submitLot} disabled={loading}
            className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 ${flashStart ? "btn-flash" : ""}`}>
            {loading ? "Démarrage…" : "Démarrer"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <BackButton onClick={onBack} />
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Package className="h-5 w-5" aria-hidden="true" /> Nouveau lot
      </h2>

      {error && <div role="alert" className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        <div>
          <label htmlFor="lot-product" className="block text-sm font-medium mb-1">Produit</label>
          <select id="lot-product" value={productId} onChange={e => setProductId(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" required>
            <option value="">Choisir...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="lot-batch" className="block text-sm font-medium mb-1">N° de lot</label>
          <input id="lot-batch" value={batch} onChange={e => setBatch(e.target.value.toUpperCase())}
            maxLength={30}
            aria-invalid={!!(batch && !/^[A-Z0-9-_./]{1,30}$/.test(batch)) || batchDuplicate}
            className={`w-full border rounded-lg px-3 py-3 text-base ${batch && !/^[A-Z0-9-_./]{1,30}$/.test(batch) ? "border-red-400" : batchDuplicate ? "border-amber-400" : ""}`}
            placeholder={suggestedBatch || "26019"} required />
          {batch && !/^[A-Z0-9-_./]{1,30}$/.test(batch) && (
            <p className="text-xs text-red-600 mt-1">Format invalide — lettres majuscules, chiffres, tirets, points et "/" uniquement (30 car. max.)</p>
          )}
          {batchDuplicate && /^[A-Z0-9-_./]{1,30}$/.test(batch) && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />Ce numéro de lot a déjà été utilisé dans cette session.</p>
          )}
          {suggestedBatch && batch === suggestedBatch && /^[A-Z0-9-_./]{1,30}$/.test(batch) && !batchDuplicate && (
            <p className="text-xs text-blue-600 mt-1">Auto-suggéré : {suggestedBatch}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="lot-cadence" className="block text-sm font-medium mb-1">Cadence</label>
            <input id="lot-cadence" type="number" value={cadence} onChange={e => setCadence(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base" placeholder="120" required inputMode="numeric" />
            {refCadence && (
              <p className="text-xs text-green-600 mt-1">Ref: {refCadence} {cadenceUnit}</p>
            )}
          </div>
          <div>
            <label htmlFor="lot-cadence-unit" className="block text-sm font-medium mb-1">Unité</label>
            <select id="lot-cadence-unit" value={cadenceUnit} onChange={e => setCadenceUnit(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </div>

        {/* U5: Cadence deviation warning */}
        {cadenceWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-700">{cadenceWarning}</p>
          </div>
        )}

        <button type="submit" disabled={loading || !!(batch && !/^[A-Z0-9-_./]{1,30}$/.test(batch))}
          className={`w-full bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none ${flashStart ? "btn-flash" : ""}`}>
          {loading ? "Démarrage…" : "Démarrer le lot"}
        </button>
      </form>
    </div>
  );
}

// ─── Quick stop durations (minutes) ─────────────────────
const QUICK_DURATIONS = [5, 10, 15, 30, 60];


// ─── Shared declared-stops list with inline delete ───────────

function DeclaredDowntimesList({ title, downtimes, onDelete }: {
  title: string; downtimes: LotDowntime[]; onDelete: (dtId: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <div className="bg-white rounded-xl border shadow-sm p-3 mb-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title} ({downtimes.length})
      </p>
      <div className="space-y-1.5">
        {downtimes.map(dt => (
          <div key={dt.id} className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-50">
            {confirmId === dt.id ? (
              <>
                <span className="text-sm text-red-700 flex-1">Supprimer ?</span>
                <button onClick={() => { onDelete(dt.id); setConfirmId(null); }}
                  className="text-xs px-2.5 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">Oui</button>
                <button onClick={() => setConfirmId(null)}
                  className="text-xs px-2.5 py-1 border rounded-lg bg-white hover:bg-gray-50 transition">Annuler</button>
              </>
            ) : (
              <>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${dt.isPlanned ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                  {dt.isPlanned ? "P" : "NP"}
                </span>
                <span className="text-xs text-gray-400 shrink-0">{dt.famille}</span>
                <span className="text-sm font-medium text-gray-700 flex-1 truncate">{dt.reason}</span>
                <span className="text-sm tabular-nums text-gray-500 shrink-0">{fmtDuration(dt.durationMinutes)}</span>
                <button onClick={() => setConfirmId(dt.id)} aria-label="Supprimer"
                  className="p-1 rounded text-gray-400 hover:text-red-500 transition shrink-0">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add Downtime Form (U1: timer auto, U2: large buttons) ─

const RECENT_DOWNTIMES_MAX = 3;
const recentDowntimesKey = (equipmentId: string) => `recentDowntimes_${equipmentId}`;
// Literal classes so the Tailwind compiler can see them (dynamic
// `grid-cols-${n}` strings are not detected at build time).
const RECENT_GRID_COLS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3"] as const;
const recentGridCols = (n: number) => RECENT_GRID_COLS[Math.min(n, 3)];

function getRecentDowntimes(equipmentId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentDowntimesKey(equipmentId)) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function saveRecentDowntime(equipmentId: string, catId: string) {
  const prev = getRecentDowntimes(equipmentId);
  const next = [catId, ...prev.filter(id => id !== catId)].slice(0, RECENT_DOWNTIMES_MAX);
  localStorage.setItem(recentDowntimesKey(equipmentId), JSON.stringify(next));
}

function AddDowntimeForm({ lotId, sessionId, equipmentId, categories, aClasserMin, onAdded, onBack }: {
  lotId?: string; sessionId: string; equipmentId: string; categories: DowntimeCategory[]; aClasserMin?: number; onAdded: () => void; onBack: () => void;
}) {
  const suggestedMin = (aClasserMin ?? 0) >= 1 ? Math.round(aClasserMin!) : 0;
  const [catId, setCatId] = useState("");
  const [flashDowntime, triggerFlashDowntime] = useFlash();
  const toast = useToast();
  const [mode, setMode] = useState<"manual" | "timer">("manual");

  // Raccourcis : 3 dernières catégories utilisées sur cet équipement.
  // Split into two memos: localStorage read only on equipmentId change; lookup on categories change.
  const recentIds = useMemo(() => getRecentDowntimes(equipmentId), [equipmentId]);
  const recentCats = useMemo(
    () => recentIds.map(id => categories.find(c => c.id === id)).filter(Boolean) as DowntimeCategory[],
    [recentIds, categories],
  );
  const [duration, setDuration] = useState(suggestedMin > 0 ? String(suggestedMin) : "");
  const [comment, setComment] = useState("");
  const [shortStop, setShortStop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [familleFilterNP, setFamilleFilterNP] = useState<string | null>(null);
  const [familleFilterP, setFamilleFilterP] = useState<string | null>(null);

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

  const famillesNP = useMemo(
    () => [...new Set(categories.filter(c => !c.isPlanned).map(c => c.famille))],
    [categories],
  );
  const famillesP = useMemo(
    () => [...new Set(categories.filter(c => c.isPlanned).map(c => c.famille))],
    [categories],
  );

  // Two top-level sections — Non planifié then Planifié — each grouped by famille.
  const sections = useMemo(() => {
    const build = (planned: boolean, filter: string | null) => {
      const grouped: Record<string, DowntimeCategory[]> = {};
      for (const c of categories) {
        if (c.isPlanned !== planned) continue;
        if (filter && c.famille !== filter) continue;
        (grouped[c.famille] ??= []).push(c);
      }
      return Object.entries(grouped);
    };
    return [
      { planned: false, title: "Arrêts non planifiés", hint: "Pannes, attentes, utilités, qualité…", familles: build(false, familleFilterNP), allFamilles: famillesNP, filter: familleFilterNP, setFilter: setFamilleFilterNP },
      { planned: true, title: "Arrêts planifiés", hint: "Changement de série, nettoyage, pause, maintenance préventive…", familles: build(true, familleFilterP), allFamilles: famillesP, filter: familleFilterP, setFilter: setFamilleFilterP },
    ];
  }, [categories, familleFilterNP, familleFilterP, famillesNP, famillesP]);

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
      saveRecentDowntime(equipmentId, catId);
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
      <BackButton onClick={onBack} />
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" aria-hidden="true" /> Déclarer un arrêt
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        {lotId
          ? "Pendant la production — rattaché au lot en cours."
          : "Hors production — rattaché à la session (inter-lots)."}
      </p>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        {/* Raccourcis : 3 derniers arrêts utilisés sur cet équipement */}
        {recentCats.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Arrêts récents</p>
            <div className={`grid gap-2 ${recentGridCols(recentCats.length)}`}>
              {recentCats.map(c => {
                const sel = catId === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => setCatId(c.id)}
                    aria-pressed={sel}
                    className={`border rounded-lg px-2 py-3 text-sm text-center min-h-[64px] transition font-medium ${
                      sel
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700"
                    }`}>
                    <span className="line-clamp-2 leading-snug">{c.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-t mt-3" />
          </div>
        )}

        {/* Two clear sections: NON planifié (red) then planifié (orange).
            Famille filter pills narrow the grid; TRS badge shows metric impact. */}
        {sections.map(section => (
          <div key={section.title} className={`rounded-xl border p-3 ${section.planned ? "border-amber-200 bg-amber-50/40" : "border-red-200 bg-red-50/40"}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2.5 w-2.5 rounded-full ${section.planned ? "bg-amber-500" : "bg-red-500"}`} />
              <span className={`text-sm font-bold ${section.planned ? "text-amber-800" : "text-red-800"}`}>{section.title}</span>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">{section.hint}</p>
            {section.allFamilles.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1">
                <button type="button" onClick={() => section.setFilter(null)}
                  aria-pressed={!section.filter}
                  className={`whitespace-nowrap text-xs px-2.5 py-1 rounded-full border transition ${!section.filter ? (section.planned ? "bg-amber-500 text-white border-amber-500" : "bg-red-500 text-white border-red-500") : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                  Tous
                </button>
                {section.allFamilles.map(f => (
                  <button key={f} type="button" onClick={() => section.setFilter(f)}
                    aria-pressed={section.filter === f}
                    className={`whitespace-nowrap text-xs px-2.5 py-1 rounded-full border transition ${section.filter === f ? (section.planned ? "bg-amber-500 text-white border-amber-500" : "bg-red-500 text-white border-red-500") : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                    {f}
                  </button>
                ))}
              </div>
            )}
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
                      <button key={c.id} type="button" onClick={() => { setCatId(c.id); section.setFilter(null); }}
                        aria-pressed={sel}
                        className={`border rounded-lg px-2.5 py-3 text-sm text-left transition min-h-[64px] bg-white ${sel ? selCls : "hover:bg-gray-50"}`}>
                        <span className="line-clamp-2 leading-snug">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* TRS impact badge — shown once a category is selected */}
        {catId && (() => {
          const selCat = categories.find(c => c.id === catId);
          if (!selCat) return null;
          const { label, cls } = shortStop
            ? { label: "↓ Performance (TP)", cls: "bg-orange-100 text-orange-700" }
            : selCat.isPlanned
              ? { label: "↓ Temps requis (tAP → tR)", cls: "bg-amber-100 text-amber-700" }
              : { label: "↓ Disponibilité (tF)", cls: "bg-red-100 text-red-700" };
          return (
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>{label}</span>
              <span className="text-xs text-gray-500 truncate">{selCat.label}</span>
            </div>
          );
        })()}

        {/* U1: Mode selector (manual vs timer) */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("manual")}
            aria-pressed={mode === "manual"}
            className={`flex-1 border rounded-lg py-2.5 text-sm font-medium transition min-h-[52px] ${mode === "manual" ? "border-blue-500 bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}>
            Saisie manuelle
          </button>
          <button type="button" onClick={() => setMode("timer")}
            aria-pressed={mode === "timer"}
            className={`flex-1 border rounded-lg py-2.5 text-sm font-medium transition min-h-[52px] ${mode === "timer" ? "border-blue-500 bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}>
            Chronomètre
          </button>
        </div>

        {mode === "manual" ? (
          <div className="space-y-2">
            <label htmlFor="dt-duration" className="block text-sm font-medium">Durée (minutes)</label>
            <div className="flex gap-2 flex-wrap">
              {suggestedMin > 0 && !QUICK_DURATIONS.includes(suggestedMin) && (
                <button type="button" onClick={() => setDuration(String(suggestedMin))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition min-w-[52px] min-h-[52px] ${
                    duration === String(suggestedMin) ? "bg-teal-500 text-white border-teal-500" : "bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100"
                  }`}>
                  {suggestedMin}<span className="block text-[9px] leading-tight opacity-80">non classé</span>
                </button>
              )}
              {QUICK_DURATIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(String(d))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition min-w-[52px] min-h-[52px] ${
                    duration === String(d) ? "bg-orange-500 text-white border-orange-500" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <input id="dt-duration" type="number" value={duration} onChange={e => setDuration(e.target.value)}
              aria-invalid={!!(duration && (Number(duration) < 1 || Number(duration) > 1440))}
              className={`w-full border rounded-lg px-3 py-3 text-base ${duration && (Number(duration) < 1 || Number(duration) > 1440) ? "border-red-400" : ""}`}
              placeholder="Autre durée…" inputMode="numeric" min="1" max="1440" />
            {duration && Number(duration) < 1 && <p className="text-xs text-red-600 mt-0.5">La durée doit être d'au moins 1 minute.</p>}
            {duration && Number(duration) > 1440 && <p className="text-xs text-red-600 mt-0.5">La durée ne peut pas dépasser 24h (1440 min).</p>}
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl font-mono font-bold text-orange-700 mb-3">{fmtTimerElapsed(timerElapsed)}</div>
            {!timerRunning ? (
              <button type="button" onClick={startTimer}
                className={`bg-orange-500 text-white ${BTN_PRIMARY} w-full hover:bg-orange-600`}>
                <Play className={BTN_ICON} aria-hidden="true" /> Démarrer le chrono
              </button>
            ) : (
              <button type="button" onClick={stopTimer}
                className={`bg-red-600 text-white ${BTN_PRIMARY} w-full hover:bg-red-700`}>
                <StopCircle className={BTN_ICON} aria-hidden="true" /> Arrêter ({fmtTimerElapsed(timerElapsed)})
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
          <label htmlFor="dt-comment" className="block text-sm font-medium mb-1">
            Commentaire
            <span className="ml-1.5 text-xs text-gray-400 font-normal">(raison obligatoire si modification — Annex 11)</span>
          </label>
          <input id="dt-comment" value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Ex : changement de format, réglage cadence…"
            className="w-full border rounded-lg px-3 py-3 text-base" />
        </div>
        <button type="submit" disabled={loading || !catId || !duration || Number(duration) < 1 || Number(duration) > 1440}
          className={`w-full bg-orange-500 text-white ${BTN_PRIMARY} hover:bg-orange-600 disabled:opacity-50 ${flashDowntime ? "btn-flash" : ""}`}>
          Enregistrer l'arrêt
        </button>
      </form>
    </div>
  );
}

// ─── End-of-Shift Summary Modal ──────────────────────────

function CheckItem({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm py-1.5 px-3 rounded-lg ${ok ? "text-green-700 bg-green-50" : warn ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50"}`}>
      {ok ? <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : warn ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
}

function EndOfShiftModal({ trsData, hasActiveLot, aClasserMin, trsObjective, isClosing, notes, onNotesChange, onConfirm, onCancel }: {
  trsData: SessionTrsResponse | null;
  hasActiveLot: boolean;
  aClasserMin: number;
  trsObjective: number;
  isClosing?: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const s = trsData?.session;
  const classifiedOk = aClasserMin < 5;
  const classifiedBlocking = aClasserMin >= 10;

  const titleId = "end-of-shift-title";

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center"
      role="presentation"
      onKeyDown={e => { if (e.key === "Escape" && !isClosing && !classifiedBlocking) onCancel(); }}
      onClick={() => { if (!isClosing && !classifiedBlocking) onCancel(); }}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold mb-1">Fermer le compteur ?</h2>
        <p className="text-sm text-gray-500 mb-4">Résumé de la session en cours</p>

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
                { label: "Produits", raw: fmtNumber(s.totalProduced) },
                { label: "Conformes", raw: fmtNumber(s.totalConforming) },
                { label: "Rebuts", raw: s.totalRebut > 0 ? fmtNumber(s.totalRebut) : "0", colored: s.totalRebut > 0 },
              ] as { label: string; value?: number; raw?: string; colored?: boolean }[]).map(item => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-500">{item.label}</div>
                  <div className="text-base font-bold"
                    style={{ color: item.colored && item.value != null ? trsColor(item.value) : item.colored && item.raw != null && item.label === "Rebuts" ? "#dc2626" : undefined }}>
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

        {/* Checklist avant fermeture */}
        <div className="space-y-1.5 mb-4">
          <CheckItem
            ok={!hasActiveLot}
            warn={false}
            label={hasActiveLot ? "Un lot est en cours — il sera clôturé automatiquement" : "Tous les lots sont clôturés"}
          />
          <CheckItem
            ok={classifiedOk}
            warn={!classifiedBlocking && !classifiedOk}
            label={classifiedOk
              ? "Temps de session classé"
              : `${fmtDuration(aClasserMin)} non classés — ${classifiedBlocking ? "déclarez les arrêts avant de fermer" : "pensez à déclarer les arrêts"}`
            }
          />
        </div>

        {classifiedBlocking && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 font-medium">
            Fermez ce modal et déclarez les arrêts inter-lots avant de clore la session.
          </p>
        )}

        <div className="mb-4">
          <label htmlFor="eos-notes" className="block text-xs font-medium text-gray-600 mb-1">
            Remarques de fin de poste <span className="font-normal text-gray-400">(facultatif — tracé dans l'audit GMP)</span>
          </label>
          <textarea
            id="eos-notes"
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            rows={2}
            placeholder="Ex : légères vibrations sur tête 3, lot B-228 mis en quarantaine par QC…"
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} disabled={isClosing}
            className={`flex-1 border border-gray-300 text-gray-700 ${BTN_PRIMARY} hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none`}>
            Annuler
          </button>
          <button onClick={onConfirm} disabled={classifiedBlocking || isClosing}
            className={`flex-1 bg-red-600 text-white ${BTN_PRIMARY} hover:bg-red-700 disabled:opacity-40 disabled:pointer-events-none`}>
            {isClosing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Square className="h-4 w-4" aria-hidden="true" />}
            {isClosing ? "Fermeture…" : "Fermer"}
          </button>
        </div>
      </div>
    </div>
  );
}
