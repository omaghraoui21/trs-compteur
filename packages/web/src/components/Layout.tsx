import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Timer, ClipboardCheck, BarChart3, Settings, LogOut, Menu, X } from "lucide-react";

const navItems = [
  { to: "/", label: "Compteur", icon: Timer },
  { to: "/supervisor", label: "Validation", icon: ClipboardCheck },
  { to: "/dashboard", label: "Tableau de bord", icon: BarChart3 },
  { to: "/admin", label: "Configuration", icon: Settings, roles: ["admin", "supervisor"] },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <>
      {navItems.filter(item => !item.roles || item.roles.includes(user?.role || "")).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
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
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          {/* Hamburger — mobile/tablet only */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden p-1.5 rounded hover:bg-blue-600 transition"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
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
          <NavLinks />
        </nav>

        {/* ── Mobile drawer backdrop ── */}
        {drawerOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* ── Mobile drawer panel ── */}
        <div
          className={`fixed inset-y-0 left-0 w-64 bg-white z-50 flex flex-col shadow-xl transition-transform duration-200 lg:hidden ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b bg-blue-700 text-white">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              <span className="font-bold">TRS Compteur</span>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="p-1 rounded hover:bg-blue-600" aria-label="Fermer le menu">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-col py-2 flex-1">
            <NavLinks onNavigate={() => setDrawerOpen(false)} />
          </nav>
          <div className="px-4 py-3 border-t text-sm text-gray-500">{user?.displayName}</div>
        </div>

        <main className="flex-1 p-4 overflow-auto bg-gray-50">{children}</main>
      </div>
    </div>
  );
}
