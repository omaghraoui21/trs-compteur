const DASHBOARD_KPI_INDICES = [0, 1, 2, 3, 4];

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`motion-safe:animate-pulse rounded-md bg-gray-200 ${className}`} />;
}

/** Skeleton mimicking a stack of KPI cards + chart blocks (Dashboard). */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Chargement…">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {DASHBOARD_KPI_INDICES.map(i => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

/** Skeleton mimicking a list of collapsible cards (Supervisor). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Chargement…">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border shadow-sm px-4 py-3 flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-4 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton mimicking a data table (Admin). */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Chargement…">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
