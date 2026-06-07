import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

interface ActiveSession { name: string; openedAt: Date }

interface SessionCtx {
  equipmentName: string | null;
  openedAt: Date | null;
  set: (session: ActiveSession | null) => void;
}

const SessionContext = createContext<SessionCtx | null>(null);

export function useActiveSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useActiveSession must be used within SessionProvider");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(null);

  const set = useCallback((s: ActiveSession | null) => setSession(s), []);

  const value = useMemo(
    () => ({ equipmentName: session?.name ?? null, openedAt: session?.openedAt ?? null, set }),
    [session, set],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
