import { useState, useEffect, useCallback, useRef } from "react";
import { api, type LotEntry, type Product } from "@/lib/api";
import { fmtPct, trsColor } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { ListSkeleton } from "@/components/Skeleton";
import { ClipboardCheck, Check, X, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

const PULL_THRESHOLD = 60;

export default function SupervisorPage() {
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(delta, 80));
    }
  };

  const onTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullDistance(0);
      await loadData();
    } else {
      setPullDistance(0);
    }
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

  const getProduct = (id: string) => products.find(p => p.id === id);

  return (
    <div
      className="max-w-2xl mx-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-all"
          style={{ height: refreshing ? 40 : pullDistance }}
        >
          <RefreshCw
            className={`h-5 w-5 transition-colors ${
              pullDistance >= PULL_THRESHOLD || refreshing ? "text-blue-600" : "text-blue-300"
            } ${refreshing ? "animate-spin" : ""}`}
            style={{ transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)` }}
          />
        </div>
      )}

      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5" /> Lots à valider
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
          const product = getProduct(lot.productId);
          const isExpanded = expanded === lot.id;
          const rejected = lot.quantityRejected;
          const rejectRate = lot.quantityProduced > 0 ? rejected / lot.quantityProduced : 0;

          // Coherence checks
          const warnings: string[] = [];
          const errors: string[] = [];
          if (lot.quantityConforming > lot.quantityProduced) errors.push("Conforme > Produit");
          if (lot.quantityProduced === 0) errors.push("Production nulle");
          if (Number(lot.cadenceUsed) <= 0) errors.push("Cadence absente");
          if (rejectRate > 0.05) warnings.push(`Taux rebut élevé: ${(rejectRate * 100).toFixed(1)}%`);

          return (
            <div key={lot.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <button onClick={() => setExpanded(isExpanded ? null : lot.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium">Lot {lot.batchNumber}</div>
                    <div className="text-xs text-gray-400">{product?.name} · Lot #{lot.lotOrder}</div>
                  </div>
                  {errors.length > 0 && (
                    <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">{errors.length} err</span>
                  )}
                  {warnings.length > 0 && (
                    <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">{warnings.length} warn</span>
                  )}
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="border-t px-4 py-3 space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500">Produit</div>
                      <div className="font-medium">{lot.quantityProduced}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500">Conforme</div>
                      <div className="font-medium">{lot.quantityConforming}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500">Rebut</div>
                      <div className="font-medium">{lot.quantityRejected}</div>
                    </div>
                  </div>

                  <div className="text-sm">
                    <span className="text-gray-500">Cadence:</span> {lot.cadenceUsed} {lot.cadenceUnit}
                  </div>

                  {errors.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-2">
                      {errors.map((e, i) => <div key={i} className="text-xs text-red-600">{e}</div>)}
                    </div>
                  )}
                  {warnings.length > 0 && (
                    <div className="bg-yellow-50 rounded-lg p-2">
                      {warnings.map((w, i) => <div key={i} className="text-xs text-yellow-700">{w}</div>)}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Commentaire superviseur</label>
                    <input value={comment} onChange={e => setComment(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optionnel..." />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => handleAction(lot.id, "validate")} disabled={submitting}
                      className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-green-700 transition disabled:opacity-50 disabled:pointer-events-none">
                      <Check className="h-4 w-4" /> Valider
                    </button>
                    <button onClick={() => handleAction(lot.id, "reject")} disabled={submitting}
                      className="flex-1 bg-red-100 text-red-700 rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-red-200 transition disabled:opacity-50 disabled:pointer-events-none">
                      <X className="h-4 w-4" /> Rejeter
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
