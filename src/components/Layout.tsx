import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Home, Brain, Phone, Sparkles, MessageSquare, BarChart3, LogOut, Users, CreditCard, DollarSign, BookOpen, Menu, X, Plug, Bug, Check, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { clearToken, getMe } from "../lib/api";
import { trialCountdown, trialCountdownHeadline } from "../lib/trialCountdown";

function TrialBanner() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ subscription_status?: string | null; trial_ends_at?: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        const customer = me?.customer;
        if (!customer?.id) return;
        setStatus({
          subscription_status: customer.subscription_status,
          trial_ends_at: customer.trial_ends_at ?? null,
        });
      } catch {}
    })();
  }, []);

  if (!status) return null;

  const countdown = trialCountdown(status.subscription_status, status.trial_ends_at);
  // Global banner stays a last-days / expired warning — the full countdown lives on Billing.
  const isExpired = countdown.state === "ended";
  const isWarning =
    countdown.state === "last_day" || (countdown.state === "days" && countdown.daysLeft <= 3);

  if (!isExpired && !isWarning) return null;

  if (isExpired) {
    return (
      <div className="mx-4 md:mx-8 mt-4 md:mt-6 flex items-center gap-3 bg-red-500/15 border border-red-500/40 rounded-xl px-4 py-3">
        <XCircle size={18} className="text-red-400 shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-semibold text-red-400">Your trial has expired — AI is offline.</span>
          <span className="text-white/50 ml-1">Subscribe to reactivate your number and agent.</span>
        </div>
        <button onClick={() => navigate("/billing")} className="shrink-0 px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold rounded-lg transition-colors">
          Subscribe now
        </button>
      </div>
    );
  }

  const headline = trialCountdownHeadline(countdown);

  return (
    <div className="mx-4 md:mx-8 mt-4 md:mt-6 flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-4 py-3">
      <AlertTriangle size={18} className="text-yellow-400 shrink-0" />
      <div className="flex-1 text-sm">
        <span className="font-semibold text-yellow-400">{headline}.</span>
        <span className="text-white/50 ml-1">Add a payment method now to keep your number and AI agent.</span>
      </div>
      <button onClick={() => navigate("/billing")} className="shrink-0 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-semibold rounded-lg transition-colors">
        Subscribe
      </button>
    </div>
  );
}

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/knowledge-base", icon: Brain, label: "Knowledge Base" },
  { to: "/voice", icon: Phone, label: "Voice" },
  { to: "/chat", icon: MessageSquare, label: "Chat" },
  { to: "/capabilities", icon: Sparkles, label: "Capabilities" },
  { to: "/team", icon: Users, label: "Team" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/quoting", icon: DollarSign, label: "Quoting" },
  { to: "/connections", icon: Plug, label: "Connections" },
  { to: "/usage", icon: BarChart3, label: "Usage" },
];

const bottomNavItems = [
  { to: "/faq", icon: BookOpen, label: "Help & FAQ" },
];

function ReportBugButton({ onClose: _onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

  async function handleSubmit() {
    if (!message.trim()) return;
    setSending(true);
    try {
      let customer: any = null;
      try { customer = (await getMe())?.customer; } catch {}
      await fetch("https://kouembkldbpdbhzeaoth.supabase.co/rest/v1/mh_bug_reports", {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ customer_id: customer?.id || null, email: customer?.email || null, business_name: customer?.business_name || null, message: message.trim(), page: window.location.pathname, user_agent: navigator.userAgent }),
      });
      // Notify via edge function (sends Telegram + email)
      const who = customer?.business_name || customer?.email || "Unknown user";
      fetch("https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mh-bug-notify", {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ who, page: window.location.pathname, message: message.trim() }),
      }).catch(() => {});
      setSent(true);
      setMessage("");
      setTimeout(() => { setSent(false); setOpen(false); }, 2500);
    } catch {}
    finally { setSending(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 transition-all w-full">
        <Bug size={18} /> Report a bug
      </button>
    );
  }

  return (
    <div className="px-2 pb-2">
      <div className="bg-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium flex items-center gap-2"><Bug size={14} className="text-yellow-400" /> Report an issue</span>
          <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/50"><X size={14} /></button>
        </div>
        {sent ? (
          <div className="flex items-center gap-2 text-green-400 text-sm py-2"><Check size={14} /> Thanks! We'll look into it.</div>
        ) : (
          <>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="What's the issue?" rows={3} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-yellow-500/50 mb-2" />
            <button onClick={handleSubmit} disabled={sending || !message.trim()} className="w-full py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
              {sending ? "Sending..." : "Send report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const ADMIN_EMAIL = "info@stikstickers.com";

function readAssumedFromToken(): boolean {
  try {
    const token = localStorage.getItem("mh_token");
    if (!token) return false;
    const part = token.split(".")[1];
    if (!part) return false;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return payload.assumed === true;
  } catch {
    return false;
  }
}

export default function Layout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [customer, setCustomer] = useState<{ business_name?: string | null; email?: string | null } | null>(null);
  const [isAssumed] = useState(() => readAssumedFromToken());

  useState(() => {
    getMe().then(me => {
      const customer = me?.customer;
      if (customer) setCustomer(customer);
      if (customer?.email === ADMIN_EMAIL) setIsAdmin(true);
    }).catch(() => {});
  });

  const accountLabel = customer?.business_name || customer?.email || "";

  const closeMenu = () => setMenuOpen(false);

  const SidebarContent = () => (
    // eslint-disable-next-line react/jsx-no-useless-fragment
    <>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
            ManyHandz
          </h1>
          <p className="text-xs text-white/70 mt-1 truncate" title={accountLabel || undefined}>
            {accountLabel || "Your AI team"}
          </p>
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

      <div className="mt-2 space-y-1">
        {bottomNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
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
        {isAdmin && (
          <NavLink to="/admin" onClick={closeMenu} className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isActive ? "bg-white/10 text-white" : "text-yellow-500/70 hover:text-yellow-400 hover:bg-white/5"}`}>
            <ShieldCheck size={18} /> Admin
          </NavLink>
        )}
        <ReportBugButton onClose={closeMenu} />
        <button
          onClick={() => { clearToken(); navigate("/login"); }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/40 hover:text-white/70 transition-all w-full"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </div>
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
      <main className="flex-1 md:ml-64 pt-16 md:pt-0 overflow-y-auto min-h-screen">
        {isAssumed && accountLabel && (
          <div className="sticky top-16 md:top-0 z-20 mx-4 md:mx-8 mt-4 md:mt-6 px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/40 text-yellow-300 text-sm font-medium backdrop-blur">
            Viewing as {accountLabel}
          </div>
        )}
        <TrialBanner />
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
