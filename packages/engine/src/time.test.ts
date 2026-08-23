import { describe, it, expect } from "vitest";
import { toMinutes, diffMinutes, fmtDuration, fmtPct, fmtNumber, trsColor } from "./time";

// Strip any whitespace separator the Intl grouping may use — fr-FR uses a
// narrow no-break space (U+202F) on modern ICU, a regular no-break space
// (U+00A0) on older builds. `\s` matches both, so tests don't depend on which is emitted.
const stripSep = (s: string) => s.replace(/\s/g, "");

describe("fmtNumber", () => {
  it("renders sub-thousand integers without a grouping separator", () => {
    expect(fmtNumber(0)).toBe("0");
    expect(fmtNumber(7)).toBe("7");
    expect(fmtNumber(42)).toBe("42");
    expect(fmtNumber(999)).toBe("999");
  });

  it("groups thousands while preserving every digit in order", () => {
    expect(stripSep(fmtNumber(12345))).toBe("12345");
    expect(stripSep(fmtNumber(1234567))).toBe("1234567");
    // A separator is actually inserted (output is longer than the bare digits)
    expect(fmtNumber(12345).length).toBeGreaterThan("12345".length);
  });

  it("keeps the sign on negative values", () => {
    expect(fmtNumber(-1500).startsWith("-")).toBe(true);
    expect(stripSep(fmtNumber(-1500))).toBe("-1500");
  });
});

describe("fmtDuration", () => {
  it("formats sub-hour durations as 'N min'", () => {
    expect(fmtDuration(0)).toBe("0 min");
    expect(fmtDuration(45)).toBe("45 min");
  });

  it("formats hour+ durations as 'Hh MM' with zero-padded minutes", () => {
    expect(fmtDuration(60)).toBe("1h00");
    expect(fmtDuration(75)).toBe("1h15");
    expect(fmtDuration(125)).toBe("2h05");
  });

  it("rounds fractional minutes before formatting", () => {
    expect(fmtDuration(59.6)).toBe("1h00");
    expect(fmtDuration(44.4)).toBe("44 min");
  });
});

describe("fmtPct", () => {
  it("renders a ratio as a one-decimal percentage", () => {
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(0.5)).toBe("50.0%");
    expect(fmtPct(0.756)).toBe("75.6%");
    expect(fmtPct(1)).toBe("100.0%");
  });
});

describe("diffMinutes", () => {
  it("returns whole minutes between two timestamps", () => {
    expect(diffMinutes("2026-06-01T08:00:00Z", "2026-06-01T09:30:00Z")).toBe(90);
  });

  it("returns 0 for identical timestamps", () => {
    const t = "2026-06-01T08:00:00Z";
    expect(diffMinutes(t, t)).toBe(0);
  });

  it("clamps reversed ranges to 0 (never negative)", () => {
    expect(diffMinutes("2026-06-01T09:30:00Z", "2026-06-01T08:00:00Z")).toBe(0);
  });
});

describe("toMinutes", () => {
  // Use local-time Date components so the result is timezone-independent.
  it("converts a local wall-clock time to minutes since midnight", () => {
    expect(toMinutes(new Date(2026, 5, 1, 0, 0))).toBe(0);
    expect(toMinutes(new Date(2026, 5, 1, 8, 30))).toBe(510);
    expect(toMinutes(new Date(2026, 5, 1, 23, 59))).toBe(1439);
  });
});

describe("trsColor", () => {
  it("maps ratios to NF E 60-182 traffic-light colors at the documented thresholds", () => {
    expect(trsColor(0.9)).toBe("#22c55e");   // >= 0.75 green
    expect(trsColor(0.75)).toBe("#22c55e");  // boundary inclusive
    expect(trsColor(0.6)).toBe("#f97316");   // >= 0.55 orange
    expect(trsColor(0.55)).toBe("#f97316");  // boundary inclusive
    expect(trsColor(0.3)).toBe("#ef4444");   // < 0.55 red
  });
});
