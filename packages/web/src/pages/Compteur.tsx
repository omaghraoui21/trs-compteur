import { useState, useEffect, useCallback } from "react";
import { api, type Room, type Equipment, type Session, type SessionDetail, type Product, type DowntimeCategory } from "@/lib/api";
import { fmtDuration, fmtPct, trsColor } from "@trs/engine";
import { Timer, Play, Square, Plus, ChevronLeft, AlertTriangle, Clock, Package, Gauge } from "lucide-react";

type View = "pick-room" | "pick-equip" | "timeline" | "new-lot" | "add-phase" | "add-downtime";

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
  const [trsData, setTrsData] = useState<any>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Load rooms on mount
  useEffect(() => { api.rooms().then(setRooms).catch(() => {}); }, []);
  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

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
    const cats = await api.downtimeCategories(eq.equipmentType ?? undefined);
    setCategories(cats);

    // Check for existing active session
    const allSessions = await api.sessions({ equipmentId: eq.id });
    const active = allSessions.find(s => s.status === "active");
    if (active) {
      setActiveSession(active);
      await loadDetail(active.id);
      setView("timeline");
    } else {
      setView("timeline"); // show empty timeline with "open" button
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
    if (!confirm("Fermer le compteur ? Tous les lots actifs seront clotures.")) return;
    await api.closeSession(activeSession.id);
    setActiveSession(null);
    setDetail(null);
    setTrsData(null);
    setView("pick-room");
  };

  const fmtElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // ─── Room Picker ──────────────────────────────────────

  if (view === "pick-room") {
    return (
      <div className="max-w-lg mx-auto">
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
              className="bg-white rounded-xl border p-4 text-left hover:border-blue-500 hover:shadow transition"
            >
              <div className="font-semibold">{r.name}</div>
              <div className="text-sm text-gray-500">{r.code}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── Equipment Picker ─────────────────────────────────

  if (view === "pick-equip") {
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={() => setView("pick-room")} className="flex items-center gap-1 text-sm text-blue-600 mb-4">
          <ChevronLeft className="h-4 w-4" /> Retour
        </button>
        <h2 className="text-xl font-bold mb-4">Choisir l'equipement — {selectedRoom?.name}</h2>
        <div className="grid gap-3">
          {equipmentsList.map(eq => (
            <button
              key={eq.id}
              onClick={() => handleEquipmentSelect(eq)}
              className="bg-white rounded-xl border p-4 text-left hover:border-blue-500 hover:shadow transition"
            >
              <div className="font-semibold">{eq.name}</div>
              <div className="text-sm text-gray-500">{eq.code} — Objectif TRS: {eq.trsObjective}%</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── New Lot Form ─────────────────────────────────────

  if (view === "new-lot" && activeSession) {
    return (
      <NewLotForm
        session={activeSession}
        products={products}
        defaultCadenceUnit={selectedEquipment?.defaultCadenceUnit || "u/h"}
        onCreated={async () => {
          await loadDetail(activeSession.id);
          setView("timeline");
        }}
        onBack={() => setView("timeline")}
      />
    );
  }

  // ─── Add Phase Form ───────────────────────────────────

  if (view === "add-phase" && activeSession) {
    return (
      <AddPhaseForm
        sessionId={activeSession.id}
        onAdded={async () => {
          await loadDetail(activeSession.id);
          setView("timeline");
        }}
        onBack={() => setView("timeline")}
      />
    );
  }

  // ─── Add Downtime Form ────────────────────────────────

  if (view === "add-downtime" && detail) {
    const activeLot = detail.lots.find(l => l.status === "active");
    if (!activeLot) { setView("timeline"); return null; }
    return (
      <AddDowntimeForm
        lotId={activeLot.id}
        categories={categories}
        onAdded={async () => {
          await loadDetail(activeSession!.id);
          setView("timeline");
        }}
        onBack={() => setView("timeline")}
      />
    );
  }

  // ─── Session Timeline ─────────────────────────────────

  const activeLot = detail?.lots.find(l => l.status === "active");
  const sessionTrs = trsData?.session;

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => { setView("pick-room"); setActiveSession(null); setDetail(null); }}
        className="flex items-center gap-1 text-sm text-blue-600 mb-4">
        <ChevronLeft className="h-4 w-4" /> Changer de local
      </button>

      {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">{error}</div>}

      {/* Session header */}
      <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Timer className="h-5 w-5 text-blue-600" />
              {selectedEquipment?.name || "Equipement"}
            </h2>
            <div className="text-sm text-gray-500">{selectedRoom?.name}</div>
          </div>
          {activeSession ? (
            <div className="text-right">
              <div className="font-mono text-2xl font-bold text-blue-600">{fmtElapsed(elapsed)}</div>
              <div className="text-xs text-gray-400">
                Ouvert {new Date(activeSession.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ) : (
            <button onClick={handleOpenSession}
              className="bg-green-600 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 hover:bg-green-700 transition">
              <Play className="h-5 w-5" /> Ouvrir compteur
            </button>
          )}
        </div>
      </div>

      {!activeSession && (
        <div className="text-center text-gray-400 py-12">
          Aucune session active. Cliquez "Ouvrir compteur" pour demarrer.
        </div>
      )}

      {activeSession && detail && (
        <>
          {/* Timeline events */}
          <div className="bg-white rounded-xl border shadow-sm mb-4">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">Timeline</h3>
              <span className="text-xs text-gray-400">{detail.events.length} evenements</span>
            </div>
            <div className="divide-y">
              {detail.events.map(ev => {
                const lot = ev.lotEntryId ? detail.lots.find(l => l.id === ev.lotEntryId) : null;
                const product = lot ? products.find(p => p.id === lot.productId) : null;
                return (
                  <div key={ev.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <div className={`w-2 h-2 rounded-full ${ev.isPlanned ? "bg-blue-400" : ev.eventType === "lot_start" ? "bg-green-500" : ev.eventType === "lot_end" ? "bg-orange-500" : "bg-gray-400"}`} />
                    <div className="flex-1">
                      <span className="font-medium">
                        {ev.eventType === "lot_start" ? `Lot ${lot?.batchNumber ?? "?"} demarr\u00e9` :
                         ev.eventType === "lot_end" ? `Lot ${lot?.batchNumber ?? "?"} clotur\u00e9` :
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
                <div className="px-4 py-6 text-center text-gray-400 text-sm">Aucun evenement enregistre</div>
              )}
            </div>
          </div>

          {/* Active lot card */}
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
                <h3 className="font-semibold text-sm">Lots clotures</h3>
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

          {/* Session TRS summary */}
          {sessionTrs && sessionTrs.lotCount > 0 && (
            <div className="bg-white rounded-xl border shadow-sm mb-4 p-4">
              <h3 className="font-semibold text-sm mb-3">TRS Consolide Session</h3>
              <div className="grid grid-cols-5 gap-2 text-center">
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
              <div className="flex gap-3 mt-3 text-xs text-gray-500">
                <span>tO: {fmtDuration(sessionTrs.tO)}</span>
                <span>tR: {fmtDuration(sessionTrs.tR)}</span>
                <span>Lots: {sessionTrs.lotCount}</span>
                <span>Total: {sessionTrs.totalProduced} prod. / {sessionTrs.totalConforming} conf.</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mb-8">
            <button onClick={() => setView("add-phase")}
              className="flex-1 bg-blue-50 text-blue-700 rounded-xl py-3 font-medium flex items-center justify-center gap-2 hover:bg-blue-100 transition">
              <Plus className="h-4 w-4" /> Ajouter phase
            </button>
            {!activeLot && (
              <button onClick={() => setView("new-lot")}
                className="flex-1 bg-green-50 text-green-700 rounded-xl py-3 font-medium flex items-center justify-center gap-2 hover:bg-green-100 transition">
                <Package className="h-4 w-4" /> Nouveau lot
              </button>
            )}
            <button onClick={handleCloseSession}
              className="flex-1 bg-red-50 text-red-700 rounded-xl py-3 font-medium flex items-center justify-center gap-2 hover:bg-red-100 transition">
              <Square className="h-4 w-4" /> Fermer compteur
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function ActiveLotCard({ lot, products, categories, sessionId, onUpdate, onAddDowntime }: {
  lot: any; products: Product[]; categories: DowntimeCategory[]; sessionId: string;
  onUpdate: () => void; onAddDowntime: () => void;
}) {
  const product = products.find(p => p.id === lot.productId);
  const [produced, setProduced] = useState(String(lot.quantityProduced));
  const [conforming, setConforming] = useState(String(lot.quantityConforming));
  const [closing, setClosing] = useState(false);

  const handleClose = async () => {
    setClosing(true);
    try {
      await api.closeLot(lot.id, {
        quantityProduced: Number(produced),
        quantityConforming: Number(conforming),
        quantityRejected: Math.max(0, Number(produced) - Number(conforming)),
      });
      onUpdate();
    } catch { }
    setClosing(false);
  };

  return (
    <div className="bg-green-50 rounded-xl border-2 border-green-300 shadow-sm mb-4 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-green-800 flex items-center gap-2">
          <Play className="h-4 w-4" /> Lot actif: {lot.batchNumber}
        </h3>
        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">En cours</span>
      </div>

      <div className="text-sm text-green-700 mb-3">{product?.name} · Cadence: {lot.cadenceUsed} {lot.cadenceUnit}</div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Qte produite (NPR)</label>
          <input type="number" value={produced} onChange={e => setProduced(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Qte conforme (NPB)</label>
          <input type="number" value={conforming} onChange={e => setConforming(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onAddDowntime}
          className="flex-1 bg-orange-100 text-orange-700 rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-orange-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Arret
        </button>
        <button onClick={handleClose} disabled={closing}
          className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-green-700 disabled:opacity-50">
          <Square className="h-3.5 w-3.5" /> Cloturer lot
        </button>
      </div>
    </div>
  );
}

function NewLotForm({ session, products, defaultCadenceUnit, onCreated, onBack }: {
  session: Session; products: Product[]; defaultCadenceUnit: string;
  onCreated: () => void; onBack: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [batch, setBatch] = useState("");
  const [cadence, setCadence] = useState("");
  const [cadenceUnit, setCadenceUnit] = useState(defaultCadenceUnit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Auto-fill cadence from product
  useEffect(() => {
    const p = products.find(pp => pp.id === productId);
    if (p?.defaultCadence) {
      setCadence(p.defaultCadence);
      setCadenceUnit(p.cadenceUnit);
    }
  }, [productId, products]);

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
            className="w-full border rounded-lg px-3 py-2" required>
            <option value="">Choisir...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">N de lot</label>
          <input value={batch} onChange={e => setBatch(e.target.value)}
            className="w-full border rounded-lg px-3 py-2" placeholder="26019" required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cadence</label>
            <input type="number" value={cadence} onChange={e => setCadence(e.target.value)}
              className="w-full border rounded-lg px-3 py-2" placeholder="120" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unite</label>
            <select value={cadenceUnit} onChange={e => setCadenceUnit(e.target.value)}
              className="w-full border rounded-lg px-3 py-2">
              <option value="u/min">u/min</option>
              <option value="u/h">u/h</option>
            </select>
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full bg-green-600 text-white rounded-lg py-2.5 font-medium hover:bg-green-700 disabled:opacity-50">
          {loading ? "Demarrage..." : "Demarrer le lot"}
        </button>
      </form>
    </div>
  );
}

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
    } catch {}
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
        <div className="grid grid-cols-2 gap-2">
          {phases.map(p => (
            <button
              key={p.type}
              type="button"
              onClick={() => setSelectedType(p.type)}
              className={`border rounded-lg px-3 py-2.5 text-sm text-left transition ${
                selectedType === p.type ? "border-blue-500 bg-blue-50 text-blue-700" : "hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Duree (minutes)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full border rounded-lg px-3 py-2" placeholder="30" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Commentaire (optionnel)</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border rounded-lg px-3 py-2" />
        </div>
        <button type="submit" disabled={loading || !selectedType}
          className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50">
          Ajouter
        </button>
      </form>
    </div>
  );
}

function AddDowntimeForm({ lotId, categories, onAdded, onBack }: {
  lotId: string; categories: DowntimeCategory[]; onAdded: () => void; onBack: () => void;
}) {
  const [catId, setCatId] = useState("");
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

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
    } catch {}
    setLoading(false);
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
        {Object.entries(grouped).map(([famille, cats]) => (
          <div key={famille}>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{famille}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {cats.map(c => (
                <button key={c.id} type="button" onClick={() => setCatId(c.id)}
                  className={`border rounded-lg px-2.5 py-2 text-xs text-left transition ${
                    catId === c.id ? "border-orange-500 bg-orange-50 text-orange-700" : "hover:bg-gray-50"
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium mb-1">Duree (minutes)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full border rounded-lg px-3 py-2" placeholder="15" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Commentaire</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border rounded-lg px-3 py-2" />
        </div>
        <button type="submit" disabled={loading || !catId}
          className="w-full bg-orange-500 text-white rounded-lg py-2.5 font-medium hover:bg-orange-600 disabled:opacity-50">
          Enregistrer l'arret
        </button>
      </form>
    </div>
  );
}
