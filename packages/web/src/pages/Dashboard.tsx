import { useState, useEffect } from "react";
import { api, type Equipment } from "@/lib/api";
import { fmtPct, fmtDuration, trsColor } from "@trs/engine";
import { BarChart3, Calendar, Gauge } from "lucide-react";

type ZoomLevel = "day" | "week" | "month";

export default function DashboardPage() {
  const [equipmentsList, setEquipmentsList] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState("");
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.equipments().then(list => {
      setEquipmentsList(list);
      if (list.length > 0) setSelectedEquipment(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedEquipment) return;
    setLoading(true);
    const now = new Date();
    let from: string, to: string;

    if (zoom === "day") {
      from = to = now.toISOString().slice(0, 10);
    } else if (zoom === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      from = d.toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    } else {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      from = d.toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    }

    api.dashboardTrs(selectedEquipment, from, to)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedEquipment, zoom]);

  const eq = equipmentsList.find(e => e.id === selectedEquipment);

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5" /> Tableau de bord TRS
      </h2>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Equipement</label>
          <select value={selectedEquipment} onChange={e => setSelectedEquipment(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            {equipmentsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Zoom</label>
          <div className="flex border rounded-lg overflow-hidden">
            {(["day", "week", "month"] as ZoomLevel[]).map(z => (
              <button key={z} onClick={() => setZoom(z)}
                className={`px-4 py-2 text-sm ${zoom === z ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {z === "day" ? "Jour" : z === "week" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">Chargement...</div>}

      {!loading && data && (
        <>
          {/* Global TRS card */}
          <div className="bg-white rounded-xl border shadow-sm p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Gauge className="h-5 w-5 text-blue-600" />
              <h3 className="font-semibold">TRS Consolide — {eq?.name}</h3>
            </div>

            {data.total.lotCount === 0 ? (
              <div className="text-center text-gray-400 py-8">Aucune donnee pour cette periode</div>
            ) : (
              <>
                <div className="grid grid-cols-5 gap-3 text-center mb-4">
                  {[
                    { label: "TRS", value: data.total.TRS },
                    { label: "TRG", value: data.total.TRG },
                    { label: "DO", value: data.total.DO },
                    { label: "TP", value: data.total.TP },
                    { label: "TQ", value: data.total.TQ },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-50 rounded-xl p-3">
                      <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                      <div className="text-2xl font-bold" style={{ color: ["TRS", "TRG"].includes(item.label) ? trsColor(item.value) : undefined }}>
                        {fmtPct(item.value)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-3 text-sm text-center">
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-500">tO</div>
                    <div className="font-medium">{fmtDuration(data.total.tO)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-500">tR</div>
                    <div className="font-medium">{fmtDuration(data.total.tR)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-500">Lots</div>
                    <div className="font-medium">{data.total.lotCount}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-500">Production</div>
                    <div className="font-medium">{data.total.totalProduced.toLocaleString()}</div>
                  </div>
                </div>

                {/* Objective line */}
                {eq && (
                  <div className="mt-3 text-xs text-gray-500 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${data.total.TRS >= Number(eq.trsObjective) / 100 ? "bg-green-500" : "bg-red-500"}`} />
                    Objectif: {eq.trsObjective}% — {data.total.TRS >= Number(eq.trsObjective) / 100 ? "Atteint" : "Non atteint"}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Daily breakdown */}
          {data.daily && data.daily.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <h3 className="font-semibold text-sm">Detail par jour</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">tO</th>
                      <th className="px-3 py-2 text-right">tR</th>
                      <th className="px-3 py-2 text-right">Lots</th>
                      <th className="px-3 py-2 text-right">Prod.</th>
                      <th className="px-3 py-2 text-right">DO</th>
                      <th className="px-3 py-2 text-right">TP</th>
                      <th className="px-3 py-2 text-right">TQ</th>
                      <th className="px-3 py-2 text-right">TRS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.daily.map((d: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{d.date}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tO)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtDuration(d.tR)}</td>
                        <td className="px-3 py-2 text-right">{d.lotCount}</td>
                        <td className="px-3 py-2 text-right">{d.totalProduced.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(d.DO)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(d.TP)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(d.TQ)}</td>
                        <td className="px-3 py-2 text-right font-bold" style={{ color: trsColor(d.TRS) }}>{fmtPct(d.TRS)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
