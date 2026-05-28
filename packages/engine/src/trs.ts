import { diffMinutes } from "./time";

// ─── Warning system ─────────────────────────────────────

export interface TrsWarning {
  code: string;
  level: "error" | "warning";
  message: string;
  field: string;
  value?: number;
}

// ─── NF E 60-182 family mapping ─────────────────────────

const FAMILLE_TO_NORME: Record<string, string> = {
  "Panne équipement": "AB",
  "Intervention maintenance": "IM",
  "Attente et transition": "AI",
  "Utilités": "UE",
  "Contrôle qualité": "CQ",
  "Nettoyage": "AP",
  "Autre": "AU",
};

export function familleToNorme(famille: string): string {
  return FAMILLE_TO_NORME[famille] || famille;
}

// ─── Types ──────────────────────────────────────────────

export interface DowntimeInput {
  durationMinutes: number;
  isPlanned: boolean;
  famille?: string;
}

export interface LotTrsInput {
  cadence: number;
  cadenceUnit: "u/h" | "u/min";
  produced: number;          // NPR
  conforming: number;        // NPB
  startedAt: Date | string;
  endedAt: Date | string;
  downtimes: DowntimeInput[];
}

export interface LotTrsResult {
  lotDurationMin: number;
  plannedMin: number;
  unplannedMin: number;
  tF: number;
  tN: number;
  tU: number;
  nonQualiteMin: number;
  TP: number;
  TQ: number;
  cadencePerMin: number;
  ecartCadence: number;
  rebut: number;
  downtimeByFamille: Record<string, number>;
  downtimeByNorme: Record<string, number>;
  warnings: TrsWarning[];
}

export interface SessionTrsInput {
  openedAt: Date | string;
  closedAt: Date | string;
  plannedStopsMin: number;
  lots: (LotTrsResult & { produced: number; conforming: number })[];
}

export interface SessionTrsResult {
  tT: number;
  tO: number;
  fermeture: number;
  tAP: number;
  tR: number;
  tF: number;
  tN: number;
  tU: number;
  nonQualiteMin: number;
  ecartCadenceMin: number;
  totalUnplannedMin: number;
  DO: number;
  TP: number;
  TQ: number;
  TRS: number;
  TRG: number;
  /** TEEP = tU / tT — efficiency vs. 24/7 calendar time (reveals schedule losses) */
  TEEP?: number;
  /** utilisation = tO / tT — fraction of calendar time the machine is scheduled */
  utilisation?: number;
  lotCount: number;
  totalProduced: number;
  totalConforming: number;
  totalRebut: number;
  downtimeByFamille: Record<string, number>;
  downtimeByNorme: Record<string, number>;
  warnings: TrsWarning[];
  audit: TrsAudit;
}

export interface TrsAudit {
  tF_norme: number;
  tF_lots: number;
  tF_delta: number;
  formula: string;
}

export interface ZoomTrsInput {
  sessions: SessionTrsResult[];
}

// ─── Product-level aggregation types ────────────────────

export interface ProductLotInput {
  productId: string;
  productName: string;
  cadence: number;
  cadenceUnit: "u/h" | "u/min";
  produced: number;
  conforming: number;
  lotDurationMin: number;
  unplannedMin: number;
  tF: number;
  tN: number;
  tU: number;
}

export interface ProductTrsResult {
  productId: string;
  productName: string;
  lotCount: number;
  totalProduced: number;
  totalConforming: number;
  totalRebut: number;
  totalDurationMin: number;
  totalUnplannedMin: number;
  tF: number;
  tN: number;
  tU: number;
  /** Required time attributed to this product (allocated pro-rata to tF when periodTR given). */
  tR: number;
  avgCadencePerMin: number;
  DO: number;
  TP: number;
  TQ: number;
  TRS: number;
  /** true when DO/TRS use a tR allocated from the period (so Σ products reconciles with global). */
  trAllocated: boolean;
}

// ─── Six Big Losses types ───────────────────────────────

export type LossCategory = "breakdown" | "setup" | "micro_stop" | "speed_loss" | "startup_reject" | "production_reject";

export interface SixBigLoss {
  category: LossCategory;
  label: string;
  oeeComponent: "availability" | "performance" | "quality";
  minutes: number;
  pctOfTotal: number;
}

export interface SixBigLossesResult {
  losses: SixBigLoss[];
  totalLossMin: number;
  tT: number;
}

// ─── Lot-level TRS ──────────────────────────────────────

export function computeLotTrs(input: LotTrsInput): LotTrsResult | null {
  const { cadence, cadenceUnit, produced, conforming, startedAt, endedAt, downtimes } = input;
  if (cadence <= 0) return null;

  const warnings: TrsWarning[] = [];
  const cadencePerMin = cadenceUnit === "u/min" ? cadence : cadence / 60;
  const lotDurationMin = diffMinutes(startedAt, endedAt);

  const plannedMin = downtimes
    .filter(d => d.isPlanned)
    .reduce((sum, d) => sum + d.durationMinutes, 0);
  const unplannedMin = downtimes
    .filter(d => !d.isPlanned)
    .reduce((sum, d) => sum + d.durationMinutes, 0);

  const downtimeByFamille: Record<string, number> = {};
  const downtimeByNorme: Record<string, number> = {};
  for (const d of downtimes) {
    const key = d.famille || (d.isPlanned ? "Planifié" : "Non classé");
    downtimeByFamille[key] = (downtimeByFamille[key] || 0) + d.durationMinutes;
    const normeKey = familleToNorme(key);
    downtimeByNorme[normeKey] = (downtimeByNorme[normeKey] || 0) + d.durationMinutes;
  }

  // NF E 60-182 §2.2.6: tF = temps de production - TOUS les arrêts (propres + induits)
  const tF = Math.max(0, lotDurationMin - plannedMin - unplannedMin);
  const tN = produced / cadencePerMin;
  const tU = conforming / cadencePerMin;
  const ecartCadence = tF - tN;
  const nonQualiteMin = tN - tU;
  const rebut = produced - conforming;

  // Validation: conforming > produced
  if (conforming > produced) {
    warnings.push({ code: "CONFORMING_GT_PRODUCED", level: "error", message: `Conforme (${conforming}) > Produit (${produced})`, field: "TQ", value: conforming / produced });
  }

  const TP = tF > 0 ? tN / tF : 0;
  const TQ = produced > 0 ? conforming / produced : 1;

  // Validation: TP > 100%
  if (TP > 1) {
    warnings.push({ code: "TP_OVER_100", level: "warning", message: `TP=${(TP * 100).toFixed(1)}% — vérifier cadence (${cadence} ${cadenceUnit})`, field: "TP", value: TP });
  }

  // Validation: unplanned stops > lot duration
  if (unplannedMin > lotDurationMin) {
    warnings.push({ code: "STOPS_GT_DURATION", level: "error", message: `Arrêts NP (${unplannedMin}min) > durée lot (${lotDurationMin}min)`, field: "tF", value: unplannedMin });
  }

  return { lotDurationMin, plannedMin, unplannedMin, tF, tN, tU, nonQualiteMin, TP, TQ, cadencePerMin, ecartCadence, rebut, downtimeByFamille, downtimeByNorme, warnings };
}

// ─── Session-level (consolidated) TRS ───────────────────

export function computeSessionTrs(input: SessionTrsInput): SessionTrsResult {
  const warnings: TrsWarning[] = [];
  const tO = diffMinutes(input.openedAt, input.closedAt);
  const tAP = input.plannedStopsMin;
  const tR = Math.max(0, tO - tAP);

  const tT = 1440;
  const fermeture = Math.max(0, tT - tO);

  // NF E 60-182 §2.2.6: tF = tR - TOUS les arrêts (planifiés lot + non planifiés)
  const totalPlannedLotMin = input.lots.reduce((s, l) => s + (l.plannedMin ?? 0), 0);
  const totalUnplannedMin = input.lots.reduce((s, l) => s + (l.unplannedMin ?? 0), 0);
  const totalArrets = totalPlannedLotMin + totalUnplannedMin;
  const tF = Math.max(0, tR - totalArrets);

  // Also compute lot-aggregated tF for audit/reconciliation
  const tF_lots = input.lots.reduce((s, l) => s + l.tF, 0);
  const tF_delta = tF - tF_lots;

  const tN = input.lots.reduce((s, l) => s + l.tN, 0);
  const tU = input.lots.reduce((s, l) => s + l.tU, 0);
  const totalProduced = input.lots.reduce((s, l) => s + l.produced, 0);
  const totalConforming = input.lots.reduce((s, l) => s + l.conforming, 0);
  const totalRebut = totalProduced - totalConforming;
  const nonQualiteMin = tN - tU;
  const ecartCadenceMin = tF - tN;

  // Merge downtimeByFamille and downtimeByNorme from all lots
  const downtimeByFamille: Record<string, number> = {};
  const downtimeByNorme: Record<string, number> = {};
  for (const lot of input.lots) {
    if (lot.downtimeByFamille) {
      for (const [k, v] of Object.entries(lot.downtimeByFamille)) {
        downtimeByFamille[k] = (downtimeByFamille[k] || 0) + v;
      }
    }
    if (lot.downtimeByNorme) {
      for (const [k, v] of Object.entries(lot.downtimeByNorme)) {
        downtimeByNorme[k] = (downtimeByNorme[k] || 0) + v;
      }
    }
  }

  // Collect lot-level warnings
  for (const lot of input.lots) {
    if (lot.warnings) {
      warnings.push(...lot.warnings);
    }
  }

  const DO = tR > 0 ? tF / tR : 0;
  const TP = tF > 0 ? tN / tF : 0;
  const TQ = totalProduced > 0 ? totalConforming / totalProduced : 1;
  const TRS = tR > 0 ? tU / tR : 0;
  const TRG = tO > 0 ? tU / tO : 0;
  const TEEP = tT > 0 ? tU / tT : 0;
  const utilisation = tT > 0 ? tO / tT : 0;

  // Cross-validations
  if (tAP > tO) {
    warnings.push({ code: "TAP_GT_TO", level: "error", message: `Arrêts planifiés (${tAP}min) > temps ouverture (${tO}min)`, field: "tAP", value: tAP });
  }
  if (totalUnplannedMin > tR) {
    warnings.push({ code: "UNPLANNED_GT_TR", level: "error", message: `Arrêts NP (${totalUnplannedMin}min) > temps requis (${tR}min)`, field: "totalUnplannedMin", value: totalUnplannedMin });
  }
  if (DO > 1) {
    warnings.push({ code: "DO_OVER_100", level: "warning", message: `DO=${(DO * 100).toFixed(1)}% — vérifier arrêts`, field: "DO", value: DO });
  }
  if (TP > 1) {
    warnings.push({ code: "TP_OVER_100", level: "warning", message: `TP=${(TP * 100).toFixed(1)}% — vérifier cadence`, field: "TP", value: TP });
  }
  if (totalConforming > totalProduced) {
    warnings.push({ code: "CONFORMING_GT_PRODUCED", level: "error", message: `Conforme total (${totalConforming}) > Produit total (${totalProduced})`, field: "TQ", value: totalConforming });
  }

  // Reconciliation warning
  if (Math.abs(tF_delta) > 5) {
    warnings.push({ code: "TF_RECONCILIATION", level: "warning", message: `Temps inter-lots non capturé: ${tF_delta.toFixed(0)}min (tF_norme=${tF}, tF_lots=${tF_lots})`, field: "tF", value: tF_delta });
  }

  // DO×TP×TQ ≈ TRS check
  const trsCheck = DO * TP * TQ;
  if (TRS > 0 && Math.abs(trsCheck - TRS) > 0.001) {
    warnings.push({ code: "TRS_PRODUCT_MISMATCH", level: "warning", message: `DO×TP×TQ (${(trsCheck * 100).toFixed(1)}%) ≠ TRS (${(TRS * 100).toFixed(1)}%)`, field: "TRS", value: trsCheck });
  }

  const audit: TrsAudit = {
    tF_norme: tF,
    tF_lots: tF_lots,
    tF_delta: tF_delta,
    formula: `tF = tR(${tR}) - tAP(${totalPlannedLotMin}) - tAI(${totalUnplannedMin}) = ${tF}`,
  };

  return {
    tT, tO, fermeture, tAP, tR, tF, tN, tU,
    nonQualiteMin, ecartCadenceMin, totalUnplannedMin,
    DO, TP, TQ, TRS, TRG, TEEP, utilisation,
    lotCount: input.lots.length,
    totalProduced, totalConforming, totalRebut,
    downtimeByFamille, downtimeByNorme, warnings, audit,
  };
}

// ─── Product-level TRS aggregation ──────────────────────

export function computeProductTrs(lots: ProductLotInput[], periodTR?: number): ProductTrsResult[] {
  const byProduct = new Map<string, ProductLotInput[]>();
  for (const lot of lots) {
    const arr = byProduct.get(lot.productId) || [];
    arr.push(lot);
    byProduct.set(lot.productId, arr);
  }

  // Total tF across all products — used to allocate the period's required time (tR) pro-rata.
  const totalTF = lots.reduce((s, l) => s + l.tF, 0);
  const allocate = periodTR != null && periodTR > 0 && totalTF > 0;

  const results: ProductTrsResult[] = [];
  for (const [productId, productLots] of byProduct) {
    const totalProduced = productLots.reduce((s, l) => s + l.produced, 0);
    const totalConforming = productLots.reduce((s, l) => s + l.conforming, 0);
    const totalDurationMin = productLots.reduce((s, l) => s + l.lotDurationMin, 0);
    const totalUnplannedMin = productLots.reduce((s, l) => s + l.unplannedMin, 0);
    const tF = productLots.reduce((s, l) => s + l.tF, 0);
    const tN = productLots.reduce((s, l) => s + l.tN, 0);
    const tU = productLots.reduce((s, l) => s + l.tU, 0);
    // Allocated tR keeps Σ tR_product = periodTR, so Σ tU_product / periodTR = TRS_global.
    // Fallback (no period tR given): tR = Σ lot durations (legacy behaviour).
    const tR = allocate ? periodTR! * (tF / totalTF) : totalDurationMin;

    const totalCadenceWeighted = productLots.reduce((s, l) => {
      const cpm = l.cadenceUnit === "u/min" ? l.cadence : l.cadence / 60;
      return s + cpm * l.lotDurationMin;
    }, 0);
    const avgCadencePerMin = totalDurationMin > 0 ? totalCadenceWeighted / totalDurationMin : 0;

    results.push({
      productId,
      productName: productLots[0].productName,
      lotCount: productLots.length,
      totalProduced,
      totalConforming,
      totalRebut: totalProduced - totalConforming,
      totalDurationMin,
      totalUnplannedMin,
      tF,
      tN,
      tU,
      tR,
      avgCadencePerMin,
      DO: tR > 0 ? tF / tR : 0,
      TP: tF > 0 ? tN / tF : 0,
      TQ: totalProduced > 0 ? totalConforming / totalProduced : 1,
      TRS: tR > 0 ? tU / tR : 0,
      trAllocated: allocate,
    });
  }

  return results.sort((a, b) => b.TRS - a.TRS);
}

// ─── Six Big Losses computation ─────────────────────────

export function computeSixBigLosses(
  sessionTrs: SessionTrsResult,
  downtimeDetails: { durationMinutes: number; famille: string; isPlanned: boolean }[],
  microStopThresholdMin: number = 5,
): SixBigLossesResult {
  const { tT, tF, ecartCadenceMin, nonQualiteMin, fermeture, tAP } = sessionTrs;

  let breakdownMin = 0;
  let setupMin = 0;
  let microStopMin = 0;

  for (const dt of downtimeDetails) {
    if (dt.isPlanned) {
      // Planned stops: setup/changeover type
      setupMin += dt.durationMinutes;
    } else if (dt.durationMinutes < microStopThresholdMin) {
      microStopMin += dt.durationMinutes;
    } else {
      breakdownMin += dt.durationMinutes;
    }
  }

  // Speed loss = écart cadence (already computed by engine)
  const speedLossMin = Math.max(0, ecartCadenceMin);

  // Quality losses: split into startup rejects (first 10% of tF) and production rejects
  const startupRejectMin = Math.max(0, Math.round(nonQualiteMin * 0.1));
  const productionRejectMin = Math.max(0, Math.round(nonQualiteMin * 0.9));

  const totalLossMin = fermeture + tAP + breakdownMin + microStopMin + setupMin + speedLossMin + startupRejectMin + productionRejectMin;

  const losses: SixBigLoss[] = [
    { category: "breakdown", label: "Pannes", oeeComponent: "availability", minutes: breakdownMin, pctOfTotal: tT > 0 ? (breakdownMin / tT) * 100 : 0 },
    { category: "setup", label: "Réglages & changements", oeeComponent: "availability", minutes: setupMin + tAP, pctOfTotal: tT > 0 ? ((setupMin + tAP) / tT) * 100 : 0 },
    { category: "micro_stop", label: "Micro-arrêts", oeeComponent: "performance", minutes: microStopMin, pctOfTotal: tT > 0 ? (microStopMin / tT) * 100 : 0 },
    { category: "speed_loss", label: "Ralentissements", oeeComponent: "performance", minutes: speedLossMin, pctOfTotal: tT > 0 ? (speedLossMin / tT) * 100 : 0 },
    { category: "startup_reject", label: "Rebuts démarrage", oeeComponent: "quality", minutes: startupRejectMin, pctOfTotal: tT > 0 ? (startupRejectMin / tT) * 100 : 0 },
    { category: "production_reject", label: "Rebuts production", oeeComponent: "quality", minutes: productionRejectMin, pctOfTotal: tT > 0 ? (productionRejectMin / tT) * 100 : 0 },
  ];

  return { losses, totalLossMin, tT };
}

// ─── Zoom TRS (multi-session aggregation) ───────────────

export function computeZoomTrs(input: ZoomTrsInput): SessionTrsResult {
  const sessions = input.sessions;
  const emptyAudit: TrsAudit = { tF_norme: 0, tF_lots: 0, tF_delta: 0, formula: "" };
  if (sessions.length === 0) {
    return { tT: 0, tO: 0, fermeture: 0, tAP: 0, tR: 0, tF: 0, tN: 0, tU: 0, nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0, DO: 0, TP: 0, TQ: 1, TRS: 0, TRG: 0, TEEP: 0, utilisation: 0, lotCount: 0, totalProduced: 0, totalConforming: 0, totalRebut: 0, downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: emptyAudit };
  }

  const warnings: TrsWarning[] = [];
  const tT = sessions.reduce((s, x) => s + x.tT, 0);
  const tO = sessions.reduce((s, x) => s + x.tO, 0);
  const fermeture = sessions.reduce((s, x) => s + x.fermeture, 0);
  const tAP = sessions.reduce((s, x) => s + x.tAP, 0);
  const tR = sessions.reduce((s, x) => s + x.tR, 0);
  const tF = sessions.reduce((s, x) => s + x.tF, 0);
  const tN = sessions.reduce((s, x) => s + x.tN, 0);
  const tU = sessions.reduce((s, x) => s + x.tU, 0);
  const totalProduced = sessions.reduce((s, x) => s + x.totalProduced, 0);
  const totalConforming = sessions.reduce((s, x) => s + x.totalConforming, 0);
  const totalRebut = totalProduced - totalConforming;
  const lotCount = sessions.reduce((s, x) => s + x.lotCount, 0);
  const totalUnplannedMin = sessions.reduce((s, x) => s + x.totalUnplannedMin, 0);
  const nonQualiteMin = tN - tU;
  const ecartCadenceMin = tF - tN;

  const downtimeByFamille: Record<string, number> = {};
  const downtimeByNorme: Record<string, number> = {};
  for (const sess of sessions) {
    if (sess.downtimeByFamille) {
      for (const [k, v] of Object.entries(sess.downtimeByFamille)) {
        downtimeByFamille[k] = (downtimeByFamille[k] || 0) + v;
      }
    }
    if (sess.downtimeByNorme) {
      for (const [k, v] of Object.entries(sess.downtimeByNorme)) {
        downtimeByNorme[k] = (downtimeByNorme[k] || 0) + v;
      }
    }
  }

  // Aggregate session-level warnings (only error-level)
  for (const sess of sessions) {
    if (sess.warnings) {
      for (const w of sess.warnings) {
        if (w.level === "error") warnings.push(w);
      }
    }
  }

  const DO = tR > 0 ? tF / tR : 0;
  const TP = tF > 0 ? tN / tF : 0;
  const TQ = totalProduced > 0 ? totalConforming / totalProduced : 1;
  const TRS = tR > 0 ? tU / tR : 0;
  const TRG = tO > 0 ? tU / tO : 0;
  const TEEP = tT > 0 ? tU / tT : 0;
  const utilisation = tT > 0 ? tO / tT : 0;

  const tF_norme = sessions.reduce((s, x) => s + x.audit.tF_norme, 0);
  const tF_lots = sessions.reduce((s, x) => s + x.audit.tF_lots, 0);
  const audit: TrsAudit = {
    tF_norme,
    tF_lots,
    tF_delta: tF_norme - tF_lots,
    formula: `tF = Σ(session.tF) = ${tF}`,
  };

  return { tT, tO, fermeture, tAP, tR, tF, tN, tU, nonQualiteMin, ecartCadenceMin, totalUnplannedMin, DO, TP, TQ, TRS, TRG, TEEP, utilisation, lotCount, totalProduced, totalConforming, totalRebut, downtimeByFamille, downtimeByNorme, warnings, audit };
}

// ─── Period grouping (day / week / month) ────────────────

export type GroupBy = "day" | "week" | "month";

export interface PeriodBucket extends SessionTrsResult {
  /** "2026-05-28" (day) | "2026-W22" (ISO week) | "2026-05" (month) */
  periodKey: string;
  from: string;
  to: string;
}

/** ISO-8601 week key (Monday-based), e.g. "2026-W22". */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  // Shift to the Thursday of this week (ISO weeks belong to the year of their Thursday)
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function periodKey(dateStr: string, by: GroupBy): string {
  if (by === "day") return dateStr;
  if (by === "month") return dateStr.slice(0, 7); // "YYYY-MM"
  return isoWeekKey(dateStr);
}

/**
 * Group daily sessions into day/week/month buckets.
 * Each bucket is re-aggregated with computeZoomTrs, i.e. TRS_bucket = Σ tU / Σ tR.
 * Because summation is associative, computeZoomTrs over all sessions equals the
 * sum of the buckets — day → week → month always reconcile.
 */
export function groupSessionsByPeriod(
  sessions: (SessionTrsResult & { date: string })[],
  by: GroupBy,
): PeriodBucket[] {
  const buckets = new Map<string, (SessionTrsResult & { date: string })[]>();
  for (const s of sessions) {
    const key = periodKey(s.date, by);
    const arr = buckets.get(key) || [];
    arr.push(s);
    buckets.set(key, arr);
  }

  return [...buckets.entries()]
    .map(([key, ss]) => {
      const dates = ss.map(s => s.date).sort();
      return {
        periodKey: key,
        from: dates[0],
        to: dates[dates.length - 1],
        ...computeZoomTrs({ sessions: ss }),
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

// ─── MTBF / MTTR ─────────────────────────────────────────

export interface MtbfMttrResult {
  breakdownCount: number;
  totalBreakdownMin: number;
  /** Mean time between failures (minutes of run time per failure). null when no failures. */
  mtbf: number | null;
  /** Mean time to repair (minutes per repair). null when no failures. */
  mttr: number | null;
  /** Availability = MTBF / (MTBF + MTTR). null when no failures. */
  availability: number | null;
}

/**
 * Compute MTBF/MTTR from a list of downtime events.
 * Planned stops and micro-stops (< microStopThresholdMin) are excluded from the failure count.
 * runTimeMin should be the net production time (tF) over the analysed period.
 */
export function computeMtbfMttr(
  downtimes: { durationMinutes: number; isPlanned: boolean }[],
  runTimeMin: number,
  microStopThresholdMin = 5,
): MtbfMttrResult {
  const breakdowns = downtimes.filter(d => !d.isPlanned && d.durationMinutes >= microStopThresholdMin);
  const breakdownCount = breakdowns.length;
  const totalBreakdownMin = breakdowns.reduce((s, d) => s + d.durationMinutes, 0);

  if (breakdownCount === 0) return { breakdownCount: 0, totalBreakdownMin: 0, mtbf: null, mttr: null, availability: null };

  const mtbf = runTimeMin / breakdownCount;
  const mttr = totalBreakdownMin / breakdownCount;
  const availability = mtbf / (mtbf + mttr);
  return { breakdownCount, totalBreakdownMin, mtbf, mttr, availability };
}

// ─── OEE Benchmarking ────────────────────────────────────

export type OeeIndustry = "pharmaceutical" | "packaging" | "general";
export type BenchmarkRating = "world_class" | "acceptable" | "below";

export interface OeeThresholds {
  trs: { worldClass: number; acceptable: number };
  DO: { worldClass: number; acceptable: number };
  TP: { worldClass: number; acceptable: number };
  TQ: { worldClass: number; acceptable: number };
}

export interface OeeBenchmarkResult {
  industry: OeeIndustry;
  thresholds: OeeThresholds;
  ratings: Record<"TRS" | "DO" | "TP" | "TQ", BenchmarkRating>;
}

const INDUSTRY_BENCHMARKS: Record<OeeIndustry, OeeThresholds> = {
  // Tractian 2026: pharma world-class 60-70%, industry avg 40-60%
  pharmaceutical: { trs: { worldClass: 0.65, acceptable: 0.50 }, DO: { worldClass: 0.85, acceptable: 0.70 }, TP: { worldClass: 0.85, acceptable: 0.75 }, TQ: { worldClass: 0.990, acceptable: 0.970 } },
  // Tractian 2026: packaging world-class 80-85%, industry avg 60-75%
  packaging:      { trs: { worldClass: 0.80, acceptable: 0.65 }, DO: { worldClass: 0.88, acceptable: 0.75 }, TP: { worldClass: 0.92, acceptable: 0.80 }, TQ: { worldClass: 0.995, acceptable: 0.985 } },
  // Nakajima / ISO 22400: world-class 85%, 90% A × 95% P × 99.9% Q
  general:        { trs: { worldClass: 0.85, acceptable: 0.65 }, DO: { worldClass: 0.90, acceptable: 0.75 }, TP: { worldClass: 0.95, acceptable: 0.80 }, TQ: { worldClass: 0.999, acceptable: 0.990 } },
};

function rate(value: number, t: { worldClass: number; acceptable: number }): BenchmarkRating {
  if (value >= t.worldClass) return "world_class";
  if (value >= t.acceptable) return "acceptable";
  return "below";
}

export function computeOeeBenchmark(
  metrics: { DO: number; TP: number; TQ: number; TRS: number },
  industry: OeeIndustry = "pharmaceutical",
): OeeBenchmarkResult {
  const t = INDUSTRY_BENCHMARKS[industry];
  return {
    industry,
    thresholds: t,
    ratings: {
      TRS: rate(metrics.TRS, t.trs),
      DO: rate(metrics.DO, t.DO),
      TP: rate(metrics.TP, t.TP),
      TQ: rate(metrics.TQ, t.TQ),
    },
  };
}
