import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";
import { CheckCircle, AlertCircle, X } from "lucide-react";

type ToastVariant = "success" | "error";
interface Toast { id: number; message: string; variant: ToastVariant }

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

let nextId = 1;

function normalizeError(msg: string): string {
  if (/erreur serveur/i.test(msg) || /^HTTP 5/.test(msg)) {
    return "Connexion serveur impossible. Vérifie internet ou réessaie.";
  }
  if (/fetch failed|network error|failed to fetch/i.test(msg)) {
    return "Pas de connexion réseau. Vérifie ta connexion et réessaie.";
  }
  if (/zod|validation error|invalid input/i.test(msg)) {
    return "Données invalides. Vérifie les champs et réessaie.";
  }
  if (/unauthorized|401/i.test(msg)) {
    return "Session expirée. Reconnecte-toi.";
  }
  if (/not found|404/i.test(msg)) {
    return "Élément introuvable. Recharge la page.";
  }
  if (/conflict|409/i.test(msg)) {
    return "Action impossible : conflit de données. Recharge la page.";
  }
  return msg;
}

function ToastItem({ t, onRemove }: { t: Toast; onRemove: () => void }) {
  const touchStartX = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    setOffsetX(e.touches[0].clientX - touchStartX.current);
  };
  const onTouchEnd = () => {
    if (Math.abs(offsetX) > 80) {
      onRemove();
    } else {
      setOffsetX(0);
    }
    touchStartX.current = null;
  };

  return (
    <div
      role={t.variant === "error" ? "alert" : "status"}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
        opacity: offsetX !== 0 ? Math.max(0.2, 1 - Math.abs(offsetX) / 150) : undefined,
        transition: offsetX === 0 ? "transform 0.2s, opacity 0.2s" : undefined,
      }}
      className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white cursor-grab active:cursor-grabbing ${
        t.variant === "error" ? "bg-red-600" : "bg-green-600"
      }`}
    >
      {t.variant === "error" ? (
        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      ) : (
        <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      )}
      <span className="flex-1">{t.message}</span>
      <button
        onClick={onRemove}
        aria-label="Fermer la notification"
        className="shrink-0 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => remove(id), 5000);
  }, [remove]);

  const api: ToastApi = {
    success: (message) => push(message, "success"),
    error: (message) => push(normalizeError(message), "error"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 right-4 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} onRemove={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
