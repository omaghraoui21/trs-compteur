import { createContext, useContext, useCallback, useState, type ReactNode } from "react";
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
    error: (message) => push(message, "error"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white ${
              t.variant === "error" ? "bg-red-600" : "bg-green-600"
            }`}
          >
            {t.variant === "error" ? (
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
            )}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="shrink-0 opacity-80 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
