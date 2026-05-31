import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, type LotEntry, type Product, type LotDowntime } from "@/lib/api";
import { fmtPct, trsColor, diffMinutes, fmtDuration as fmtMinutes } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { ListSkeleton } from "@/components/Skeleton";
import { ClipboardCheck, Check, X, ChevronDown, ChevronUp, RefreshCw, Clock, AlertOctagon } from "lucide-react";

const PULL_THRESHOLD = 60;

function fmtLotDuration(start: string, end: string | null): string {
  return end ? fmtMinutes(diffMinutes(start, end)) : "En cours";
}

function QualityBar({ tq }: { tq: number | null }) {
  const color = tq !== null ? trsColor(tq) : "#9ca3af";
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${(tq ?? 0) * 100}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold shrink-0" style={{ color }}>
        {tq !== null ? `${(tq * 100).toFixed(1)}% conf.` : "—"}
      </span>
    </div>
  );
}

export default function SupervisorPage() {
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lotDowntimes, setLotDowntimes] = useState<Record<string, LotDowntime[]>>({});
  const [loadingDowntimesId, setLoadingDowntimesId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const toast = useToast();

  const loadData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [l, p] = await Promise.all([api.pendingLots(), api.products()]);
      setLots(l);
      setProducts(p);
    } catch (err: any) {
      toast.error(err.message || "Chargement des lots échoué");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { loadData(true); }, [loadData]);

  const expandLot = useCallback(async (lotId: string) => {
    if (expanded === lotId) { setExpanded(null); return; }
    setExpanded(lotId);
    if (lotDowntimes[lotId] !== undefined) return; // cached
    setLoadingDowntimesId(lotId);
    try {
      const dts = await api.lotDowntimes(lotId);
      setLotDowntimes(prev => ({ ...prev, [lotId]: dts }));
    } catch {
      setLotDowntimes(prev => ({ ...prev, [lotId]: [] }));
    } finally {
      setLoadingDowntimesId(null);
    }
  }, [expanded, lotDowntimes]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) touchStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0 && window.scrollY === 0) setPullDistance(Math.min(delta, 80));
  };
  const onTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD) { setRefreshing(true); setPullDistance(0); await loadData(); }
    else setPullDistance(0);
  };

  const handleAction = async (lotId: string, action: "validate" | "reject") => {
    setSubmitting(true);
    try {
      await api.validateLot(lotId, action, comment || undefined);
      setLots(prev => prev.filter(l => l.id !== lotId));
      setExpanded(null);
      setComment("");
      toast.success(action === "validate" ? "Lot validé" : "Lot rejeté");
    } catch (err: any) {
      toast.error(err.message || "Échec de la validation du lot");
    } finally {
      setSubmitting(false);
    }
  };

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  return (
    <div
      className="max-w-2xl mx-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {(pullDistance > 0 || refreshing) && (
        <div className="flex items-center justify-center overflow-hidden transition-all" style={{ height: refreshing ? 40 : pullDistance }}>
          <RefreshCw
            className={`h-5 w-5 transition-colors ${pullDistance >= PULL_THRESHOLD || refreshing ? "text-blue-600" : "text-blue-300"} ${refreshing ? "animate-spin" : ""}`}
            style={{ transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)` }}
          />
        </div>
      )}

      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5" /> Lots à valider
        {lots.length > 0 && (
          <span className="ml-1 text-sm font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{lots.length}</span>
        )}
      </h2>

      {loading && <ListSkeleton />}

      {!loading && lots.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
          <ClipboardCheck className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">Aucun lot en attente</p>
          <p className="text-sm mt-1">Tous les lots ont été traités.</p>
        </div>
      )}

      <div className="space-y-3">
        {lots.map(lot => {
          const product = productMap.get(lot.productId);
          const isExpanded = expanded === lot.id;
          const rejectRate = lot.quantityProduced > 0 ? lot.quantityRejected / lot.quantityProduced : 0;
          const tq = lot.quantityProduced > 0 ? lot.quantityConforming / lot.quantityProduced : null;

          const errors: string[] = [];
          const warnings: string[] = [];
          if (lot.quantityConforming > lot.quantityProduced) errors.push("Conforme > Produit");
          if (lot.quantityProduced === 0) errors.push("Production nulle");
          if (Number(lot.cadenceUsed) <= 0) errors.push("Cadence absente");
          if (rejectRate > 0.05) warnings.push(`Taux rebut élevé: ${(rejectRate * 100).toFixed(1)}%`);

          const dts = lotDowntimes[lot.id];
          const totalDowntimeMin = dts ? dts.reduce((s, d) => s + d.durationMinutes, 0) : null;

          return (
            <div key={lot.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Card header — always visible */}
              <button
                onClick={() => expandLot(lot.id)}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">Lot {lot.batchNumber}</span>
                      {errors.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">
                          <AlertOctagon className="h-3 w-3" />{errors.length}
                        </span>
                      )}
                      {warnings.length > 0 && (
                        <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">{warnings.length} warn</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {product?.name} · Lot #{lot.lotOrder}
                      {lot.endedAt && (
                        <span className="ml-2 inline-flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />{fmtLotDuration(lot.startedAt, lot.endedAt)}
                        </span>
                      )}
                    </div>
                    <QualityBar tq={tq} />
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0 mt-1" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0 mt-1" />}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t px-4 py-3 space-y-3">
                  {/* Quantities */}
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {[
                      { label: "Produit", value: lot.quantityProduced },
                      { label: "Conforme", value: lot.quantityConforming },
                      { label: "Rebut", value: lot.quantityRejected },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="font-semibold text-base">{value.toLocaleString("fr-FR")}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4 text-sm flex-wrap">
                    <span><span className="text-gray-500">Cadence:</span> {lot.cadenceUsed} {lot.cadenceUnit}</span>
                    {tq !== null && (
                      <span>
                        <span className="text-gray-500">TQ:</span>{" "}
                        <span style={{ color: trsColor(tq) }} className="font-semibold">{fmtPct(tq)}</span>
                      </span>
                    )}
                  </div>

                  {/* Downtime events */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Arrêts enregistrés
                      {totalDowntimeMin !== null && totalDowntimeMin > 0 && (
                        <span className="ml-1 font-normal text-gray-400">— {totalDowntimeMin} min total</span>
                      )}
                    </div>
                    {loadingDowntimesId === lot.id && (
                      <div className="text-xs text-gray-400 py-2">Chargement…</div>
                    )}
                    {dts && dts.length === 0 && (
                      <div className="text-xs text-gray-400 py-1">Aucun arrêt enregistré sur ce lot.</div>
                    )}
                    {dts && dts.length > 0 && (
                      <div className="space-y-1">
                        {dts.map(dt => (
                          <div key={dt.id} className="flex items-center gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${dt.isPlanned ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                              {dt.isPlanned ? "P" : "NP"}
                            </span>
                            <span className="text-gray-400 shrink-0">{dt.famille}</span>
                            <span className="text-gray-300">›</span>
                            <span className="font-medium text-gray-700 flex-1">{dt.reason}</span>
                            <span className="shrink-0 font-mono text-gray-500">{dt.durationMinutes} min</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Coherence warnings */}
                  {errors.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-2 space-y-0.5">
                      {errors.map((e, i) => <div key={i} className="text-xs text-red-600 font-medium">{e}</div>)}
                    </div>
                  )}
                  {warnings.length > 0 && (
                    <div className="bg-yellow-50 rounded-lg p-2 space-y-0.5">
                      {warnings.map((w, i) => <div key={i} className="text-xs text-yellow-700">{w}</div>)}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Commentaire superviseur</label>
                    <input
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Optionnel…"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(lot.id, "validate")}
                      disabled={submitting || errors.length > 0}
                      className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-green-700 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Check className="h-4 w-4" /> Valider
                    </button>
                    <button
                      onClick={() => handleAction(lot.id, "reject")}
                      disabled={submitting}
                      className="flex-1 bg-red-100 text-red-700 rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-red-200 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <X className="h-4 w-4" /> Rejeter
                    </button>
                  </div>
                  {errors.length > 0 && (
                    <p className="text-xs text-red-500 text-center">Résolvez les erreurs avant de valider. Vous pouvez rejeter le lot.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
