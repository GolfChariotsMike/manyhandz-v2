import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Home, Brain, Phone, Mail, MessageSquare, BarChart3, LogOut, Users, CreditCard, DollarSign, BookOpen, Menu, X, Plug } from "lucide-react";
import { clearToken } from "../lib/api";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/knowledge-base", icon: Brain, label: "Knowledge Base" },
  { to: "/voice", icon: Phone, label: "Voice" },
  { to: "/team", icon: Users, label: "Team" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/quoting", icon: DollarSign, label: "Quoting" },
  { to: "/email", icon: Mail, label: "DraftPilot" },
  { to: "/chat", icon: MessageSquare, label: "Chat" },
  { to: "/connections", icon: Plug, label: "Connections" },
  { to: "/usage", icon: BarChart3, label: "Usage" },
  { to: "/faq", icon: BookOpen, label: "Help & FAQ" },
];

export default function Layout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const SidebarContent = () => (
    <>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
            ManyHandz
          </h1>
          <p className="text-xs text-white/40 mt-0.5">Your AI team</p>
        </div>
        {/* Close button — mobile only */}
        <button onClick={closeMenu} className="md:hidden text-white/40 hover:text-white">
          <X size={22} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={closeMenu}
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
        className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 transition-all mt-2"
      >
        <LogOut size={18} />
        Sign out
      </button>
    </>
  );

  return (
    <div className="min-h-screen aurora-bg flex">

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-[#0f1f3d]/90 backdrop-blur border-b border-white/10">
        <span className="text-lg font-bold bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">ManyHandz</span>
        <button onClick={() => setMenuOpen(true)} className="text-white/60 hover:text-white">
          <Menu size={24} />
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          onClick={closeMenu}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />
          {/* Drawer */}
          <aside
            className="relative z-10 w-72 max-w-[85vw] h-full bg-[#0f1f3d] border-r border-white/10 p-6 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — always visible */}
      <aside className="hidden md:flex fixed top-0 left-0 h-screen w-64 border-r border-white/10 p-6 flex-col z-40">
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-64 pt-16 md:pt-0 p-4 md:p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
