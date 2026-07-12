import { Activity, AlertTriangle, Clock3, Factory, Gauge, RefreshCw } from "lucide-react";
import { useLiveOverview } from "@/lib/queries";
import { useLiveEvents } from "@/lib/liveEvents";

const statusMeta = {
  production: { label: "En production", dot: "bg-green-500", panel: "border-green-500" },
  stopped: { label: "En arrêt", dot: "bg-red-500", panel: "border-red-500" },
  inactive: { label: "Inactive", dot: "bg-gray-400", panel: "border-gray-300" },
};

export default function AtelierPage() {
  useLiveEvents();
  const { data, isLoading, isError, refetch, isFetching } = useLiveOverview();

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5" aria-labelledby="atelier-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Vue temps réel</p>
          <h2 id="atelier-title" className="mt-1 text-3xl font-bold tracking-tight text-gray-950">État de l&apos;atelier</h2>
          <p className="mt-1 text-sm text-gray-500">Actualisation automatique dès qu&apos;une activité est enregistrée.</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" /> Actualiser
        </button>
      </div>

      {isLoading && <div className="flex min-h-64 items-center justify-center rounded-xl border bg-white"><RefreshCw className="h-7 w-7 animate-spin text-blue-700" aria-label="Chargement" /></div>}
      {isError && <div className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-800"><AlertTriangle className="mr-2 inline h-5 w-5" /> Impossible de charger l&apos;état de l&apos;atelier.</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.machines.map((machine) => {
          const meta = statusMeta[machine.status];
          const trs = machine.trs == null ? "—" : `${(machine.trs * 100).toFixed(1)}%`;
          return (
            <article key={machine.equipmentId} className={`flex min-h-64 flex-col rounded-xl border-l-8 ${meta.panel} border-y border-r border-gray-200 bg-white p-5 shadow-sm`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-semibold uppercase tracking-wider text-gray-500">{machine.equipmentCode}</p>
                  <h3 className="mt-1 text-2xl font-bold text-gray-950">{machine.equipmentName}</h3>
                </div>
                <span className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${machine.status === "production" ? "motion-safe:animate-pulse" : ""}`} />{meta.label}
                </span>
              </div>
              <div className="my-5 flex items-end justify-between border-y border-gray-100 py-4">
                <div className="flex items-center gap-3"><Gauge className="h-7 w-7 text-blue-700" aria-hidden="true" /><div><p className="text-xs uppercase tracking-wide text-gray-500">TRS actuel</p><p className="text-4xl font-bold tabular-nums text-gray-950">{trs}</p></div></div>
                <div className="text-right"><p className="text-xs uppercase tracking-wide text-gray-500">Objectif</p><p className="text-xl font-bold text-gray-700">{machine.objective.toFixed(0)}%</p></div>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-gray-600"><Factory className="h-4 w-4" /><span className="truncate">{machine.batchNumber ?? "Aucun lot"}</span></div>
                <div className="flex items-center justify-end gap-2 text-gray-600"><Clock3 className="h-4 w-4" /><span>{machine.openedAt ? new Date(machine.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span></div>
              </div>
            </article>
          );
        })}
      </div>
      {!isLoading && data?.machines.length === 0 && <div className="rounded-xl border bg-white p-10 text-center text-gray-500"><Activity className="mx-auto mb-3 h-8 w-8" />Aucun équipement actif configuré.</div>}
    </section>
  );
}
