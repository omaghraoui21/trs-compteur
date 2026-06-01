import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SessionCtx {
  equipmentName: string | null;
  openedAt: Date | null;
  set: (name: string | null, openedAt: Date | null) => void;
}

const SessionContext = createContext<SessionCtx | null>(null);

export function useActiveSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useActiveSession must be used within SessionProvider");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [equipmentName, setEquipmentName] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState<Date | null>(null);

  const set = useCallback((name: string | null, ts: Date | null) => {
    setEquipmentName(name);
    setOpenedAt(ts);
  }, []);

  return (
    <SessionContext.Provider value={{ equipmentName, openedAt, set }}>
      {children}
    </SessionContext.Provider>
  );
}
