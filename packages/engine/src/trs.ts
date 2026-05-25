import { diffMinutes } from "./time";

// ─── Types ──────────────────────────────────────────────

export interface DowntimeInput {
  durationMinutes: number;
  isPlanned: boolean;
  famille?: string;         // Famille d'arrêt (Panne équipement, Attente matière, etc.)
}

export interface LotTrsInput {
  cadence: number;          // Operator-entered cadence
  cadenceUnit: "u/h" | "u/min";
  produced: number;         // NPR (quantité réalisée)
  conforming: number;       // NPB (quantité bonne)
  startedAt: Date | string;
  endedAt: Date | string;
  downtimes: DowntimeInput[];
}

export interface LotTrsResult {
  /** Lot duration in minutes (endedAt - startedAt) */
  lotDurationMin: number;
  /** Planned downtime total within lot (min) */
  plannedMin: number;
  /** Unplanned downtime total (min) */
  unplannedMin: number;
  /** tF = lot duration - unplanned stops */
  tF: number;
  /** tN = produced / cadence (min) */
  tN: number;
  /** tU = conforming / cadence (min) */
  tU: number;
  /** Non-quality time loss = tN - tU (min) */
  nonQualiteMin: number;
  /** Performance = tN / tF */
  TP: number;
  /** Quality = conforming / produced */
  TQ: number;
  /** Cadence in pieces/min used for calculation */
  cadencePerMin: number;
  /** Cadence deviation: actual vs theoretical (min) */
  ecartCadence: number;
  /** Rejected quantity (produced - conforming) */
  rebut: number;
  /** Downtime broken down by famille (key=famille, value=minutes) */
  downtimeByFamille: Record<string, number>;
}

export interface SessionTrsInput {
  openedAt: Date | string;
  closedAt: Date | string;
  /** Planned stops at session level (nettoyage, vide_ligne, pause, chsb, etc.) */
  plannedStopsMin: number;
  /** Results of each lot in the session */
  lots: (LotTrsResult & { produced: number; conforming: number })[];
}

export interface SessionTrsResult {
  /** tT: total calendar time (1440 min = 24h per day) */
  tT: number;
  /** tO: total opening time (closedAt - openedAt) */
  tO: number;
  /** Fermeture = tT - tO */
  fermeture: number;
  /** tAP: total planned stops (session-level) */
  tAP: number;
  /** tR = tO - tAP (required time) */
  tR: number;
  /** tF: sum of lot tF */
  tF: number;
  /** tN: sum of lot tN */
  tN: number;
  /** tU: sum of lot tU */
  tU: number;
  /** Non-quality time loss = tN - tU (min) */
  nonQualiteMin: number;
  /** Cadence deviation = tF - tN (min) */
  ecartCadenceMin: number;
  /** Unplanned downtime total across lots (min) */
  totalUnplannedMin: number;
  /** Disponibilité = tF / tR */
  DO: number;
  /** Performance = tN / tF */
  TP: number;
  /** Qualité = conforming / produced */
  TQ: number;
  /** TRS = tU / tR = DO × TP × TQ */
  TRS: number;
  /** TRG = tU / tO */
  TRG: number;
  /** Number of lots */
  lotCount: number;
  /** Total produced */
  totalProduced: number;
  /** Total conforming */
  totalConforming: number;
  /** Total rejected */
  totalRebut: number;
  /** Downtime aggregated by famille across all lots */
  downtimeByFamille: Record<string, number>;
}

export interface ZoomTrsInput {
  sessions: SessionTrsResult[];
}

// ─── Lot-level TRS ──────────────────────────────────────

/**
 * Compute TRS metrics for a single lot.
 * Returns null if cadence ≤ 0 (TRS guard).
 */
export function computeLotTrs(input: LotTrsInput): LotTrsResult | null {
  const { cadence, cadenceUnit, produced, conforming, startedAt, endedAt, downtimes } = input;
  if (cadence <= 0) return null;

  const cadencePerMin = cadenceUnit === "u/min" ? cadence : cadence / 60;
  const lotDurationMin = diffMinutes(startedAt, endedAt);

  const plannedMin = downtimes
    .filter(d => d.isPlanned)
    .reduce((sum, d) => sum + d.durationMinutes, 0);
  const unplannedMin = downtimes
    .filter(d => !d.isPlanned)
    .reduce((sum, d) => sum + d.durationMinutes, 0);

  // Build downtime by famille
  const downtimeByFamille: Record<string, number> = {};
  for (const d of downtimes) {
    const key = d.famille || (d.isPlanned ? "Planifié" : "Non classé");
    downtimeByFamille[key] = (downtimeByFamille[key] || 0) + d.durationMinutes;
  }

  const tF = Math.max(0, lotDurationMin - unplannedMin);
  const tN = produced / cadencePerMin;
  const tU = conforming / cadencePerMin;
  const ecartCadence = tF - tN;
  const nonQualiteMin = tN - tU;
  const rebut = produced - conforming;

  const TP = tF > 0 ? Math.min(1, tN / tF) : 0;
  const TQ = produced > 0 ? Math.min(1, conforming / produced) : 1;

  return { lotDurationMin, plannedMin, unplannedMin, tF, tN, tU, nonQualiteMin, TP, TQ, cadencePerMin, ecartCadence, rebut, downtimeByFamille };
}

// ─── Session-level (consolidated) TRS ───────────────────

/**
 * Compute consolidated TRS for a session (day / compteur).
 * Aggregates all lot results + session-level planned stops.
 */
export function computeSessionTrs(input: SessionTrsInput): SessionTrsResult {
  const tO = diffMinutes(input.openedAt, input.closedAt);
  const tAP = input.plannedStopsMin;
  const tR = Math.max(0, tO - tAP);

  const tT = 1440; // 24h per day
  const fermeture = Math.max(0, tT - tO);

  const tF = input.lots.reduce((s, l) => s + l.tF, 0);
  const tN = input.lots.reduce((s, l) => s + l.tN, 0);
  const tU = input.lots.reduce((s, l) => s + l.tU, 0);
  const totalProduced = input.lots.reduce((s, l) => s + l.produced, 0);
  const totalConforming = input.lots.reduce((s, l) => s + l.conforming, 0);
  const totalRebut = totalProduced - totalConforming;
  const totalUnplannedMin = input.lots.reduce((s, l) => s + (l.unplannedMin ?? 0), 0);
  const nonQualiteMin = tN - tU;
  const ecartCadenceMin = tF - tN;

  // Merge downtimeByFamille from all lots
  const downtimeByFamille: Record<string, number> = {};
  for (const lot of input.lots) {
    if (lot.downtimeByFamille) {
      for (const [k, v] of Object.entries(lot.downtimeByFamille)) {
        downtimeByFamille[k] = (downtimeByFamille[k] || 0) + v;
      }
    }
  }

  const DO = tR > 0 ? Math.min(1, tF / tR) : 0;
  const TP = tF > 0 ? Math.min(1, tN / tF) : 0;
  const TQ = totalProduced > 0 ? Math.min(1, totalConforming / totalProduced) : 1;
  const TRS = tR > 0 ? Math.min(1, tU / tR) : 0;
  const TRG = tO > 0 ? Math.min(1, tU / tO) : 0;

  return {
    tT, tO, fermeture, tAP, tR, tF, tN, tU,
    nonQualiteMin, ecartCadenceMin, totalUnplannedMin,
    DO, TP, TQ, TRS, TRG,
    lotCount: input.lots.length,
    totalProduced, totalConforming, totalRebut,
    downtimeByFamille,
  };
}

// ─── Zoom TRS (multi-session aggregation) ───────────────

/**
 * Aggregate TRS across multiple sessions (week, month, custom range).
 */
export function computeZoomTrs(input: ZoomTrsInput): SessionTrsResult {
  const sessions = input.sessions;
  if (sessions.length === 0) {
    return { tT: 0, tO: 0, fermeture: 0, tAP: 0, tR: 0, tF: 0, tN: 0, tU: 0, nonQualiteMin: 0, ecartCadenceMin: 0, totalUnplannedMin: 0, DO: 0, TP: 0, TQ: 1, TRS: 0, TRG: 0, lotCount: 0, totalProduced: 0, totalConforming: 0, totalRebut: 0, downtimeByFamille: {} };
  }

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

  // Merge downtimeByFamille from all sessions
  const downtimeByFamille: Record<string, number> = {};
  for (const sess of sessions) {
    if (sess.downtimeByFamille) {
      for (const [k, v] of Object.entries(sess.downtimeByFamille)) {
        downtimeByFamille[k] = (downtimeByFamille[k] || 0) + v;
      }
    }
  }

  const DO = tR > 0 ? Math.min(1, tF / tR) : 0;
  const TP = tF > 0 ? Math.min(1, tN / tF) : 0;
  const TQ = totalProduced > 0 ? Math.min(1, totalConforming / totalProduced) : 1;
  const TRS = tR > 0 ? Math.min(1, tU / tR) : 0;
  const TRG = tO > 0 ? Math.min(1, tU / tO) : 0;

  return { tT, tO, fermeture, tAP, tR, tF, tN, tU, nonQualiteMin, ecartCadenceMin, totalUnplannedMin, DO, TP, TQ, TRS, TRG, lotCount, totalProduced, totalConforming, totalRebut, downtimeByFamille };
}
