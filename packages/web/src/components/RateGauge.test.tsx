import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RateGauge } from "./RateGauge";

describe("RateGauge", () => {
  it("shows the rounded value and the setpoint percentage vs target", () => {
    render(<RateGauge value={75} max={100} label="Cadence" unit="u/min" />);
    expect(screen.getByText("75")).toBeInTheDocument();
    // 75/100 → 75%
    expect(screen.getByText(/75%/)).toBeInTheDocument();
    expect(screen.getByText(/Consigne/i)).toBeInTheDocument();
  });

  it("indicates the absence of a reference setpoint when max is missing", () => {
    render(<RateGauge value={120} label="Cadence" />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/Pas de consigne/i)).toBeInTheDocument();
  });

  it("renders an em dash for a non-finite value", () => {
    render(<RateGauge value={NaN} max={100} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
