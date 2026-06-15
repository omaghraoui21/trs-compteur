import { fmtPct, fmtDuration } from "@trs/engine";
import type { TrsMetrics } from "@/lib/api";
import { ShieldCheck, Check, AlertTriangle } from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// TRS Verification panel — audits the displayed values against NF E 60-182.
// Shows TRS *measured* (tU/tR) vs *calculated* (DO·TP·TQ), the TRG/TEEP
// definitions, and the cascade ordering — each as a pass/fail check so a
// supervisor (or auditor) can confirm the numbers are self-consistent.
// ════════════════════════════════════════════════════════════════════

interface Props {
  metrics: TrsMetrics;
}

interface Check {
  label: string;
  formula: string;
  ok: boolean;
  detail: string;
}

// A relative tolerance: piece-count TQ vs cadence-weighted times makes the
// 3-factor product diverge slightly when products of different cadences are
// mixed. Within 1pp we treat the decomposition as reconciled.
const DECOMP_TOL = 0.01;

function approx(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

export default function TrsVerificationPanel({ metrics }: Props) {
  const { tT, tO, tR, tF, tN, tU, DO, TP, TQ, TRS, TRG, TEEP } = metrics;
  if (tR <= 0) return null;

  const trsMeasured = tU / tR;            // canonical NF E 60-182 definition
  const trsCalculated = DO * TP * TQ;     // three-factor decomposition
  const decompDelta = trsMeasured - trsCalculated;
  const decompOk = Math.abs(decompDelta) <= DECOMP_TOL;

  const checks: Check[] = [
    {
      label: "TRS mesuré = tU / tR",
      formula: "TRS = tU / tR",
      ok: approx(TRS, trsMeasured),
      detail: `${fmtPct(TRS)} = ${fmtDuration(tU)} / ${fmtDuration(tR)}`,
    },
    {
      label: "TRS = DO × TP × TQ",
      formula: "décomposition",
      ok: decompOk,
      detail: `mesuré ${fmtPct(trsMeasured)} · calculé ${fmtPct(trsCalculated)} · Δ ${(decompDelta * 100).toFixed(2)} pt`,
    },
    {
      label: "TRG = tU / tO",
      formula: "TRG global",
      ok: tO > 0 && approx(TRG, tU / tO),
      detail: `${fmtPct(TRG)} = ${fmtDuration(tU)} / ${fmtDuration(tO)}`,
    },
    {
      label: "TRG = TRS × (tR / tO)",
      formula: "perte planifiée",
      ok: tO > 0 && approx(TRG, TRS * (tR / tO), 1e-4),
      detail: `${fmtPct(TRG)} = ${fmtPct(TRS)} × ${fmtPct(tR / tO)}`,
    },
    {
      label: "TEEP = tU / tT",
      formula: "TEEP calendaire",
      ok: tT > 0 && approx(TEEP ?? 0, tU / tT, 1e-4),
      detail: `${fmtPct(TEEP ?? 0)} = ${fmtDuration(tU)} / ${fmtDuration(tT)}`,
    },
    {
      label: "Cascade tU ≤ tN ≤ tF ≤ tR ≤ tO ≤ tT",
      formula: "ordre temporel",
      ok: tU <= tN + 0.5 && tN <= tF + 0.5 && tF <= tR + 0.5 && tR <= tO + 0.5 && tO <= tT + 0.5,
      detail: [tU, tN, tF, tR, tO, tT].map(v => fmtDuration(Math.round(v))).join(" ≤ "),
    },
    {
      label: "TEEP ≤ TRG ≤ TRS",
      formula: "hiérarchie des taux",
      ok: (TEEP ?? 0) <= TRG + 1e-6 && TRG <= TRS + 1e-6,
      detail: `${fmtPct(TEEP ?? 0)} ≤ ${fmtPct(TRG)} ≤ ${fmtPct(TRS)}`,
    },
  ];

  const allOk = checks.every(c => c.ok);
  const errorWarnings = (metrics.warnings ?? []).filter(w => w.level === "error");

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 mb-4" role="region" aria-label="Vérification TRS NF E 60-182">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden="true" /> Vérification TRS (NF E 60-182)
        </h3>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${allOk ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {allOk ? <><Check className="h-3.5 w-3.5" aria-hidden="true" /> Cohérent</> : <><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> À vérifier</>}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3">Contrôle croisé des valeurs calculées et mesurées.</p>

      {/* Headline: measured vs calculated TRS */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">TRS mesuré</div>
          <div className="text-2xl font-bold text-gray-800">{fmtPct(trsMeasured)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">tU / tR</div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">TRS calculé</div>
          <div className="text-2xl font-bold text-gray-800">{fmtPct(trsCalculated)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">DO × TP × TQ</div>
        </div>
      </div>

      {/* Check list */}
      <ul className="space-y-1.5">
        {checks.map(c => (
          <li key={c.label} className="flex items-start gap-2 text-xs">
            {c.ok
              ? <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" aria-label="Vérifié" />
              : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-label="À vérifier" />}
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-700">{c.label}</span>
              <span className="text-gray-400 ml-1 font-mono">{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>

      {!decompOk && (
        <p className="text-[11px] text-gray-400 mt-2 leading-snug">
          L'écart DO×TP×TQ provient du mélange de produits à cadences différentes :
          la qualité est comptée en pièces (Σconf/Σprod) tandis que les temps sont
          pondérés par la cadence. Le TRS de référence reste tU/tR.
        </p>
      )}

      {errorWarnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-2 space-y-1">
          {errorWarnings.map((w, i) => (
            <div key={i} className="text-[11px] text-red-700 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" /> {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
