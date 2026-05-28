import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, type Room, type Equipment, type Session, type SessionDetail, type Product, type DowntimeCategory, type ProductEquipmentCadence, type SessionTrsResponse } from "@/lib/api";
import { fmtDuration, fmtPct, trsColor } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { Onboarding } from "@/components/Onboarding";
import { Timer, Play, Square, Plus, ChevronLeft, AlertTriangle, Clock, Package, Gauge, TrendingUp, TrendingDown, StopCircle, Zap } from "lucide-react";

type View = "pick-room" | "pick-equip" | "timeline" | "new-lot" | "add-phase" | "add-downtime";

// ─── Touch-friendly class constants (U2) ─────────────────
const BTN_PRIMARY = "min-h-[48px] text-base font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition active:scale-95";
const BTN_ICON = "h-6 w-6";

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
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [prefillProductId, setPrefillProductId] = useState("");
  const toast = useToast();

  // Load rooms on mount
  useEffect(() => { api.rooms().then(setRooms).catch((err) => toast.error(err.message || "Chargement des salles échoué")); }, []);
  useEffect(() => { api.products().then(setProducts).catch((err) => toast.error(err.message || "Chargement des produits échoué")); }, []);

  // Timer for active session
  useEffect(() => {
    if (!activeSession || activeSession.status !== "active") return;
    const start = new Date(activeSession.openedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [activeSession]);

  const loadDetail = useCallback(async (sessionId: string) => {
    const [d, t] = await Promise.all([api.session(sessionId), api.sessionTrs(sessionId)]);
    setDetail(d);
    setTrsData(t);
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

  const handleCloseSession = async () => {
    if (!activeSession) return;
    if (!confirm("Fermer le compteur ? Tous les lots actifs seront clôturés.")) return;
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
          {equipmentsList.map(eq => (
            <button
              key={eq.id}
              onClick={() => handleEquipmentSelect(eq)}
              className="bg-white rounded-xl border p-5 text-left hover:border-blue-500 hover:shadow transition min-h-[56px]"
            >
              <div className="font-semibold text-lg">{eq.name}</div>
              <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                <span>{eq.code}</span>
                <span className="capitalize bg-gray-100 px-2 py-0.5 rounded">{eq.equipmentType}</span>
                <span>Obj. TRS: {eq.trsObjective}%</span>
              </div>
            </button>
          ))}
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

  if (view === "add-phase" && activeSession) {
    return <AddPhaseForm
      sessionId={activeSession.id}
      onAdded={() => { loadDetail(activeSession.id); setView("timeline"); }}
      onBack={() => setView("timeline")}
    />;
  }

  if (view === "add-downtime" && activeSession && detail) {
    const activeLot = detail.lots.find(l => l.status === "active");
    if (!activeLot) { setView("timeline"); return null; }
    return <AddDowntimeForm
      lotId={activeLot.id}
      categories={categories}
      onAdded={() => { loadDetail(activeSession.id); setView("timeline"); }}
      onBack={() => setView("timeline")}
    />;
  }

  // ─── Timeline View (U2, U6, U8) ───────────────────────

  const activeLot = detail?.lots.find(l => l.status === "active");
  const sessionTrs = trsData?.session;

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => { setView("pick-room"); setActiveSession(null); setDetail(null); }}
        className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Timer className={`h-5 w-5 ${activeSession ? "text-green-600" : "text-gray-400"}`} />
            {selectedEquipment?.name}
          </h2>
          <p className="text-sm text-gray-500">{selectedRoom?.name}</p>
        </div>
        {activeSession && activeSession.status === "active" && (
          <div className="text-right">
            <div className="text-3xl font-mono font-bold text-green-700">{fmtElapsed(elapsed)}</div>
            <div className="text-xs text-gray-400">Session ouverte</div>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {!activeSession && (
        <button onClick={handleOpenSession}
          className={`w-full bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 text-lg`}>
          <Play className={BTN_ICON} /> Ouvrir le compteur
        </button>
      )}

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
            <div className="divide-y max-h-64 overflow-y-auto">
              {detail.events.map(ev => {
                const lot = detail.lots.find(l => l.id === ev.lotEntryId);
                const product = lot ? products.find(p => p.id === lot.productId) : null;
                return (
                  <div key={ev.id} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        ev.eventType === "lot_start" ? "bg-green-500" :
                        ev.eventType === "lot_end" ? "bg-blue-500" :
                        ev.isPlanned ? "bg-amber-400" : "bg-gray-400"
                      }`} />
                      <span className="text-sm font-medium">
                        {ev.eventType === "lot_start" ? `Lot ${lot?.batchNumber ?? "?"} démarré` :
                         ev.eventType === "lot_end" ? `Lot ${lot?.batchNumber ?? "?"} clôturé` :
                         ev.label || ev.eventType.replace("_", " ")}
                      </span>
                      {product && <span className="text-gray-400 ml-2">({product.name})</span>}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {new Date(ev.startedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {ev.durationMinutes != null && <span className="ml-1">· {ev.durationMinutes} min</span>}
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
                  const lotTrs = trsData?.lots?.find((t: any) => t.lotId === lot.id);
                  return (
                    <div key={lot.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">Lot {lot.batchNumber}</span>
                          <span className="text-gray-400 ml-2 text-sm">{product?.name}</span>
                        </div>
                        {lotTrs && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">TP {fmtPct(lotTrs.TP)}</span>
                            <span className="text-xs text-gray-500">TQ {fmtPct(lotTrs.TQ)}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Produit: {lot.quantityProduced} · Conforme: {lot.quantityConforming} · Cadence: {lot.cadenceUsed} {lot.cadenceUnit}
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

          {/* Actions (U2: large touch targets) */}
          <div className="flex gap-3 mb-8">
            <button onClick={() => setView("add-phase")}
              className={`flex-1 bg-blue-50 text-blue-700 ${BTN_PRIMARY} hover:bg-blue-100`}>
              <Plus className={BTN_ICON} /> Phase
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

function TrsSummaryCard({ sessionTrs, equipmentId, trsObjective }: { sessionTrs: any; equipmentId: string; trsObjective: number }) {
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

  const currentTRS = sessionTrs.TRS;
  const trend = avg30 != null ? currentTRS - avg30 : null;

  return (
    <div className="bg-white rounded-xl border shadow-sm mb-4 p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4" /> TRS Consolide Session
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-center">
        {[
          { label: "TRS", value: sessionTrs.TRS },
          { label: "TRG", value: sessionTrs.TRG },
          { label: "DO", value: sessionTrs.DO },
          { label: "TP", value: sessionTrs.TP },
          { label: "TQ", value: sessionTrs.TQ },
        ].map(item => (
          <div key={item.label} className="bg-gray-50 rounded-lg p-2">
            <div className="text-xs text-gray-500">{item.label}</div>
            <div className="text-lg font-bold" style={{ color: item.label === "TRS" || item.label === "TRG" ? trsColor(item.value) : undefined }}>
              {fmtPct(item.value)}
            </div>
          </div>
        ))}
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
  lot: any; products: Product[]; categories: DowntimeCategory[]; sessionId: string;
  onUpdate: () => void; onAddDowntime: () => void;
}) {
  const product = products.find(p => p.id === lot.productId);
  const [produced, setProduced] = useState(String(lot.quantityProduced));
  const [conforming, setConforming] = useState(String(lot.quantityConforming));
  const [closing, setClosing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const toast = useToast();

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

      <div className="text-sm text-green-700 mb-3">{product?.name} · Cadence: {lot.cadenceUsed} {lot.cadenceUnit}</div>

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
            className={`flex-1 bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50`}>
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
  equipmentId: string; defaultCadenceUnit: string; previousLots: any[];
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
          className={`w-full bg-green-600 text-white ${BTN_PRIMARY} hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none`}>
          {loading ? "Démarrage…" : "Démarrer le lot"}
        </button>
      </form>
    </div>
  );
}

// ─── Add Phase Form (U2: large buttons) ──────────────────

function AddPhaseForm({ sessionId, onAdded, onBack }: {
  sessionId: string; onAdded: () => void; onBack: () => void;
}) {
  const phases = [
    { type: "nettoyage", label: "Nettoyage", planned: true },
    { type: "vide_ligne", label: "Vide de ligne", planned: true },
    { type: "remplissage", label: "Remplissage", planned: true },
    { type: "pause", label: "Pause", planned: true },
    { type: "chsb", label: "CHSB (Changement serie Blistereuse)", planned: true },
    { type: "chsg", label: "CHSG (Changement serie Geluleuse)", planned: true },
    { type: "apr", label: "APR (Arret programme)", planned: true },
    { type: "mqch", label: "MQCH (Mise en quarantaine)", planned: true },
  ];

  const [selectedType, setSelectedType] = useState("");
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !duration) return;
    setLoading(true);
    const phase = phases.find(p => p.type === selectedType);
    try {
      await api.addEvent(sessionId, {
        eventType: selectedType,
        durationMinutes: Number(duration),
        isPlanned: phase?.planned ?? true,
        comment: comment || undefined,
      });
      onAdded();
    } catch (err: any) {
      toast.error(err.message || "Échec de l'ajout de la phase");
    }
    setLoading(false);
  };

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5" /> Ajouter une phase
      </h2>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        {/* U2: Larger phase buttons */}
        <div className="grid grid-cols-2 gap-2">
          {phases.map(p => (
            <button
              key={p.type}
              type="button"
              onClick={() => setSelectedType(p.type)}
              className={`border rounded-lg px-3 py-3.5 text-sm text-left transition min-h-[48px] ${
                selectedType === p.type ? "border-blue-500 bg-blue-50 text-blue-700 font-medium" : "hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Duree (minutes)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" placeholder="30" required inputMode="numeric" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Commentaire (optionnel)</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" />
        </div>
        <button type="submit" disabled={loading || !selectedType}
          className={`w-full bg-blue-600 text-white ${BTN_PRIMARY} hover:bg-blue-700 disabled:opacity-50`}>
          Ajouter
        </button>
      </form>
    </div>
  );
}

// ─── Add Downtime Form (U1: timer auto, U2: large buttons) ─

function AddDowntimeForm({ lotId, categories, onAdded, onBack }: {
  lotId: string; categories: DowntimeCategory[]; onAdded: () => void; onBack: () => void;
}) {
  const [catId, setCatId] = useState("");
  const toast = useToast();
  const [mode, setMode] = useState<"manual" | "timer">("manual");
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
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

  const grouped = categories.reduce<Record<string, DowntimeCategory[]>>((acc, c) => {
    (acc[c.famille] ??= []).push(c);
    return acc;
  }, {});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catId || !duration) return;
    setLoading(true);
    try {
      await api.addDowntime(lotId, {
        categoryId: catId,
        durationMinutes: Number(duration),
        comment: comment || undefined,
      });
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
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" /> Declarer un arret
      </h2>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-4 space-y-4">
        {/* Category selection (U2: larger buttons) */}
        {Object.entries(grouped).map(([famille, cats]) => (
          <div key={famille}>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{famille}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {cats.map(c => (
                <button key={c.id} type="button" onClick={() => setCatId(c.id)}
                  className={`border rounded-lg px-2.5 py-3 text-sm text-left transition min-h-[44px] ${
                    catId === c.id ? "border-orange-500 bg-orange-50 text-orange-700 font-medium" : "hover:bg-gray-50"
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>
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
            Chronometre
          </button>
        </div>

        {mode === "manual" ? (
          <div>
            <label className="block text-sm font-medium mb-1">Duree (minutes)</label>
            <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
              className="w-full border rounded-lg px-3 py-3 text-base" placeholder="15" required inputMode="numeric" />
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl font-mono font-bold text-orange-700 mb-3">{fmtTimerElapsed(timerElapsed)}</div>
            {!timerRunning ? (
              <button type="button" onClick={startTimer}
                className={`bg-orange-500 text-white ${BTN_PRIMARY} w-full hover:bg-orange-600`}>
                <Play className={BTN_ICON} /> Demarrer le chrono
              </button>
            ) : (
              <button type="button" onClick={stopTimer}
                className={`bg-red-600 text-white ${BTN_PRIMARY} w-full hover:bg-red-700`}>
                <StopCircle className={BTN_ICON} /> Arreter ({fmtTimerElapsed(timerElapsed)})
              </button>
            )}
            {duration && !timerRunning && (
              <p className="text-sm text-green-600 mt-2">Duree capturee: {duration} min</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Commentaire</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base" />
        </div>
        <button type="submit" disabled={loading || !catId || !duration}
          className={`w-full bg-orange-500 text-white ${BTN_PRIMARY} hover:bg-orange-600 disabled:opacity-50`}>
          Enregistrer l'arret
        </button>
      </form>
    </div>
  );
}
