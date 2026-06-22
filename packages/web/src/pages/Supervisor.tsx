import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, type PendingLot, type Product, type LotDowntime, type CadenceChange, type CorrectLotInput, type ElectronicSignature } from "@/lib/api";
import { fmtPct, trsColor, diffMinutes, fmtNumber, fmtDuration as fmtMinutes } from "@trs/engine";
import { useToast } from "@/components/Toast";
import { ListSkeleton, Skeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { ClipboardCheck, Check, X, ChevronDown, ChevronUp, RefreshCw, Clock, AlertOctagon, ShieldCheck, User, CalendarDays, Cpu, Pencil, Loader2 } from "lucide-react";

const PULL_THRESHOLD = 60;

type StatusFilter = "closed" | "validated" | "rejected";
type SignAction = "validate" | "reject" | "correct";

function fmtLotDuration(start: string, end: string | null): string {
  return end ? fmtMinutes(diffMinutes(start, end)) : "En cours";
}

// YYYY-MM-DD → DD/MM/YYYY without UTC-midnight shift.
// Guard against a missing/malformed date so one bad record never crashes the
// whole validation queue (the page is wrapped in an ErrorBoundary).
function fmtSessionDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
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

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "closed",    label: "En attente" },
  { key: "validated", label: "Validés" },
  { key: "rejected",  label: "Rejetés" },
];

export default function SupervisorPage() {
  const [lots, setLots] = useState<PendingLot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("closed");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lotDowntimes, setLotDowntimes] = useState<Record<string, LotDowntime[]>>({});
  const [lotCadence, setLotCadence] = useState<Record<string, CadenceChange[]>>({});
  const [lotSignatures, setLotSignatures] = useState<Record<string, ElectronicSignature[]>>({});
  const [loadingDowntimesId, setLoadingDowntimesId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [pendingSign, setPendingSign] = useState<{ lotId: string; action: SignAction } | null>(null);
  const [signPassword, setSignPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Correction form state
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctionData, setCorrectionData] = useState({ qProd: "", qConf: "", qRej: "", cadence: "", cadenceUnit: "", reason: "" });
  const [lotDataFailed, setLotDataFailed] = useState<Record<string, boolean>>({});

  const touchStartY = useRef(0);
  const signDialogRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!pendingSign) return;
    const el = signDialogRef.current;
    if (!el) return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    el.addEventListener("keydown", trap);
    return () => el.removeEventListener("keydown", trap);
  }, [pendingSign]);

  const loadData = useCallback(async (filter: StatusFilter, showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [l, p] = await Promise.all([api.pendingLots(filter), api.products()]);
      setLots(l);
      setProducts(p);
    } catch (err: any) {
      toast.error(err.message || "Chargement des lots échoué");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { loadData(statusFilter, true); }, [statusFilter, loadData]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
    setExpanded(null);
    setCorrecting(null);
    setComment("");
    setCommentError("");
  };

  const expandLot = useCallback(async (lotId: string) => {
    if (expanded === lotId) { setExpanded(null); return; }
    setExpanded(lotId);
    setCorrecting(null);
    setComment("");
    setCommentError("");
    if (lotDowntimes[lotId] !== undefined) return;
    setLoadingDowntimesId(lotId);
    try {
      const [dts, cad, sigs] = await Promise.all([api.lotDowntimes(lotId), api.lotCadenceHistory(lotId), api.lotSignatures(lotId)]);
      setLotDowntimes(prev => ({ ...prev, [lotId]: dts }));
      setLotCadence(prev => ({ ...prev, [lotId]: cad }));
      setLotSignatures(prev => ({ ...prev, [lotId]: sigs }));
    } catch {
      setLotDowntimes(prev => ({ ...prev, [lotId]: [] }));
      setLotCadence(prev => ({ ...prev, [lotId]: [] }));
      setLotSignatures(prev => ({ ...prev, [lotId]: [] }));
      setLotDataFailed(prev => ({ ...prev, [lotId]: true }));
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
    if (pullDistance >= PULL_THRESHOLD) { setRefreshing(true); setPullDistance(0); await loadData(statusFilter); }
    else setPullDistance(0);
  };

  const openSign = (lotId: string, action: SignAction) => {
    if (action === "reject" && !comment.trim()) {
      setCommentError("Un commentaire est obligatoire pour le rejet");
      return;
    }
    setCommentError("");
    setPendingSign({ lotId, action });
    setSignPassword("");
  };

  const handleAction = async (lotId: string, action: SignAction, password: string) => {
    setSubmitting(true);
    try {
      if (action === "correct") {
        const payload: CorrectLotInput = {
          correctionReason: correctionData.reason,
          password,
          ...(correctionData.qProd  !== "" && { quantityProduced:   Number(correctionData.qProd) }),
          ...(correctionData.qConf  !== "" && { quantityConforming: Number(correctionData.qConf) }),
          ...(correctionData.qRej   !== "" && { quantityRejected:   Number(correctionData.qRej) }),
          ...(correctionData.cadence !== "" && { cadenceUsed:       Number(correctionData.cadence) }),
          ...(correctionData.cadenceUnit !== "" && { cadenceUnit: correctionData.cadenceUnit }),
        };
        const { lot: updated, signature } = await api.correctLot(lotId, payload);
        setLots(prev => prev.map(l => l.id === lotId ? { ...l, ...updated } : l));
        setCorrecting(null);
        // Invalidate cached downtimes/cadence so expanded detail refreshes;
        // surface the new signed correction immediately in the signatures list.
        setLotDowntimes(prev => { const n = { ...prev }; delete n[lotId]; return n; });
        setLotCadence(prev => { const n = { ...prev }; delete n[lotId]; return n; });
        setLotSignatures(prev => ({ ...prev, [lotId]: [signature, ...(prev[lotId] ?? [])] }));
        toast.success("Données corrigées et signées");
      } else {
        await api.validateLot(lotId, action, password, comment || undefined);
        setLots(prev => prev.filter(l => l.id !== lotId));
        setExpanded(null);
        setComment("");
        toast.success(action === "validate" ? "Lot validé et signé" : "Lot rejeté et signé");
      }
      setPendingSign(null);
      setSignPassword("");
    } catch (err: any) {
      toast.error(err.message || "Échec de la signature");
    } finally {
      setSubmitting(false);
    }
  };

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const lotDerived = useMemo(() => {
    const m = new Map<string, {
      tq: number | null; errors: string[]; warnings: string[];
      dts: LotDowntime[] | undefined; totalDowntimeMin: number | null;
      plannedMin: number; unplannedMin: number; cadChanges: CadenceChange[]; lotDurationMin: number | null;
    }>();
    for (const lot of lots) {
      const rejectRate = lot.quantityProduced > 0 ? lot.quantityRejected / lot.quantityProduced : 0;
      const tq = lot.quantityProduced > 0 ? lot.quantityConforming / lot.quantityProduced : null;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (lot.quantityConforming > lot.quantityProduced) errors.push("Conforme > Produit");
      if (lot.quantityProduced === 0) errors.push("Production nulle");
      if (Number(lot.cadenceUsed) <= 0) errors.push("Cadence absente");
      if (rejectRate > 0.05) warnings.push(`Taux de rebut élevé : ${(rejectRate * 100).toFixed(1)}%`);

      const dts = lotDowntimes[lot.id];
      const totalDowntimeMin = dts ? dts.reduce((s, d) => s + d.durationMinutes, 0) : null;
      const plannedMin = dts ? dts.filter(d => d.isPlanned).reduce((s, d) => s + d.durationMinutes, 0) : 0;
      const unplannedMin = dts ? dts.filter(d => !d.isPlanned).reduce((s, d) => s + d.durationMinutes, 0) : 0;
      const cadChanges = lotCadence[lot.id] ?? [];
      const lotDurationMin = lot.endedAt ? diffMinutes(lot.startedAt, lot.endedAt) : null;

      if (lotDurationMin !== null && totalDowntimeMin !== null && totalDowntimeMin > lotDurationMin) {
        errors.push(`Arrêts (${fmtMinutes(totalDowntimeMin)}) > durée du lot (${fmtMinutes(lotDurationMin)})`);
      }
      if (cadChanges.length > 0) {
        warnings.push(`Cadence modifiée ${cadChanges.length} fois en cours de lot — à vérifier`);
      }
      m.set(lot.id, { tq, errors, warnings, dts, totalDowntimeMin, plannedMin, unplannedMin, cadChanges, lotDurationMin });
    }
    return m;
  }, [lots, lotDowntimes, lotCadence]);

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
            aria-hidden="true"
            className={`h-5 w-5 transition-colors ${pullDistance >= PULL_THRESHOLD || refreshing ? "text-blue-600" : "text-blue-300"} ${refreshing ? "animate-spin" : ""}`}
            style={{ transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)` }}
          />
        </div>
      )}

      <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5" aria-hidden="true" /> Validation des lots
      </h2>

      {/* Status filter tabs */}
      <div role="tablist" aria-label="Filtre des lots" className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={statusFilter === tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
              statusFilter === tab.key
                ? "bg-white shadow text-gray-800"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {tab.key === statusFilter && !loading && lots.length > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                tab.key === "closed" ? "bg-blue-600 text-white" :
                tab.key === "validated" ? "bg-green-100 text-green-700" :
                "bg-red-100 text-red-700"
              }`}>{lots.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading && <ListSkeleton />}

      {!loading && lots.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          iconCls="text-green-400"
          title={statusFilter === "closed" ? "Aucun lot en attente" : `Aucun lot ${statusFilter === "validated" ? "validé" : "rejeté"}`}
          description={statusFilter === "closed" ? "Tous les lots ont été traités." : "Aucun lot dans cette catégorie."}
        />
      )}

      <div className="space-y-3">
        {lots.map(lot => {
          const product = productMap.get(lot.productId);
          const isExpanded = expanded === lot.id;
          const { tq, errors, warnings, dts, totalDowntimeMin, plannedMin, unplannedMin, cadChanges } = lotDerived.get(lot.id)!;
          const isCorrecting = correcting === lot.id;
          const isPending = lot.status === "closed";

          return (
            <div key={lot.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {/* Card header — always visible */}
              <button
                onClick={() => expandLot(lot.id)}
                aria-expanded={isExpanded}
                aria-controls={`lot-detail-${lot.id}`}
                aria-label={`${isExpanded ? "Réduire" : "Développer"} le lot ${lot.batchNumber}`}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">Lot {lot.batchNumber}</span>
                      {errors.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">
                          <AlertOctagon className="h-3 w-3" aria-hidden="true" />{errors.length}
                        </span>
                      )}
                      {warnings.length > 0 && (
                        <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">{warnings.length} alerte{warnings.length > 1 ? "s" : ""}</span>
                      )}
                      {lot.status === "closed" && (
                        <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-0.5"><Clock className="h-3 w-3" aria-hidden="true" />En attente</span>
                      )}
                      {lot.status === "validated" && (
                        <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-0.5"><Check className="h-3 w-3" aria-hidden="true" />Validé</span>
                      )}
                      {lot.status === "rejected" && (
                        <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-0.5"><X className="h-3 w-3" aria-hidden="true" />Rejeté</span>
                      )}
                    </div>
                    {/* Context: product · equipment · operator · date */}
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{product?.name ?? "—"} · Lot #{lot.lotOrder}</span>
                      {lot.endedAt && (
                        <span className="inline-flex items-center gap-0.5">
                          <Clock className="h-3 w-3" aria-hidden="true" />{fmtLotDuration(lot.startedAt, lot.endedAt)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5">
                        <Cpu className="h-3 w-3" aria-hidden="true" />{lot.equipmentCode}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <User className="h-3 w-3" aria-hidden="true" />{lot.operatorName}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <CalendarDays className="h-3 w-3" aria-hidden="true" />{fmtSessionDate(lot.sessionDate)}
                      </span>
                    </div>
                    <QualityBar tq={tq} />
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0 mt-1" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0 mt-1" aria-hidden="true" />}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div id={`lot-detail-${lot.id}`} className="border-t px-4 py-3 space-y-3">
                  {/* Session notes from operator end-of-shift */}
                  {lot.sessionNotes && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 flex items-start gap-2">
                      <span className="shrink-0">📝</span>
                      <span><span className="font-semibold text-gray-700">Note de poste (opérateur) : </span>{lot.sessionNotes}</span>
                    </div>
                  )}
                  {/* Quantities */}
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {[
                      { label: "Produit", value: lot.quantityProduced },
                      { label: "Conforme", value: lot.quantityConforming },
                      { label: "Rebut", value: lot.quantityRejected },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-50 rounded-lg p-2">
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="font-semibold text-base">{fmtNumber(value)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4 text-sm flex-wrap">
                    <span><span className="text-gray-500">Cadence:</span> {lot.cadenceUsed != null ? `${lot.cadenceUsed} ${lot.cadenceUnit ?? ""}` : "—"}</span>
                    {tq !== null && (
                      <span>
                        <span className="text-gray-500">TQ:</span>{" "}
                        <span style={{ color: trsColor(tq) }} className="font-semibold">{fmtPct(tq)}</span>
                      </span>
                    )}
                  </div>

                  {/* Cadence change history (audit) */}
                  {cadChanges.length > 0 && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                      <div className="text-xs font-semibold text-blue-800 mb-1">Cadence modifiée {cadChanges.length}×</div>
                      <div className="space-y-0.5">
                        {cadChanges.map(c => (
                          <div key={c.id} className="text-[11px] text-blue-700 flex items-center gap-1.5">
                            <span className="font-mono">{Number(c.oldCadence)} → {Number(c.newCadence)} {c.cadenceUnit}</span>
                            {c.reason && <span className="text-blue-400">· {c.reason}</span>}
                            <span className="text-blue-300 ml-auto">{new Date(c.changedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Downtime events */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Arrêts enregistrés
                      {totalDowntimeMin !== null && totalDowntimeMin > 0 && (
                        <span className="ml-1 font-normal text-gray-400">
                          — {fmtMinutes(totalDowntimeMin)} · <span className="text-amber-600">planifié {fmtMinutes(plannedMin)}</span> · <span className="text-red-600">non planifié {fmtMinutes(unplannedMin)}</span>
                        </span>
                      )}
                    </div>
                    {loadingDowntimesId === lot.id && (
                      <div className="space-y-1 py-1">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    )}
                    {lotDataFailed[lot.id] && (
                      <div role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        Données détaillées indisponibles — vérifiez votre connexion et réessayez.
                      </div>
                    )}
                    {dts && dts.length === 0 && !lotDataFailed[lot.id] && (
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
                            <span className="shrink-0 font-mono text-gray-500">{fmtMinutes(dt.durationMinutes)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Supervisor decision (validated/rejected) */}
                  {lot.supervisorComment && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                      <div className="text-xs font-semibold text-blue-800 mb-0.5">Décision superviseur</div>
                      <div className="text-xs text-blue-700">{lot.supervisorComment}</div>
                      {lot.validatedAt && (
                        <div className="text-[10px] text-blue-400 mt-0.5">
                          {new Date(lot.validatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Signed corrections (21 CFR Part 11 amendments) */}
                  {(lotSignatures[lot.id] ?? []).filter(s => s.action === "correct").map(sig => (
                    <div key={sig.id} className="bg-amber-50 border border-amber-100 rounded-lg p-2">
                      <div className="text-xs font-semibold text-amber-800 mb-0.5 flex items-center gap-1">
                        <Pencil className="h-3 w-3" aria-hidden="true" /> Correction signée — {sig.userName}
                      </div>
                      {sig.comment && <div className="text-xs text-amber-700">{sig.comment}</div>}
                      <div className="text-[10px] text-amber-400 mt-0.5">
                        {new Date(sig.signedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  ))}

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

                  {/* Actions — only for pending lots */}
                  {isPending && (
                    <>
                      {/* Inline correction form */}
                      {isCorrecting ? (() => {
                        const effProd = correctionData.qProd !== "" ? Number(correctionData.qProd) : lot.quantityProduced;
                        const effConf = correctionData.qConf !== "" ? Number(correctionData.qConf) : lot.quantityConforming;
                        const effRej  = correctionData.qRej  !== "" ? Number(correctionData.qRej)  : lot.quantityRejected;
                        const confErr = correctionData.qConf !== "" && effConf > effProd;
                        const rejErr  = correctionData.qRej  !== "" && effRej  > effProd;
                        const hasFormErr = confErr || rejErr;
                        return (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Correction des données
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { key: "qProd" as const, label: "Qté produite",  placeholder: String(lot.quantityProduced),    hasErr: false },
                              { key: "qConf" as const, label: "Qté conforme",  placeholder: String(lot.quantityConforming),  hasErr: confErr },
                              { key: "qRej"  as const, label: "Rebut",         placeholder: String(lot.quantityRejected),    hasErr: rejErr },
                            ].map(f => (
                              <div key={f.key}>
                                <label htmlFor={`corr-${f.key}-${lot.id}`} className={`block text-[10px] mb-0.5 ${f.hasErr ? "text-red-600 font-semibold" : "text-amber-700"}`}>{f.label}</label>
                                <input
                                  id={`corr-${f.key}-${lot.id}`}
                                  type="number" inputMode="numeric" min="0"
                                  value={correctionData[f.key]}
                                  placeholder={f.placeholder}
                                  aria-invalid={f.hasErr}
                                  onChange={e => setCorrectionData(prev => ({ ...prev, [f.key]: e.target.value }))}
                                  className={`w-full border rounded-lg px-2 py-1.5 text-sm bg-white ${f.hasErr ? "border-red-400 focus:ring-red-300" : "border-amber-300"}`}
                                />
                              </div>
                            ))}
                          </div>
                          {hasFormErr && (
                            <p className="text-xs text-red-600 font-medium">
                              {confErr && "Qté conforme ne peut pas dépasser Qté produite."}
                              {confErr && rejErr && " "}
                              {rejErr && "Rebut ne peut pas dépasser Qté produite."}
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label htmlFor={`corr-cadence-${lot.id}`} className="block text-[10px] text-amber-700 mb-0.5">Cadence</label>
                              <input
                                id={`corr-cadence-${lot.id}`}
                                type="number" inputMode="numeric" min="0"
                                value={correctionData.cadence}
                                placeholder={String(lot.cadenceUsed)}
                                onChange={e => setCorrectionData(prev => ({ ...prev, cadence: e.target.value }))}
                                className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label htmlFor={`corr-unit-${lot.id}`} className="block text-[10px] text-amber-700 mb-0.5">Unité</label>
                              <select
                                id={`corr-unit-${lot.id}`}
                                value={correctionData.cadenceUnit || lot.cadenceUnit}
                                onChange={e => setCorrectionData(prev => ({ ...prev, cadenceUnit: e.target.value }))}
                                className="w-full border border-amber-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                              >
                                <option value="u/min">u/min</option>
                                <option value="u/h">u/h</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label htmlFor={`corr-reason-${lot.id}`} className="block text-[10px] text-amber-700 mb-0.5">Raison de la correction <span className="text-red-500">*</span></label>
                            <input
                              id={`corr-reason-${lot.id}`}
                              value={correctionData.reason}
                              aria-required="true"
                              onChange={e => setCorrectionData(prev => ({ ...prev, reason: e.target.value }))}
                              placeholder="Ex : erreur de saisie opérateur — lot A confirmé 420 unités"
                              className={`w-full border rounded-lg px-2 py-1.5 text-sm bg-white ${!correctionData.reason.trim() ? "border-amber-400" : "border-amber-300"}`}
                            />
                          </div>
                          <div className="flex gap-2 justify-end pt-1">
                            <button onClick={() => setCorrecting(null)}
                              className="px-3 py-1.5 text-xs text-gray-600 border rounded-lg hover:bg-gray-50">
                              Annuler
                            </button>
                            <button
                              disabled={!correctionData.reason.trim() || hasFormErr}
                              onClick={() => openSign(lot.id, "correct")}
                              className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:pointer-events-none"
                            >
                              Signer la correction
                            </button>
                          </div>
                        </div>
                        );
                      })() : (
                        <button
                          onClick={() => {
                            setCorrecting(lot.id);
                            setCorrectionData({ qProd: "", qConf: "", qRej: "", cadence: "", cadenceUnit: lot.cadenceUnit, reason: "" });
                          }}
                          className="w-full flex items-center justify-center gap-1.5 text-sm border border-amber-300 text-amber-700 rounded-lg py-2 hover:bg-amber-50 transition"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Corriger les données
                        </button>
                      )}

                      <div>
                        <label htmlFor={`comment-${lot.id}`} className="block text-xs text-gray-500 mb-1">
                          Commentaire superviseur
                          {" "}<span className="text-red-400 text-[10px]">(obligatoire pour le rejet)</span>
                        </label>
                        <input
                          id={`comment-${lot.id}`}
                          value={comment}
                          onChange={e => { setComment(e.target.value); if (e.target.value.trim()) setCommentError(""); }}
                          aria-invalid={!!commentError}
                          className={`w-full border rounded-lg px-3 py-2 text-sm ${commentError ? "border-red-400" : ""}`}
                          placeholder="Observations, motif de rejet…"
                        />
                        {commentError && <p className="text-xs text-red-500 mt-0.5" role="alert">{commentError}</p>}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => openSign(lot.id, "validate")}
                          disabled={submitting || errors.length > 0}
                          aria-busy={submitting}
                          className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-green-700 transition disabled:opacity-40 disabled:pointer-events-none"
                        >
                          {submitting && pendingSign?.lotId === lot.id && pendingSign.action === "validate"
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Check className="h-4 w-4" aria-hidden="true" />}
                          Valider
                        </button>
                        <button
                          onClick={() => openSign(lot.id, "reject")}
                          disabled={submitting}
                          aria-busy={submitting}
                          className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-red-700 transition disabled:opacity-40 disabled:pointer-events-none"
                        >
                          {submitting && pendingSign?.lotId === lot.id && pendingSign.action === "reject"
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <X className="h-4 w-4" aria-hidden="true" />}
                          Rejeter
                        </button>
                      </div>
                      {errors.length > 0 && (
                        <p className="text-xs text-red-500 text-center">Résolvez les erreurs ou corrigez les données avant de valider.</p>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => setExpanded(null)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1 border-t mt-1"
                  >
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> Réduire
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 21 CFR Part 11 — electronic signature dialog */}
      {pendingSign && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { if (!submitting) setPendingSign(null); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !submitting) setPendingSign(null); }}
          role="presentation"
        >
          <div
            ref={signDialogRef}
            className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
              <h3 id="sign-dialog-title" className="font-semibold">Signature électronique</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              {pendingSign.action === "validate" ? "Validation du lot"
                : pendingSign.action === "reject" ? "Rejet du lot"
                : "Correction des données du lot"}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Conformément au 21 CFR Part 11, saisissez votre mot de passe pour signer cette décision. Votre nom et l'horodatage seront enregistrés de façon inaltérable.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              aria-label="Mot de passe de signature"
              value={signPassword}
              onChange={(e) => setSignPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && signPassword && !submitting) handleAction(pendingSign.lotId, pendingSign.action, signPassword); }}
              placeholder="Mot de passe"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-1"
            />
            <p className="text-[10px] text-gray-400 mb-3">Appuyez sur Entrée pour signer</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPendingSign(null)} disabled={submitting}
                className="px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Annuler</button>
              <button
                onClick={() => handleAction(pendingSign.lotId, pendingSign.action, signPassword)}
                disabled={submitting || !signPassword}
                aria-busy={submitting}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5 ${
                  pendingSign.action === "validate" ? "bg-green-600 hover:bg-green-700"
                  : pendingSign.action === "reject" ? "bg-red-600 hover:bg-red-700"
                  : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Signature…</> : "Signer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
