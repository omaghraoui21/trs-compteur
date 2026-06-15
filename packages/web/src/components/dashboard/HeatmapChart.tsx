import type { HeatmapDataPoint } from "@/lib/api";
import { Grid } from "lucide-react";

interface Props {
  heatmap: HeatmapDataPoint[];
}

function trsToColor(trs: number): string {
  if (trs >= 85) return "#22c55e";
  if (trs >= 75) return "#4ade80";
  if (trs >= 65) return "#a3e635";
  if (trs >= 55) return "#facc15";
  if (trs >= 45) return "#fb923c";
  if (trs >= 35) return "#f97316";
  if (trs > 0) return "#ef4444";
  return "#f1f5f9"; // no data / 0
}

function trsToTextColor(trs: number): string {
  if (trs >= 75 || trs === 0) return "#1e293b";
  return "#ffffff";
}

const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function HeatmapChart({ heatmap }: Props) {
  if (heatmap.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Heatmap TRS horaire">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Grid className="h-4 w-4 text-blue-600" aria-hidden="true" /> Heatmap TRS
        </h3>
        <div className="text-center text-gray-400 py-8 text-sm">Aucune donnée</div>
      </div>
    );
  }

  // Group by week (ISO week) for a calendar-like grid
  const weeks: Map<string, { date: string; day: number; trs: number; do_: number; tp: number; tq: number; lots: number }[]> = new Map();

  for (const dp of heatmap) {
    const d = new Date(dp.date + "T00:00:00");
    const dayOfWeek = (d.getDay() + 6) % 7; // Mon=0, Sun=6
    const weekStart = new Date(d);
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    const weekKey = weekStart.toISOString().slice(0, 10);

    if (!weeks.has(weekKey)) weeks.set(weekKey, []);
    weeks.get(weekKey)!.push({
      date: dp.date,
      day: dayOfWeek,
      trs: dp.TRS,
      do_: dp.DO,
      tp: dp.TP,
      tq: dp.TQ,
      lots: dp.lotCount,
    });
  }

  const sortedWeeks = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4" role="region" aria-label="Heatmap TRS horaire">
      <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
        <Grid className="h-4 w-4 text-blue-600" aria-hidden="true" /> Heatmap TRS
      </h3>
      <p className="text-xs text-gray-500 mb-3">TRS journalier — intensité de couleur proportionnelle</p>

      <div className="overflow-x-auto">
        <div className="flex gap-0.5">
          {/* Day labels column */}
          <div className="flex flex-col gap-0.5 mr-1">
            {DAYS_FR.map(d => (
              <div key={d} className="h-8 flex items-center text-[10px] text-gray-400 w-6">{d}</div>
            ))}
          </div>

          {/* Week columns */}
          {sortedWeeks.map(([weekKey, days]) => (
            <div key={weekKey} className="flex flex-col gap-0.5">
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const dayData = days.find(d => d.day === dayIdx);
                if (!dayData) {
                  return <div key={dayIdx} className="w-8 h-8 rounded-sm bg-gray-50" />;
                }
                return (
                  <div
                    key={dayIdx}
                    className="w-8 h-8 rounded-sm flex items-center justify-center text-[9px] font-bold cursor-default relative group"
                    style={{ backgroundColor: trsToColor(dayData.trs), color: trsToTextColor(dayData.trs) }}
                    title={`${dayData.date} — TRS: ${dayData.trs.toFixed(1)}% | DO: ${dayData.do_.toFixed(1)}% | TP: ${dayData.tp.toFixed(1)}% | TQ: ${dayData.tq.toFixed(1)}% | ${dayData.lots} lot(s)`}
                  >
                    {dayData.trs > 0 ? Math.round(dayData.trs) : ""}
                    {/* Tooltip */}
                    <div className="hidden group-hover:block absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                      <div className="font-bold">{dayData.date}</div>
                      <div>TRS: {dayData.trs.toFixed(1)}%</div>
                      <div>DO: {dayData.do_.toFixed(1)}% | TP: {dayData.tp.toFixed(1)}% | TQ: {dayData.tq.toFixed(1)}%</div>
                      <div>{dayData.lots} lot(s)</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Color scale legend */}
      <div className="flex items-center gap-1 mt-3 text-[10px] text-gray-500">
        <span>0%</span>
        {[0, 35, 45, 55, 65, 75, 85].map(v => (
          <div key={v} className="w-4 h-3 rounded-sm" style={{ backgroundColor: trsToColor(v || 1) }} />
        ))}
        <span>100%</span>
        <span className="ml-2 text-gray-400">= TRS journalier</span>
      </div>
    </div>
  );
}
