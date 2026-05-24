import { useState, useEffect } from "react";
import { api, type LotEntry, type Product } from "@/lib/api";
import { fmtPct, trsColor } from "@trs/engine";
import { ClipboardCheck, Check, X, ChevronDown, ChevronUp } from "lucide-react";

export default function SupervisorPage() {
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.pendingLots(), api.products()])
      .then(([l, p]) => { setLots(l); setProducts(p); })
      .finally(() => setLoading(false));
  }, []);

  const handleAction = async (lotId: string, action: "validate" | "reject") => {
    await api.validateLot(lotId, action, comment || undefined);
    setLots(prev => prev.filter(l => l.id !== lotId));
    setExpanded(null);
    setComment("");
  };

  const getProduct = (id: string) => products.find(p => p.id === id);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5" /> Lots a valider
      </h2>

      {lots.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
          Aucun lot en attente de validation
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
          if (rejectRate > 0.05) warnings.push(`Taux rebut eleve: ${(rejectRate * 100).toFixed(1)}%`);

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
                    <button onClick={() => handleAction(lot.id, "validate")}
                      className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-green-700">
                      <Check className="h-4 w-4" /> Valider
                    </button>
                    <button onClick={() => handleAction(lot.id, "reject")}
                      className="flex-1 bg-red-100 text-red-700 rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-1 hover:bg-red-200">
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
