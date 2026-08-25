import { useState, useEffect } from "react";
import { Plug, CheckCircle, AlertCircle, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { getMe } from "../lib/api";

function getToken(): string | null { return localStorage.getItem("mh_token"); }

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
const FN_URL = `${SUPABASE_URL}/functions/v1`;

async function callFn(fn: string, body: unknown) {
  const res = await fetch(`${FN_URL}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getConnections(customerId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mh_crm_connections?customer_id=eq.${customerId}&is_active=eq.true&select=*`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  return res.json();
}

async function disconnectPlatform(connectionId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/mh_crm_connections?id=eq.${connectionId}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ is_active: false }),
  });
}

interface Connection {
  id: string;
  platform: string;
  last_synced_at: string | null;
  jobs_synced_count: number;
}

export default function Connections() {
  const [customerId, setCustomerId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [_loading, setLoading] = useState(true);

  // SimPRO form state
  const [simproBuildUrl, setSimproBuildUrl] = useState("");
  const [simpropClientId, setSimpropClientId] = useState("");
  const [simpropClientSecret, setSimpropClientSecret] = useState("");
  const [simpropLoading, setSimpropLoading] = useState(false);
  const [simpropError, setSimpropError] = useState("");

  // Tradify form state
  const [tradifyApiKey, setTradifyApiKey] = useState("");
  const [tradifyLoading, setTradifyLoading] = useState(false);
  const [tradifyError, setTradifyError] = useState("");

  // Sync state
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");

  const simpropConn = connections.find(c => c.platform === "simpro");
  const tradifyConn = connections.find(c => c.platform === "tradify");

  async function loadConnections(cid?: string) {
    setLoading(true);
    try {
      const id = cid || customerId;
      if (!id) return;
      const data = await getConnections(id);
      setConnections(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    getMe().then(({ customer }) => {
      if (customer?.id) {
        setCustomerId(customer.id);
        loadConnections(customer.id);
      }
    }).catch(() => setLoading(false));
  }, []);

  async function connectSimpro() {
    setSimpropLoading(true);
    setSimpropError("");
    try {
      await callFn("mhv2-simpro-connect", {
        customer_id: customerId,
        build_url: simproBuildUrl,
        client_id: simpropClientId,
        client_secret: simpropClientSecret,
      });
      setSimproBuildUrl(""); setSimpropClientId(""); setSimpropClientSecret("");
      await loadConnections();
    } catch (e: any) {
      setSimpropError(e.message);
    }
    setSimpropLoading(false);
  }

  async function connectTradify() {
    setTradifyLoading(true);
    setTradifyError("");
    try {
      await callFn("mhv2-tradify-connect", {
        customer_id: customerId,
        api_key: tradifyApiKey,
      });
      setTradifyApiKey("");
      await loadConnections();
    } catch (e: any) {
      setTradifyError(e.message);
    }
    setTradifyLoading(false);
  }

  async function syncNow(platform: string) {
    setSyncingPlatform(platform);
    setSyncMsg("");
    try {
      const fn = platform === "simpro" ? "mhv2-simpro-sync" : "mhv2-tradify-sync";
      const result = await callFn(fn, { customer_id: customerId });
      setSyncMsg(`Synced ${result.synced || 0} jobs`);
      await loadConnections();
    } catch (e: any) {
      setSyncMsg(`Sync error: ${e.message}`);
    }
    setSyncingPlatform(null);
    setTimeout(() => setSyncMsg(""), 4000);
  }

  async function disconnect(conn: Connection) {
    if (!confirm(`Disconnect ${conn.platform}? Your synced data will be preserved.`)) return;
    await disconnectPlatform(conn.id);
    await loadConnections();
  }

  function formatDate(d: string | null) {
    if (!d) return "Never";
    return new Date(d).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Plug size={24} className="text-yellow-400" />
          Connections
        </h1>
        <p className="text-white/50 mt-1 text-sm">
          Connect your job management software so your AI can look up jobs, customers, and quotes in real time.
        </p>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
          {syncMsg}
        </div>
      )}

      {/* SimPRO Card */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <span className="text-blue-300 font-bold text-sm">SP</span>
            </div>
            <div>
              <h2 className="text-white font-semibold">SimPRO</h2>
              <p className="text-white/40 text-xs">Field service management</p>
            </div>
          </div>
          {simpropConn ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle size={16} />
              Connected
            </div>
          ) : (
            <span className="text-white/30 text-sm">Not connected</span>
          )}
        </div>

        {simpropConn ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-white/40 text-xs mb-1">Last synced</p>
                <p className="text-white">{formatDate(simpropConn.last_synced_at)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Jobs synced</p>
                <p className="text-white">{simpropConn.jobs_synced_count ?? 0}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => syncNow("simpro")}
                disabled={syncingPlatform === "simpro"}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/20 text-blue-300 text-sm hover:bg-blue-500/30 transition-all disabled:opacity-50"
              >
                {syncingPlatform === "simpro" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sync Now
              </button>
              <button
                onClick={() => disconnect(simpropConn)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-all"
              >
                <Trash2 size={14} />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-white/50 text-xs mb-4">
              To connect SimPRO, you'll need to create an API user in your SimPRO account. Go to <strong>System → Setup → API</strong>, create a new API user, then enter your Build URL, Client ID and Client Secret below.
            </p>
            <input
              type="text"
              placeholder="Build URL (e.g. https://acme.simprocloud.com)"
              value={simproBuildUrl}
              onChange={e => setSimproBuildUrl(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="text"
              placeholder="Client ID"
              value={simpropClientId}
              onChange={e => setSimpropClientId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={simpropClientSecret}
              onChange={e => setSimpropClientSecret(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            {simpropError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {simpropError}
              </div>
            )}
            <button
              onClick={connectSimpro}
              disabled={simpropLoading || !simproBuildUrl || !simpropClientId || !simpropClientSecret}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {simpropLoading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              Connect SimPRO
            </button>
          </div>
        )}
      </div>

      {/* Tradify Card */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <span className="text-orange-300 font-bold text-sm">TF</span>
            </div>
            <div>
              <h2 className="text-white font-semibold">Tradify</h2>
              <p className="text-white/40 text-xs">Job management for tradespeople</p>
            </div>
          </div>
          {tradifyConn ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle size={16} />
              Connected
            </div>
          ) : (
            <span className="text-white/30 text-sm">Not connected</span>
          )}
        </div>

        {tradifyConn ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-white/40 text-xs mb-1">Last synced</p>
                <p className="text-white">{formatDate(tradifyConn.last_synced_at)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Jobs synced</p>
                <p className="text-white">{tradifyConn.jobs_synced_count ?? 0}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => syncNow("tradify")}
                disabled={syncingPlatform === "tradify"}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/20 text-orange-300 text-sm hover:bg-orange-500/30 transition-all disabled:opacity-50"
              >
                {syncingPlatform === "tradify" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sync Now
              </button>
              <button
                onClick={() => disconnect(tradifyConn)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-all"
              >
                <Trash2 size={14} />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-white/50 text-xs mb-4">
              To connect Tradify, go to <strong>Settings → API</strong> in your Tradify account, copy your API key and paste it below.
            </p>
            <input
              type="password"
              placeholder="Tradify API Key"
              value={tradifyApiKey}
              onChange={e => setTradifyApiKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-orange-500/50"
            />
            {tradifyError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {tradifyError}
              </div>
            )}
            <button
              onClick={connectTradify}
              disabled={tradifyLoading || !tradifyApiKey}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-medium hover:bg-orange-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tradifyLoading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              Connect Tradify
            </button>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-2xl border border-white/5 bg-white/3 p-5 text-white/40 text-sm space-y-2">
        <p className="font-medium text-white/60">What your AI can do with connected data:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Look up job status when a customer calls ("What's the status of my job?")</li>
          <li>Pull customer and site details for smarter email replies</li>
          <li>Reference open quotes and pending work in conversations</li>
          <li>Data syncs every 30 minutes automatically</li>
        </ul>
      </div>
    </div>
  );
}
