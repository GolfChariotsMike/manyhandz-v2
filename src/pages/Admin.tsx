import { useEffect, useState } from "react";
import { Users, Phone, CreditCard, Activity, RefreshCw, ChevronDown, ChevronUp, Search } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ADMIN_SECRET = "mh_admin_mikek"; // simple guard — page only works with this token in sessionStorage

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

function statusBadge(customer: Customer) {
  const s = customer.subscription_status;
  const p = customer.plan_status;
  if (!customer.active) return <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">Inactive</span>;
  if (s === "active" && p === "active") return <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">Active</span>;
  if (customer.trial_expired === false) return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">Trial</span>;
  if (s === "active") return <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">Subscribed</span>;
  if (s === "past_due") return <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400">Past Due</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/40">{s || "Free"}</span>;
}

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"created" | "active" | "credits">("created");

  useEffect(() => {
    if (sessionStorage.getItem("mh_admin") === ADMIN_SECRET) setAuthed(true);
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mh_customers?select=id,subdomain,business_name,owner_name,owner_email,tier,plan,plan_status,subscription_status,stripe_subscription_id,credit_balance_usd,twilio_number,twilio_number_sid,voice_active,inbox_email,inbox_connected,pool_slot,agent_port,active,is_test,trial_ends_at,trial_expired,onboarding_complete,last_active_at,created_at&order=created_at.desc&limit=200`,
      { headers: { Authorization: `Bearer ${SUPABASE_ANON}`, apikey: SUPABASE_ANON! } }
    );
    const data = await res.json();
    setCustomers(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { if (authed) load(); }, [authed]);

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-card p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold mb-6 text-center">Admin Access</h1>
          <input
            type="password"
            placeholder="Admin PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && pin === "Mike1985") {
                sessionStorage.setItem("mh_admin", ADMIN_SECRET);
                setAuthed(true);
              }
            }}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none mb-4"
          />
          <button
            onClick={() => {
              if (pin === "Mike1985") { sessionStorage.setItem("mh_admin", ADMIN_SECRET); setAuthed(true); }
            }}
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

  const total = customers.length;
  const activeCount = customers.filter(c => c.active && (c.subscription_status === "active" || !c.trial_expired)).length;
  const withNumber = customers.filter(c => c.twilio_number).length;
  const totalCredits = customers.reduce((sum, c) => sum + (c.credit_balance_usd || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">ManyHandz Admin</h1>
          <p className="text-white/40 text-sm mt-1">{total} accounts</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm transition-all disabled:opacity-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="aurora-card p-4">
          <div className="flex items-center gap-2 text-white/50 text-xs mb-1"><Users size={12} /> Total Accounts</div>
          <div className="text-2xl font-bold">{total}</div>
          <div className="text-xs text-white/40 mt-1">{activeCount} active</div>
        </div>
        <div className="aurora-card p-4">
          <div className="flex items-center gap-2 text-white/50 text-xs mb-1"><Phone size={12} /> Voice Numbers</div>
          <div className="text-2xl font-bold">{withNumber}</div>
          <div className="text-xs text-white/40 mt-1">{customers.filter(c => c.voice_active).length} voice active</div>
        </div>
        <div className="aurora-card p-4">
          <div className="flex items-center gap-2 text-white/50 text-xs mb-1"><CreditCard size={12} /> Subscriptions</div>
          <div className="text-2xl font-bold">{customers.filter(c => c.stripe_subscription_id).length}</div>
          <div className="text-xs text-white/40 mt-1">{customers.filter(c => c.subscription_status === "past_due").length} past due</div>
        </div>
        <div className="aurora-card p-4">
          <div className="flex items-center gap-2 text-white/50 text-xs mb-1"><Activity size={12} /> Total Credits</div>
          <div className="text-2xl font-bold">${totalCredits.toFixed(0)}</div>
          <div className="text-xs text-white/40 mt-1">across all accounts</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm"
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:outline-none text-sm"
        >
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
              {filtered.map(c => (
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
                        : <span className="text-white/20">No number</span>
                      }
                    </td>
                    <td className="p-4">
                      <span className={c.credit_balance_usd < 2 ? "text-red-400" : c.credit_balance_usd < 10 ? "text-yellow-400" : "text-white"}>
                        ${(c.credit_balance_usd || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="p-4 text-white/50 font-mono text-xs">{c.pool_slot || c.agent_port || "—"}</td>
                    <td className="p-4 text-white/40 text-xs">{fmt(c.last_active_at)}</td>
                    <td className="p-4 text-white/30">
                      {expanded === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                  </tr>
                  {expanded === c.id && (
                    <tr key={`${c.id}-detail`} className="border-b border-white/5 bg-white/2">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <div className="text-white/40 mb-1">Owner</div>
                            <div>{c.owner_name}</div>
                            <div className="text-white/50">{c.owner_email}</div>
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Subscription</div>
                            <div>{c.stripe_subscription_id ? <span className="font-mono text-white/60">{c.stripe_subscription_id.slice(0, 20)}…</span> : "No subscription"}</div>
                            <div className="text-white/50 capitalize">{c.subscription_status}</div>
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Email Inbox</div>
                            <div>{c.inbox_email || "Not connected"}</div>
                            {c.inbox_connected && <div className="text-green-400">● Connected</div>}
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Details</div>
                            <div>Joined {fmt(c.created_at)}</div>
                            <div className="text-white/50">Onboarding: {c.onboarding_complete ? "✓ done" : "⏳ pending"}</div>
                            {c.trial_ends_at && <div className="text-white/50">Trial ends {fmt(c.trial_ends_at)}</div>}
                          </div>
                        </div>
                        <div className="mt-3 flex gap-3">
                          <a
                            href={`https://${c.subdomain}.manyhandz.ai`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            Open app →
                          </a>
                          {c.stripe_subscription_id && (
                            <a
                              href={`https://dashboard.stripe.com/subscriptions/${c.stripe_subscription_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                              onClick={e => e.stopPropagation()}
                            >
                              Stripe →
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && !loading && (
          <div className="text-center text-white/30 py-12">No accounts found</div>
        )}
      </div>
    </div>
  );
}
