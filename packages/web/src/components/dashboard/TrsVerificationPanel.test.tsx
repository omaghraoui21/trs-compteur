import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TrsVerificationPanel from "./TrsVerificationPanel";
import type { TrsMetrics } from "@/lib/api";

// A self-consistent single-product 8h shift (decomposition is exact):
//   tR=440 tF=410 tN=270 tU=261 → DO=0.9318 TP=0.6585 TQ=0.9667
//   TRS=tU/tR=0.593  TRG=tU/tO=0.5438  TEEP=tU/tT=0.1813
function consistentMetrics(overrides: Partial<TrsMetrics> = {}): TrsMetrics {
  const tU = 261, tN = 270, tF = 410, tR = 440, tO = 480, tT = 1440;
  return {
    tT, tO, fermeture: tT - tO, tAP: tO - tR, tR, tF, tN, tU,
    nonQualiteMin: tN - tU, ecartCadenceMin: tF - tN, totalUnplannedMin: 30,
    DO: tF / tR, TP: tN / tF, TQ: tU / tN, TRS: tU / tR, TRG: tU / tO,
    TEEP: tU / tT, utilisation: tO / tT,
    lotCount: 1, totalProduced: 27000, totalConforming: 26100, totalRebut: 900,
    downtimeByFamille: {}, downtimeByNorme: {}, warnings: [],
    ...overrides,
  };
}

describe("TrsVerificationPanel", () => {
  it("renders a 'Cohérent' badge when all NF E 60-182 identities hold", () => {
    render(<TrsVerificationPanel metrics={consistentMetrics()} />);
    expect(screen.getByText(/Vérification TRS/i)).toBeInTheDocument();
    expect(screen.getByText(/Cohérent/i)).toBeInTheDocument();
    // measured and calculated TRS both shown
    expect(screen.getByText("TRS mesuré")).toBeInTheDocument();
    expect(screen.getByText("TRS calculé")).toBeInTheDocument();
    // 59.3% appears for both measured (tU/tR) and calculated (DO·TP·TQ)
    expect(screen.getAllByText("59.3%").length).toBeGreaterThanOrEqual(2);
  });

  it("flags 'À vérifier' when the rate hierarchy is violated", () => {
    // TRG > TRS breaks TEEP ≤ TRG ≤ TRS and TRG=tU/tO
    render(<TrsVerificationPanel metrics={consistentMetrics({ TRG: 0.9 })} />);
    expect(screen.getByText(/À vérifier/i)).toBeInTheDocument();
  });

  it("surfaces engine error-level warnings as audit flags", () => {
    const metrics = consistentMetrics({
      warnings: [
        { code: "TAP_GT_TO", level: "error", message: "Arrêts planifiés > temps ouverture", field: "tAP" },
      ],
    });
    render(<TrsVerificationPanel metrics={metrics} />);
    expect(screen.getByText(/Arrêts planifiés > temps ouverture/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no required time (tR = 0)", () => {
    const { container } = render(<TrsVerificationPanel metrics={consistentMetrics({ tR: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
