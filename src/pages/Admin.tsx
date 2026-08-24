import { useEffect, useState } from "react";
import { Users, Phone, CreditCard, Activity, RefreshCw, ChevronDown, ChevronUp, Search } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://kouembkldbpdbhzeaoth.supabase.co";
const ADMIN_TOKEN = "mh_admin_mikek";
const ADMIN_PIN = "Mike1985";

type Customer = {
  id: string;
  subdomain: string;
  business_name: string;
  owner_name: string;
  owner_email: string;
  tier: string;
  plan: string;
  plan_status: string;
  subscription_status: string;
  stripe_subscription_id: string | null;
  credit_balance_usd: number;
  twilio_number: string | null;
  twilio_number_sid: string | null;
  voice_active: boolean;
  inbox_email: string | null;
  inbox_connected: boolean;
  pool_slot: string | null;
  agent_port: number | null;
  active: boolean;
  is_test: boolean;
  trial_ends_at: string | null;
  trial_expired: boolean;
  onboarding_complete: boolean;
  last_active_at: string | null;
  created_at: string;
};

type UnassignedNumber = { number: string; sid: string; friendly_name: string; account: string };

function statusBadge(c: Customer) {
  if (!c.active) return <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">Inactive</span>;
  if (c.subscription_status === "past_due") return <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400">Past Due</span>;
  if (c.subscription_status === "active" && c.plan_status === "active") return <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">Active</span>;
  if (c.stripe_subscription_id) return <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">Subscribed</span>;
  if (!c.trial_expired) return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">Trial</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/40">Free</span>;
}

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

export default function Admin() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("mh_admin") === ADMIN_TOKEN);
  const [pin, setPin] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"created" | "active" | "credits">("created");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin`, {
        headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setUnassigned(Array.isArray(data.unassigned_numbers) ? data.unassigned_numbers : []);
    } catch (e: unknown) {
      setError(String(e));
    }
    setLoading(false);
  }

  useEffect(() => { if (authed) load(); }, [authed]);

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-card p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold mb-2 text-center">Admin</h1>
          <p className="text-white/40 text-sm text-center mb-6">ManyHandz master admin</p>
          <input
            type="password"
            placeholder="PIN"
            value={pin}
            autoFocus
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && pin === ADMIN_PIN) {
                sessionStorage.setItem("mh_admin", ADMIN_TOKEN);
                setAuthed(true);
              }
            }}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none mb-4"
          />
          <button
            onClick={() => { if (pin === ADMIN_PIN) { sessionStorage.setItem("mh_admin", ADMIN_TOKEN); setAuthed(true); } }}
            className="btn-primary w-full"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  const filtered = customers
    .filter(c => !search || [c.business_name, c.owner_email, c.subdomain, c.twilio_number || ""].join(" ").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "active") return (b.last_active_at || "").localeCompare(a.last_active_at || "");
      if (sortBy === "credits") return b.credit_balance_usd - a.credit_balance_usd;
      return b.created_at.localeCompare(a.created_at);
    });

  const activeCount = customers.filter(c => c.active && c.subscription_status === "active").length;
  const withNumber = customers.filter(c => c.twilio_number).length;
  const totalCredits = customers.reduce((sum, c) => sum + (c.credit_balance_usd || 0), 0);
  const pastDue = customers.filter(c => c.subscription_status === "past_due").length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">ManyHandz Admin</h1>
          <p className="text-white/40 text-sm mt-1">{customers.length} accounts · {unassigned.length} unassigned numbers</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm transition-all disabled:opacity-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: <Users size={12} />, label: "Total Accounts", value: customers.length, sub: `${activeCount} active` },
          { icon: <Phone size={12} />, label: "Numbers Provisioned", value: withNumber + unassigned.length, sub: `${unassigned.length} unassigned` },
          { icon: <CreditCard size={12} />, label: "Paying Subscribers", value: customers.filter(c => c.stripe_subscription_id).length, sub: pastDue > 0 ? `⚠️ ${pastDue} past due` : "All current" },
          { icon: <Activity size={12} />, label: "Total Credits", value: `$${totalCredits.toFixed(0)}`, sub: "across all accounts" },
        ].map(s => (
          <div key={s.label} className="aurora-card p-4">
            <div className="flex items-center gap-2 text-white/50 text-xs mb-1">{s.icon} {s.label}</div>
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-white/40 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Unassigned numbers */}
      {unassigned.length > 0 && (
        <div className="aurora-card p-4 mb-6">
          <h3 className="text-sm font-semibold mb-3 text-yellow-400">⚠️ Provisioned but unassigned numbers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {unassigned.map(n => (
              <div key={n.sid} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 text-sm">
                <span className="font-mono">{n.number}</span>
                <span className="text-white/40 text-xs">{n.friendly_name} · {n.account}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:outline-none text-sm">
          <option value="created">Newest first</option>
          <option value="active">Recently active</option>
          <option value="credits">Most credits</option>
        </select>
      </div>

      {/* Table */}
      <div className="aurora-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                <th className="text-left p-4">Business</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Plan</th>
                <th className="text-left p-4">Phone Number</th>
                <th className="text-left p-4">Credits</th>
                <th className="text-left p-4">Slot</th>
                <th className="text-left p-4">Last Active</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-12 text-white/30">Loading...</td></tr>
              )}
              {!loading && filtered.map(c => (
                <>
                  <tr
                    key={c.id}
                    className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors"
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <td className="p-4">
                      <div className="font-medium">{c.business_name}</div>
                      <div className="text-white/40 text-xs">{c.subdomain}.manyhandz.ai</div>
                    </td>
                    <td className="p-4">{statusBadge(c)}</td>
                    <td className="p-4">
                      <div className="capitalize">{c.plan || "—"}</div>
                      {c.is_test && <div className="text-xs text-yellow-400/60">test</div>}
                    </td>
                    <td className="p-4">
                      {c.twilio_number
                        ? <div>
                            <div className="font-mono text-xs">{c.twilio_number}</div>
                            {c.voice_active && <div className="text-xs text-green-400">● voice active</div>}
                          </div>
                        : <span className="text-white/20">—</span>}
                    </td>
                    <td className="p-4">
                      <span className={c.credit_balance_usd < 2 ? "text-red-400" : c.credit_balance_usd < 10 ? "text-yellow-400" : ""}>
                        ${(c.credit_balance_usd || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="p-4 text-white/50 font-mono text-xs">{c.pool_slot || c.agent_port || "—"}</td>
                    <td className="p-4 text-white/40 text-xs">{fmt(c.last_active_at)}</td>
                    <td className="p-4 text-white/30">{expanded === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                  </tr>
                  {expanded === c.id && (
                    <tr key={`${c.id}-exp`} className="border-b border-white/5 bg-black/20">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs mb-4">
                          <div>
                            <div className="text-white/40 mb-1">Owner</div>
                            <div className="font-medium">{c.owner_name}</div>
                            <div className="text-white/50">{c.owner_email}</div>
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Subscription</div>
                            <div className="capitalize font-medium">{c.subscription_status || "None"}</div>
                            {c.stripe_subscription_id && <div className="text-white/40 font-mono">{c.stripe_subscription_id.slice(0, 24)}…</div>}
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Email Inbox</div>
                            <div>{c.inbox_email || "Not connected"}</div>
                            {c.inbox_connected && <div className="text-green-400">● Connected</div>}
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Account</div>
                            <div>Joined {fmt(c.created_at)}</div>
                            <div className="text-white/50">Onboarding: {c.onboarding_complete ? "✓ complete" : "⏳ pending"}</div>
                            {c.trial_ends_at && <div className="text-white/50 mt-1">Trial ends {fmt(c.trial_ends_at)}</div>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <a href={`https://${c.subdomain}.manyhandz.ai`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors">Open app →</a>
                          {c.stripe_subscription_id && (
                            <a href={`https://dashboard.stripe.com/subscriptions/${c.stripe_subscription_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors">Stripe →</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-white/30">No accounts found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
