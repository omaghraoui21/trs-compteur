// Shared visual style constants so dashboard charts (TrsChart, ParetoChart,
// WaterfallChart, …) stay consistent. Visual-only — do not put data/axis keys
// or chart-type config here.
export const chartTheme = {
  barOpacity: 0.85,
  axisFont: 11,
  gridStroke: "#f0f0f0",
} as const;
