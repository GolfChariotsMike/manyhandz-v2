import { useEffect, useState } from "react";
import { Users, Phone, CreditCard, Activity, RefreshCw, ChevronDown, ChevronUp, Search, PhoneCall, Clock } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://kouembkldbpdbhzeaoth.supabase.co";
const ADMIN_TOKEN = "mh_admin_mikek";
const ADMIN_PIN = "Mike1985";

type Customer = {
  id: string;
  email: string;
  business_name: string;
  industry: string;
  plan: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  twilio_number: string | null;
  voice_active: boolean;
  onboarding_complete: boolean;
  el_agent_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
};

type UnassignedNumber = { number: string; sid: string; friendly_name: string; account: string; isDemo?: boolean };

type DemoCall = {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
  status: string;
  from_number: string | null;
  transcript_summary: string | null;
};

function statusBadge(c: Customer) {
  if (c.subscription_status === "active") return <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">Active</span>;
  if (c.subscription_status === "past_due") return <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400">Past Due</span>;
  if (c.subscription_status === "trial") return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">Trial</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/40">{c.subscription_status || "Free"}</span>;
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
  const [demoCalls, setDemoCalls] = useState<DemoCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"created" | "status">("created");
  const [tab, setTab] = useState<"accounts" | "demo">("accounts");

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
      setDemoCalls(Array.isArray(data.demo_calls) ? data.demo_calls : []);
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
          <p className="text-white/40 text-sm text-center mb-6">ManyHandz v2</p>
          <input type="password" placeholder="PIN" value={pin} autoFocus
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && pin === ADMIN_PIN) { sessionStorage.setItem("mh_admin", ADMIN_TOKEN); setAuthed(true); } }}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none mb-4" />
          <button onClick={() => { if (pin === ADMIN_PIN) { sessionStorage.setItem("mh_admin", ADMIN_TOKEN); setAuthed(true); } }} className="btn-primary w-full">Enter</button>
        </div>
      </div>
    );
  }

  const filtered = customers
    .filter(c => !search || [c.business_name, c.email, c.twilio_number || ""].join(" ").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "status") return a.subscription_status.localeCompare(b.subscription_status);
      return b.created_at.localeCompare(a.created_at);
    });

  const activeCount = customers.filter(c => c.subscription_status === "active").length;
  const trialCount = customers.filter(c => c.subscription_status === "trial").length;
  const withNumber = customers.filter(c => c.twilio_number).length;
  const withAgent = customers.filter(c => c.el_agent_id).length;

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
          { icon: <Users size={12} />, label: "Total Accounts", value: customers.length, sub: `${activeCount} paid · ${trialCount} trial` },
          { icon: <Phone size={12} />, label: "Phone Numbers", value: withNumber, sub: `${unassigned.length} unassigned` },
          { icon: <CreditCard size={12} />, label: "Subscriptions", value: customers.filter(c => c.stripe_subscription_id).length, sub: "paying customers" },
          { icon: <Activity size={12} />, label: "Voice Agents", value: withAgent, sub: "ElevenLabs connected" },
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
              <div key={n.sid} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${n.isDemo ? "bg-yellow-500/10 border border-yellow-500/20" : "bg-white/5"}`}>
                <div className="flex items-center gap-2">
                  {n.isDemo && <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400 font-medium">Demo Line</span>}
                  <span className="font-mono">{n.number}</span>
                </div>
                <span className="text-white/40 text-xs">{n.isDemo ? "Sales demo" : `${n.friendly_name} · ${n.account}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("accounts")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === "accounts" ? "bg-yellow-500/20 text-yellow-400" : "bg-white/5 text-white/50 hover:text-white/80"}`}>
          <span className="flex items-center gap-2"><Users size={14} /> Accounts ({customers.length})</span>
        </button>
        <button onClick={() => setTab("demo")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === "demo" ? "bg-yellow-500/20 text-yellow-400" : "bg-white/5 text-white/50 hover:text-white/80"}`}>
          <span className="flex items-center gap-2"><PhoneCall size={14} /> Demo Line ({demoCalls.length})</span>
        </button>
      </div>

      {/* Demo Line Tab */}
      {tab === "demo" && (
        <div className="aurora-card overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <PhoneCall size={16} className="text-yellow-400" />
              <div>
                <div className="font-semibold">Jake — ManyHandz Demo Line</div>
                <div className="text-white/40 text-xs">+61 485 021 312 · ElevenLabs agent_4701kzv3pb8sfkwrdbja7s22rk75</div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                  <th className="text-left p-4">Date & Time</th>
                  <th className="text-left p-4">From</th>
                  <th className="text-left p-4">Duration</th>
                  <th className="text-left p-4">Status</th>
                  <th className="text-left p-4">Summary</th>
                </tr>
              </thead>
              <tbody>
                {demoCalls.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-white/30">No calls yet</td></tr>}
                {demoCalls.map(c => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="p-4 text-white/70 text-xs">{c.started_at ? new Date(c.started_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="p-4 font-mono text-xs">{c.from_number || "—"}</td>
                    <td className="p-4">
                      {c.duration_seconds != null
                        ? <span className="flex items-center gap-1 text-xs"><Clock size={11} /> {c.duration_seconds >= 60 ? `${Math.floor(c.duration_seconds/60)}m ${c.duration_seconds%60}s` : `${c.duration_seconds}s`}</span>
                        : "—"}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        c.status === "done" ? "bg-green-500/20 text-green-400" :
                        c.status === "initiated" ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-white/10 text-white/40"
                      }`}>{c.status}</span>
                    </td>
                    <td className="p-4 text-white/50 text-xs max-w-xs">{c.transcript_summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "accounts" && <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:outline-none text-sm">
          <option value="created">Newest first</option>
          <option value="status">By status</option>
        </select>
      </div>}

      {tab === "accounts" && <>{/* Table */}
      <div className="aurora-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                <th className="text-left p-4">Business</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Plan</th>
                <th className="text-left p-4">Phone Number</th>
                <th className="text-left p-4">Voice Agent</th>
                <th className="text-left p-4">Trial Ends</th>
                <th className="text-left p-4">Joined</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-12 text-white/30">Loading...</td></tr>}
              {!loading && filtered.map(c => (
                <>
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                    <td className="p-4">
                      <div className="font-medium">{c.business_name}</div>
                      <div className="text-white/40 text-xs">{c.email}</div>
                    </td>
                    <td className="p-4">{statusBadge(c)}</td>
                    <td className="p-4 capitalize">{c.plan || "—"}</td>
                    <td className="p-4">
                      {c.twilio_number
                        ? <div>
                            <div className="font-mono text-xs">{c.twilio_number}</div>
                            {c.voice_active && <div className="text-xs text-green-400">● active</div>}
                          </div>
                        : <span className="text-white/20">—</span>}
                    </td>
                    <td className="p-4 text-xs">{c.el_agent_id ? <span className="text-green-400">● Connected</span> : <span className="text-white/20">—</span>}</td>
                    <td className="p-4 text-white/40 text-xs">{fmt(c.trial_ends_at)}</td>
                    <td className="p-4 text-white/40 text-xs">{fmt(c.created_at)}</td>
                    <td className="p-4 text-white/30">{expanded === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                  </tr>
                  {expanded === c.id && (
                    <tr key={`${c.id}-exp`} className="border-b border-white/5 bg-black/20">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-xs">
                          <div>
                            <div className="text-white/40 mb-1">Subscription</div>
                            <div className="capitalize font-medium">{c.subscription_status}</div>
                            {c.stripe_subscription_id && <div className="text-white/40 font-mono">{c.stripe_subscription_id.slice(0, 24)}…</div>}
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">ElevenLabs Agent ID</div>
                            <div className="font-mono text-white/60 break-all">{c.el_agent_id || "Not configured"}</div>
                          </div>
                          <div>
                            <div className="text-white/40 mb-1">Onboarding</div>
                            <div>{c.onboarding_complete ? "✓ Complete" : "⏳ Pending"}</div>
                            {c.trial_started_at && <div className="text-white/40 mt-1">Trial started {fmt(c.trial_started_at)}</div>}
                          </div>
                        </div>
                        {c.stripe_subscription_id && (
                          <div className="mt-3">
                            <a href={`https://dashboard.stripe.com/subscriptions/${c.stripe_subscription_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors">Stripe →</a>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-white/30">No accounts found</td></tr>}
            </tbody>
          </table>
        </div>
      </div></> }
    </div>
  );
}
