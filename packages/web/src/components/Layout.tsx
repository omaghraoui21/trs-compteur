import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useActiveSession } from "@/lib/sessionContext";
import { fmtDuration, diffMinutes } from "@trs/engine";
import { Timer, ClipboardCheck, BarChart3, Settings, LogOut, KeyRound, Loader2 } from "lucide-react";

const HEADER_ICON_BTN = "p-1.5 rounded hover:bg-blue-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";

const ROLE_META: Record<string, { label: string; cls: string }> = {
  admin:      { label: "Admin",      cls: "bg-purple-100 text-purple-700" },
  supervisor: { label: "Superviseur",cls: "bg-blue-100 text-blue-700"    },
  operator:   { label: "Opérateur",  cls: "bg-gray-100 text-gray-600"    },
};

const navItems = [
  { to: "/", label: "Session", short: "Session", icon: Timer },
  { to: "/supervisor", label: "Validation", short: "Validation", icon: ClipboardCheck },
  { to: "/dashboard", label: "Tableau de bord", short: "Dashboard", icon: BarChart3 },
  { to: "/admin", label: "Configuration", short: "Réglages", icon: Settings, roles: ["admin", "supervisor"] },
];

const POLL_MS = 60_000;

function usePendingCount(role: string | undefined): number {
  const [count, setCount] = useState(0);
  const location = useLocation();
  const onSupervisorPage = location.pathname === "/supervisor";

  const fetch = useCallback(() => {
    if (!role || (role !== "supervisor" && role !== "admin")) return;
    api.pendingLotsCount().then(r => setCount(r.count)).catch(() => {});
  }, [role]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, POLL_MS);
    return () => clearInterval(id);
  }, [fetch]);

  // Reset badge when supervisor navigates to the page
  useEffect(() => { if (onSupervisorPage) setCount(0); }, [onSupervisorPage]);

  return count;
}

function useElapsed(openedAt: Date | null): string {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!openedAt) { setElapsed(""); return; }
    const tick = () => setElapsed(fmtDuration(diffMinutes(openedAt, new Date())));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [openedAt]);
  return elapsed;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const { equipmentName, openedAt } = useActiveSession();
  const elapsed = useElapsed(openedAt);
  const pendingCount = usePendingCount(user?.role);
  const items = navItems.filter(item => !item.roles || item.roles.includes(user?.role || ""));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Timer className="h-6 w-6" aria-hidden="true" />
          <h1 className="text-lg font-bold">TRS Compteur</h1>
        </div>
        <div className="flex items-center gap-4">
          {equipmentName ? (
            <span className="text-sm font-medium bg-green-500/20 text-green-100 px-2.5 py-1 rounded-full flex items-center gap-1.5 max-w-[180px] sm:max-w-none truncate">
              <span className="h-2 w-2 rounded-full bg-green-400 motion-safe:animate-pulse shrink-0" />
              <span className="truncate">{equipmentName}{elapsed ? ` • ${elapsed}` : ""}</span>
            </span>
          ) : (
            <span className="hidden sm:inline text-sm opacity-80">{user?.displayName}</span>
          )}
          <button onClick={() => setPwOpen(true)} className={HEADER_ICON_BTN} aria-label="Changer mon mot de passe">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </button>
          <button onClick={logout} className={HEADER_ICON_BTN} aria-label="Déconnexion">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}

      <div className="flex-1 flex">
        {/* ── Desktop sidebar (lg+) ── */}
        <nav className="hidden lg:flex w-48 bg-white border-r flex-col py-2 shrink-0" aria-label="Navigation principale">
          <div className="flex-1">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition ${
                    isActive ? "bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-700" : "text-gray-600 hover:bg-gray-50"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/supervisor" && pendingCount > 0 && (
                  <span className="ml-auto text-[10px] bg-red-500 text-white font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center" aria-label={`${pendingCount} lot${pendingCount > 1 ? "s" : ""} en attente`}>
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
          {user && (() => {
            const { label, cls } = ROLE_META[user.role] ?? ROLE_META.operator;
            return (
              <div className="border-t px-4 py-3 mt-auto">
                <div className="text-xs font-medium text-gray-700 truncate">{user.displayName}</div>
                <div className="mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
                </div>
              </div>
            );
          })()}
        </nav>

        {/* extra bottom padding on mobile so the fixed tab bar (56px + safe area)
            never covers content or action buttons */}
        <main className="flex-1 p-4 pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-4 overflow-auto bg-gray-50">{children}</main>
      </div>

      {/* ── Mobile/tablet bottom tab bar (< lg) ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t flex z-40 shadow-[0_-1px_3px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]" aria-label="Navigation principale">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[11px] font-medium transition ${
                isActive ? "text-blue-700" : "text-gray-500"
              }`
            }
          >
            <div className="relative">
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.to === "/" && equipmentName && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              )}
              {item.to === "/supervisor" && pendingCount > 0 && (
                <span className="absolute -top-1 -right-2 text-[9px] bg-red-500 text-white font-bold px-1 py-px rounded-full min-w-[15px] text-center leading-none" aria-label={`${pendingCount} lot${pendingCount > 1 ? "s" : ""} en attente`}>
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </div>
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])'
    ));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    el.addEventListener("keydown", trap);
    first?.focus();
    return () => el.removeEventListener("keydown", trap);
  }, []);

  const submit = async () => {
    if (newPassword !== confirm) { toast.error("Les mots de passe ne correspondent pas"); return; }
    setSaving(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      toast.success("Mot de passe modifié");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Échec du changement de mot de passe");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !saving) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 text-gray-800"
      onClick={() => { if (!saving) onClose(); }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 ref={titleRef} id="pw-dialog-title" tabIndex={-1} className="font-semibold mb-3 flex items-center gap-2 outline-none">
          <KeyRound className="h-5 w-5 text-blue-600" aria-hidden="true" /> Changer mon mot de passe
        </h3>
        <div className="space-y-3">
          <input type="password" autoFocus autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="Mot de passe actuel" className="w-full border rounded-lg px-3 py-2 text-sm" aria-label="Mot de passe actuel" />
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nouveau mot de passe (6 car. min.)" className="w-full border rounded-lg px-3 py-2 text-sm" aria-label="Nouveau mot de passe" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !saving && oldPassword && newPassword.length >= 6) submit(); }} placeholder="Confirmer le nouveau mot de passe" className="w-full border rounded-lg px-3 py-2 text-sm" aria-label="Confirmation du nouveau mot de passe" />
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} disabled={saving} className="px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Annuler</button>
          <button onClick={submit} disabled={saving || !oldPassword || newPassword.length < 6}
            aria-busy={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Enregistrement…</> : "Changer"}
          </button>
        </div>
      </div>
    </div>
  );
}
