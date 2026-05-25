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

  const tF = Math.max(0, lotDurationMin - unplannedMin);
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

  // NF E 60-182: tF = tR - Σ(arrêts NP) at session level
  const totalUnplannedMin = input.lots.reduce((s, l) => s + (l.unplannedMin ?? 0), 0);
  const tF = Math.max(0, tR - totalUnplannedMin);

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
    formula: `tF = tR(${tR}) - tAI(${totalUnplannedMin}) = ${tF}`,
  };

  return {
    tT, tO, fermeture, tAP, tR, tF, tN, tU,
    nonQualiteMin, ecartCadenceMin, totalUnplannedMin,
    DO, TP, TQ, TRS, TRG,
    lotCount: input.lots.length,
    totalProduced, totalConforming, totalRebut,
    downtimeByFamille, downtimeByNorme, warnings, audit,
  };
}

// ─── Zoom TRS (multi-session aggregation) ───────────────

export function computeZoomTrs(input: ZoomTrsInput): SessionTrsResult {
  const sessions = input.sessions;
  const emptyAudit: TrsAudit = { tF_norme: 0, tF_lots: 0, tF_delta: 0, formula: "" };
  if (sessions.length === 0) {
    return { tT: 0, tO: 0, fermeture: 0, tAP: 0, tR: 0, tF: 0, tN: 0, tU: 0, nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0, DO: 0, TP: 0, TQ: 1, TRS: 0, TRG: 0, lotCount: 0, totalProduced: 0, totalConforming: 0, totalRebut: 0, downtimeByFamille: {}, downtimeByNorme: {}, warnings: [], audit: emptyAudit };
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

  const tF_norme = sessions.reduce((s, x) => s + x.audit.tF_norme, 0);
  const tF_lots = sessions.reduce((s, x) => s + x.audit.tF_lots, 0);
  const audit: TrsAudit = {
    tF_norme,
    tF_lots,
    tF_delta: tF_norme - tF_lots,
    formula: `tF = Σ(session.tF) = ${tF}`,
  };

  return { tT, tO, fermeture, tAP, tR, tF, tN, tU, nonQualiteMin, ecartCadenceMin, totalUnplannedMin, DO, TP, TQ, TRS, TRG, lotCount, totalProduced, totalConforming, totalRebut, downtimeByFamille, downtimeByNorme, warnings, audit };
}
