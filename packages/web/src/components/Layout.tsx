import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Timer, ClipboardCheck, BarChart3, Settings, LogOut } from "lucide-react";

const navItems = [
  { to: "/", label: "Session", short: "Session", icon: Timer },
  { to: "/supervisor", label: "Validation", short: "Validation", icon: ClipboardCheck },
  { to: "/dashboard", label: "Tableau de bord", short: "Dashboard", icon: BarChart3 },
  { to: "/admin", label: "Configuration", short: "Réglages", icon: Settings, roles: ["admin", "supervisor"] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const items = navItems.filter(item => !item.roles || item.roles.includes(user?.role || ""));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Timer className="h-6 w-6" />
          <h1 className="text-lg font-bold">TRS Compteur</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline text-sm opacity-80">{user?.displayName}</span>
          <button onClick={logout} className="p-1.5 rounded hover:bg-blue-600 transition" title="Déconnexion">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* ── Desktop sidebar (lg+) ── */}
        <nav className="hidden lg:flex w-48 bg-white border-r flex-col py-2 shrink-0">
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
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* extra bottom padding on mobile so the fixed tab bar never covers content */}
        <main className="flex-1 p-4 pb-24 lg:pb-4 overflow-auto bg-gray-50">{children}</main>
      </div>

      {/* ── Mobile/tablet bottom tab bar (< lg) ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t flex z-40 shadow-[0_-1px_3px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
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
            <item.icon className="h-5 w-5" />
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
