import { ChevronLeft } from "lucide-react";

const CLS = "flex items-center gap-1 text-sm text-blue-600 mb-4 min-h-[44px] -ml-2 px-2 rounded-lg hover:bg-blue-50 transition";

export default function BackButton({ onClick, label = "Retour" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label} className={CLS}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {label}
    </button>
  );
}
