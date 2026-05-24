import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Timer, ClipboardCheck, BarChart3, LogOut } from "lucide-react";

const navItems = [
  { to: "/", label: "Compteur", icon: Timer },
  { to: "/supervisor", label: "Validation", icon: ClipboardCheck },
  { to: "/dashboard", label: "Tableau de bord", icon: BarChart3 },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Timer className="h-6 w-6" />
          <h1 className="text-lg font-bold">TRS Compteur</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm opacity-80">{user?.displayName}</span>
          <button onClick={logout} className="p-1.5 rounded hover:bg-blue-600 transition" title="Déconnexion">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        <nav className="w-48 bg-white border-r flex flex-col py-2 shrink-0">
          {navItems.map((item) => (
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

        <main className="flex-1 p-4 overflow-auto bg-gray-50">{children}</main>
      </div>
    </div>
  );
}
