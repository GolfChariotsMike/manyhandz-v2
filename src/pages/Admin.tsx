import { useEffect, useState } from "react";
import { Users, Phone, CreditCard, Activity, RefreshCw, ChevronDown, ChevronUp, Search, PhoneCall, Clock, Radio, Mail } from "lucide-react";
import { setToken } from "../lib/api";
import { meCache } from "../lib/meCache";

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

type OutreachContact = {
  id: string;
  name: string;
  phone: string;
  business: string;
  city: string;
  category: string;
  rating: number | null;
  reviews: number | null;
  status: string;
  sms_sent: boolean;
};

type OutboundCall = {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
  status: string;
  transcript_summary: string | null;
};

type OutreachStats = { total: number; new: number; contacted: number; not_interested: number };

type DemoLead = {
  id: string;
  name: string;
  email: string;
  phone_e164: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
  followup_email_sent_at: string | null;
  followup_called_at: string | null;
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

function fmtDateTime(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Admin() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("mh_admin") === ADMIN_TOKEN);
  const [pin, setPin] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedNumber[]>([]);
  const [demoCalls, setDemoCalls] = useState<DemoCall[]>([]);
  const [demoGreeting, setDemoGreeting] = useState("");
  const [demoPrompt, setDemoPrompt] = useState("");
  const [savingAgent, setSavingAgent] = useState(false);
  const [outreachContacts, setOutreachContacts] = useState<OutreachContact[]>([]);
  const [outboundCalls, setOutboundCalls] = useState<OutboundCall[]>([]);
  const [outreachStats, setOutreachStats] = useState<OutreachStats>({ total: 0, new: 0, contacted: 0, not_interested: 0 });
  const [leads, setLeads] = useState<DemoLead[]>([]);
  const [leadsSearch, setLeadsSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [outreachSearch, setOutreachSearch] = useState("");
  const [outreachFilter, setOutreachFilter] = useState("all");
  const [dialingId, setDialingId] = useState<string | null>(null);
  const [queueCategory, setQueueCategory] = useState("all");
  const [queueLimit, setQueueLimit] = useState(50);
  const [queueStatus, setQueueStatus] = useState<{ pending: number; done: number; total: number } | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("");
  const [testBusiness, setTestBusiness] = useState("");
  const [testDialing, setTestDialing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"created" | "status">("created");
  const [tab, setTab] = useState<"accounts" | "demo" | "leads" | "outreach">("accounts");

  async function load() {
    setLoading(true);
    setError("");
    const adminReq = fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin`, {
      headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
    });
    const leadsReq = fetch(`${SUPABASE_URL}/functions/v1/mhv2-leads`, {
      headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
    });
    try {
      const res = await adminReq;
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setUnassigned(Array.isArray(data.unassigned_numbers) ? data.unassigned_numbers : []);
      setDemoCalls(Array.isArray(data.demo_calls) ? data.demo_calls : []);
      if (data.demo_agent) { setDemoGreeting(data.demo_agent.first_message || ""); setDemoPrompt(data.demo_agent.prompt || ""); }
      setOutreachContacts(Array.isArray(data.outreach_contacts) ? data.outreach_contacts : []);
      setOutboundCalls(Array.isArray(data.outbound_calls) ? data.outbound_calls : []);
      if (data.outreach_stats) setOutreachStats(data.outreach_stats);
    } catch (e: unknown) {
      setError(String(e));
    }
    try {
      const leadsRes = await leadsReq;
      const leadsData = await leadsRes.json();
      if (!leadsData.error && Array.isArray(leadsData.leads)) setLeads(leadsData.leads);
    } catch {
      // Accounts / Demo Line / Outreach still load if leads fail.
    }
    setLoading(false);
  }

  async function setFollowupCalled(id: string, followup_called: boolean) {
    const prev = leads;
    const stamp = followup_called ? new Date().toISOString() : null;
    setLeads((rows) => rows.map((row) => row.id === id ? { ...row, followup_called_at: stamp } : row));
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mhv2-leads`, {
        method: "PATCH",
        headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ id, followup_called }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.id) {
        setLeads((rows) => rows.map((row) => row.id === id ? { ...row, followup_called_at: data.followup_called_at ?? null } : row));
      }
    } catch {
      setLeads(prev);
    }
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

  const filteredLeads = [...leads]
    .filter((l) => !leadsSearch || [l.name, l.email, l.phone_e164].join(" ").toLowerCase().includes(leadsSearch.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

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
        <button onClick={() => setTab("leads")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === "leads" ? "bg-yellow-500/20 text-yellow-400" : "bg-white/5 text-white/50 hover:text-white/80"}`}>
          <span className="flex items-center gap-2"><Mail size={14} /> Leads ({leads.length})</span>
        </button>
        <button onClick={() => setTab("outreach")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === "outreach" ? "bg-yellow-500/20 text-yellow-400" : "bg-white/5 text-white/50 hover:text-white/80"}`}>
          <span className="flex items-center gap-2"><Radio size={14} /> Outreach ({outreachStats.total})</span>
        </button>
      </div>

      {/* Demo Line Tab */}
      {tab === "outreach" && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Contacts", value: outreachStats.total, color: "" },
              { label: "Not Called", value: outreachStats.new, color: "text-white" },
              { label: "Contacted", value: outreachStats.contacted, color: "text-green-400" },
              { label: "Not Interested", value: outreachStats.not_interested, color: "text-red-400" },
            ].map(s => (
              <div key={s.label} className="aurora-card p-4">
                <div className="text-white/40 text-xs mb-1">{s.label}</div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Test call */}
          <div className="aurora-card p-5">
            <h3 className="font-semibold mb-3">Test Cold Call</h3>
            <div className="flex items-center gap-3 flex-wrap">
              <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="Phone (e.g. 0433121933)" className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm w-44" />
              <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Name" className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm w-36" />
              <input value={testBusiness} onChange={e => setTestBusiness(e.target.value)} placeholder="Business" className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm w-44" />
              <button
                disabled={testDialing || !testPhone}
                onClick={async () => {
                  setTestDialing(true);
                  try {
                    await fetch(`${SUPABASE_URL}/functions/v1/mhv2-outbound-call`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ to: testPhone, name: testName || "there", business: testBusiness || "your business", category: "test" }),
                    });
                  } catch {}
                  setTimeout(() => setTestDialing(false), 4000);
                }}
                className="px-4 py-2 rounded-xl bg-yellow-500/20 text-yellow-400 text-sm font-medium hover:bg-yellow-500/30 disabled:opacity-50 transition-all"
              >
                {testDialing ? "Calling..." : "📞 Call Now"}
              </button>
            </div>
          </div>

          {/* Queue control panel */}
          <div className="aurora-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Call Queue</h3>
                <p className="text-white/40 text-xs mt-0.5">Jake Outbound — agent_0301m07zpn6eebwvy5p25j7kzeqh</p>
              </div>
              {queueStatus && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-white/50">{queueStatus.done}/{queueStatus.total} done</span>
                  <div className="w-32 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${queueStatus.total ? (queueStatus.done / queueStatus.total) * 100 : 0}%` }} />
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${queueRunning ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"}`}>
                    {queueRunning ? "● Running" : "Stopped"}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <select value={queueCategory} onChange={e => setQueueCategory(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none">
                <option value="all">All categories</option>
                {["plumber","painter","tiler","plasterer","electrician","locksmith","handyman","landscaper","carpenter","roofer"].map(c => (
                  <option key={c} value={c} className="capitalize">{c}</option>
                ))}
              </select>
              <select value={queueLimit} onChange={e => setQueueLimit(Number(e.target.value))} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none">
                {[25,50,100,200,500].map(n => <option key={n} value={n}>{n} contacts</option>)}
              </select>
              <button
                disabled={queuing}
                onClick={async () => {
                  setQueuing(true);
                  try {
                    const res = await fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin/queue`, {
                      method: "POST",
                      headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
                      body: JSON.stringify({ category: queueCategory, status: "new", limit: queueLimit }),
                    });
                    const d = await res.json();
                    setQueueStatus({ pending: d.queued, done: 0, total: d.queued });
                    setQueueRunning(false);
                  } catch {}
                  setQueuing(false);
                }}
                className="px-4 py-2 rounded-xl bg-yellow-500/20 text-yellow-400 text-sm font-medium hover:bg-yellow-500/30 disabled:opacity-50 transition-all"
              >
                {queuing ? "Queuing..." : "💼 Queue Calls"}
              </button>
              <button
                onClick={async () => {
                  const res = await fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin/queue`, {
                    headers: { "x-admin-token": ADMIN_TOKEN },
                  });
                  const d = await res.json();
                  setQueueStatus({ pending: d.pending, done: d.done, total: d.total });
                }}
                className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-all"
              >
                Check Status
              </button>
              <button
                onClick={async () => {
                  if (!confirm("Clear the entire call queue?")) return;
                  await fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin/queue`, {
                    method: "POST",
                    headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
                    body: JSON.stringify({ clear: true }),
                  });
                  setQueueStatus({ pending: 0, done: 0, total: 0 });
                  setQueueRunning(false);
                }}
                className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-all"
              >
                Clear Queue
              </button>
            </div>
          </div>

          {/* Outbound call log */}
          {outboundCalls.length > 0 && (
            <div className="aurora-card overflow-hidden">
              <div className="p-4 border-b border-white/10 font-semibold text-sm">Jake Outbound — Recent Calls</div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 text-white/40 text-xs uppercase">
                  <th className="text-left p-3">Date</th><th className="text-left p-3">Duration</th><th className="text-left p-3">Status</th><th className="text-left p-3">Summary</th>
                </tr></thead>
                <tbody>
                  {outboundCalls.map(c => (
                    <tr key={c.id} className="border-b border-white/5">
                      <td className="p-3 text-xs text-white/60">{c.started_at ? new Date(c.started_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="p-3 text-xs">{c.duration_seconds != null ? `${c.duration_seconds}s` : "—"}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${c.status === "done" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"}`}>{c.status}</span></td>
                      <td className="p-3 text-xs text-white/50 max-w-xs">{c.transcript_summary || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contact list */}
          <div className="aurora-card overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={outreachSearch} onChange={e => setOutreachSearch(e.target.value)} placeholder="Search contacts..." className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
              </div>
              <select value={outreachFilter} onChange={e => setOutreachFilter(e.target.value)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none">
                <option value="all">All</option>
                <option value="new">Not called</option>
                <option value="contacted">Contacted</option>
                <option value="not_interested">Not interested</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                  <th className="text-left p-4">Business</th>
                  <th className="text-left p-4">Category</th>
                  <th className="text-left p-4">Location</th>
                  <th className="text-left p-4">Rating</th>
                  <th className="text-left p-4">Status</th>
                  <th className="p-4"></th>
                </tr></thead>
                <tbody>
                  {outreachContacts
                    .filter(c => outreachFilter === "all" || c.status === outreachFilter)
                    .filter(c => !outreachSearch || [c.business, c.name, c.city, c.category].join(" ").toLowerCase().includes(outreachSearch.toLowerCase()))
                    .slice(0, 2000)
                    .map(c => (
                    <tr key={c.id} className="border-b border-white/5 hover:bg-white/3">
                      <td className="p-4">
                        <div className="font-medium">{c.business}</div>
                        <div className="text-white/40 text-xs font-mono">{c.phone}</div>
                      </td>
                      <td className="p-4 capitalize text-white/60 text-xs">{c.category}</td>
                      <td className="p-4 text-white/60 text-xs">{c.city}</td>
                      <td className="p-4 text-xs">{c.rating ? <span>⭐ {c.rating} <span className="text-white/30">({c.reviews})</span></span> : "—"}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          c.status === "contacted" ? "bg-green-500/20 text-green-400" :
                          c.status === "not_interested" ? "bg-red-500/20 text-red-400" :
                          "bg-white/10 text-white/40"
                        }`}>{c.status === "new" ? "not called" : c.status}</span>
                      </td>
                      <td className="p-4">
                        <button
                          disabled={dialingId === c.id}
                          onClick={async () => {
                            setDialingId(c.id);
                            try {
                              const SRK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.R2zD0a-_2uU12EMQ2O_LBzJah0Cx9NulrJswpI1iQkI";
                              await fetch("https://qpmwjkcxfyreudexawpw.supabase.co/rest/v1/outreach_call_queue", {
                                method: "POST",
                                headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": "application/json", Prefer: "return=minimal" },
                                body: JSON.stringify({ contact_id: c.id, name: c.name, phone: c.phone, business: c.business, category: c.category, status: "pending", position: 999 }),
                              });
                            } catch {}
                            setTimeout(() => setDialingId(null), 1000);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/60 hover:bg-yellow-500/20 hover:text-yellow-400 disabled:opacity-30 transition-all"
                        >
                          {dialingId === c.id ? "Added ✓" : "+ Queue"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "demo" && (
        <div className="space-y-6">

        {/* Agent editor */}
        <div className="aurora-card p-5">
          <h3 className="font-semibold mb-4">Jake — Demo Agent Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Greeting (first thing Jake says)</label>
              <textarea value={demoGreeting} onChange={e => setDemoGreeting(e.target.value)} rows={2}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm resize-none" />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1.5">System Prompt</label>
              <textarea value={demoPrompt} onChange={e => setDemoPrompt(e.target.value)} rows={8}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm resize-none font-mono text-xs" />
            </div>
            <button
              disabled={savingAgent}
              onClick={async () => {
                setSavingAgent(true);
                try {
                  await fetch(`${SUPABASE_URL}/functions/v1/mhv2-admin/agent`, {
                    method: "PATCH",
                    headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "application/json" },
                    body: JSON.stringify({ first_message: demoGreeting, prompt: demoPrompt }),
                  });
                } catch {}
                setSavingAgent(false);
              }}
              className="btn-primary"
            >
              {savingAgent ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Call log */}
        <div className="aurora-card overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <PhoneCall size={16} className="text-yellow-400" />
              <div>
                <div className="font-semibold">Inbound Calls — +61 485 021 312</div>
                <div className="text-white/40 text-xs">agent_4701kzv3pb8sfkwrdbja7s22rk75</div>
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
        </div>
      )}

      {tab === "leads" && (
          <div className="aurora-card overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={leadsSearch} onChange={e => setLeadsSearch(e.target.value)} placeholder="Search name, email, phone..." className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                    <th className="text-left p-4">Name</th>
                    <th className="text-left p-4">Email</th>
                    <th className="text-left p-4">Phone</th>
                    <th className="text-left p-4">Requested</th>
                    <th className="text-left p-4">Demo call</th>
                    <th className="text-left p-4">Follow-up email</th>
                    <th className="text-left p-4">Follow-up call</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-white/30">No /try leads yet</td></tr>
                  )}
                  {filteredLeads.map((l) => (
                    <tr key={l.id} className="border-b border-white/5 hover:bg-white/3">
                      <td className="p-4 font-medium">{l.name}</td>
                      <td className="p-4 text-white/70">{l.email}</td>
                      <td className="p-4 font-mono text-xs">{l.phone_e164}</td>
                      <td className="p-4 text-white/70 text-xs">{fmtDateTime(l.created_at)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          l.status === "calling" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"
                        }`}>{l.status}</span>
                      </td>
                      <td className="p-4 text-xs">
                        {l.followup_email_sent_at
                          ? <span className="text-green-400">Sent <span className="text-white/40">{fmtDateTime(l.followup_email_sent_at)}</span></span>
                          : <span className="text-white/40">Not sent</span>}
                      </td>
                      <td className="p-4">
                        {l.followup_called_at
                          ? <div className="flex items-center gap-2">
                              <span className="text-xs text-white/70">{fmtDateTime(l.followup_called_at)}</span>
                              <button
                                onClick={() => setFollowupCalled(l.id, false)}
                                className="px-2 py-1 rounded-lg text-xs bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 transition-all"
                              >
                                Unmark
                              </button>
                            </div>
                          : <button
                              onClick={() => setFollowupCalled(l.id, true)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-all"
                            >
                              Mark called
                            </button>}
                      </td>
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
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${SUPABASE_URL}/functions/v1/mh-v2-auth`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw' },
                                  body: JSON.stringify({ action: 'admin-assume', secret: ADMIN_PIN, customer_id: c.id }),
                                });
                                const data = await res.json();
                                if (data.token) {
                                  meCache.clear();
                                  setToken(data.token);
                                  window.location.href = '/';
                                } else {
                                  alert(data.error || 'Failed to assume account');
                                }
                              } catch (err) {
                                alert('Error: ' + err);
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 text-xs font-medium transition-colors"
                          >
                            🔑 Assume Account
                          </button>
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
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-white/30">No accounts found</td></tr>}
            </tbody>
          </table>
        </div>
      </div></> }
    </div>
  );
}
