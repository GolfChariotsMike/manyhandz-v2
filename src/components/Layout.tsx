import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Home, Brain, Phone, BarChart3, LogOut } from "lucide-react";
import { clearToken } from "../lib/api";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/knowledge-base", icon: Brain, label: "Knowledge Base" },
  { to: "/voice", icon: Phone, label: "Voice" },
  { to: "/usage", icon: BarChart3, label: "Usage & Billing" },
];

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen aurora-bg flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 p-6 flex flex-col">
        <div className="mb-10">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            ManyHandz
          </h1>
          <p className="text-xs text-white/40 mt-1">Your AI team</p>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => { clearToken(); navigate("/login"); }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 transition-all"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
