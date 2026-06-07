import { useState, useEffect } from "react";
import { Timer, Clock, Package, ChevronRight, X } from "lucide-react";

const STEPS = [
  {
    icon: Timer,
    title: "Choisir l'équipement",
    description: "Sélectionnez votre salle puis votre équipement. Si un compteur est déjà ouvert, il est automatiquement récupéré.",
  },
  {
    icon: Clock,
    title: "Déclarer les arrêts",
    description: "Signalez chaque arrêt planifié (nettoyage, changement de série, pause) et non planifié (panne, attente) via « Déclarer un arrêt ». Le TRS est calculé automatiquement.",
  },
  {
    icon: Package,
    title: "Gérer les lots",
    description: "Démarrez un lot, saisissez les quantités, puis clôturez. Les cadences sont pré-remplies automatiquement.",
  },
];

const STORAGE_KEY = "trs_onboarding_done";

export function Onboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? "w-6 bg-blue-600" : "w-1.5 bg-gray-200"
                }`}
              />
            ))}
          </div>
          <button onClick={dismiss} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-6 text-center">
          <div className="bg-blue-50 rounded-2xl w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <Icon className="h-8 w-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">{current.title}</h3>
          <p className="text-sm text-gray-500 leading-relaxed">{current.description}</p>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={dismiss}
            className="flex-1 py-2.5 text-sm text-gray-500 border rounded-xl hover:bg-gray-50 transition"
          >
            Passer
          </button>
          <button
            onClick={isLast ? dismiss : () => setStep((s) => s + 1)}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-1"
          >
            {isLast ? "Commencer" : "Suivant"}
            {!isLast && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
