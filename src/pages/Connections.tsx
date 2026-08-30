import { useState, useEffect } from "react";
import { Plug, CheckCircle, AlertCircle, RefreshCw, Trash2, Loader2, Bot, Copy, Check, KeyRound, ExternalLink } from "lucide-react";
import { generateGrokbotKey, getGrokbotKey, getMe, revokeGrokbotKey } from "../lib/api";

const GROK_BOT_DOWNLOAD_URL = "https://x.ai/bot";

function DownloadGrokBotLink() {
  return (
    <a
      href={GROK_BOT_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/80 text-sm hover:bg-white/10 hover:text-white transition-all"
    >
      <ExternalLink size={14} />
      Download Grok Bot
    </a>
  );
}

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

type GrokbotStatus = {
  connected: boolean;
  key: {
    masked: string;
    label: string | null;
    created_at: string;
    last_used_at: string | null;
  } | null;
};

function GrokBotCard() {
  const [status, setStatus] = useState<GrokbotStatus | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    try {
      const data = await getGrokbotKey();
      setStatus({ connected: !!data.connected, key: data.key || null });
    } catch {
      setStatus({ connected: false, key: null });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const data = await generateGrokbotKey();
      if (!data.key) throw new Error("Key was not returned");
      setRawKey(data.key);
      setStatus({
        connected: true,
        key: {
          masked: data.masked,
          label: "Grok Bot",
          created_at: new Date().toISOString(),
          last_used_at: null,
        },
      });
    } catch (e: any) {
      setError(e.message || "Could not generate key");
    }
    setBusy(false);
  }

  async function revoke() {
    if (!confirm("Revoke the Grok Bot key? Chat will stop being able to change voice settings and the knowledge base until you generate a new one.")) return;
    setBusy(true);
    setError("");
    try {
      await revokeGrokbotKey();
      setRawKey(null);
      setStatus({ connected: false, key: null });
    } catch (e: any) {
      setError(e.message || "Could not revoke key");
    }
    setBusy(false);
  }

  async function regenerate() {
    if (!confirm("Regenerate the Grok Bot key? The current key stops working immediately.")) return;
    setRawKey(null);
    await generate();
  }

  async function copyKey() {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the key and copy it manually.");
    }
  }

  function formatDate(d: string | null) {
    if (!d) return "Never";
    return new Date(d).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  }

  const connected = status?.connected && status.key;

  return (
    <div className="glass-card rounded-2xl p-6 mb-6 border border-yellow-500/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
            <Bot size={18} className="text-yellow-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold">Grok Bot</h2>
            <p className="text-white/40 text-xs">Inbox, knowledge base, and voice</p>
          </div>
        </div>
        {loading ? (
          <Loader2 size={16} className="animate-spin text-white/30" />
        ) : connected ? (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} />
            Connected
          </div>
        ) : (
          <span className="text-white/30 text-sm">Not connected</span>
        )}
      </div>

      <p className="text-white/55 text-sm leading-relaxed mb-4">
        Inbox work happens in Grok Bot with your own Gmail or Outlook. Generate a ManyHandz key so Grok can use this dashboard&apos;s knowledge base and voice settings. Connect Gmail or Outlook inside Grok Bot, not here.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <DownloadGrokBotLink />
        {!loading && !connected && !rawKey && (
          <button
            onClick={generate}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-500 text-[#0f1f3d] text-sm font-semibold hover:bg-yellow-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Generate key
          </button>
        )}
      </div>
      <p className="text-white/40 text-xs mt-2 mb-4">
        Mac, Windows, iPhone, and Android
      </p>

      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : rawKey ? (
        <div className="space-y-3">
          <p className="text-amber-300/90 text-xs bg-amber-400/5 border border-amber-400/20 rounded-xl px-3 py-2">
            Copy this key now. ManyHandz only stores a hash — it cannot be shown again.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-yellow-300 text-xs break-all font-mono">
              {rawKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/20 text-yellow-300 text-sm hover:bg-yellow-500/30 transition-all"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-white/50 text-xs">
            In Grok Bot, open the ManyHandz connector and paste this API key, then connect Gmail or Outlook there. Grok can use this knowledge base and change greeting, voice, capabilities, and whitelist — it does not answer your phone.
          </p>
        </div>
      ) : connected ? (
        <div className="space-y-3">
          <p className="text-white/50 text-xs">
            Connect Gmail or Outlook inside Grok Bot. This key lets Grok use the knowledge base and voice settings from this dashboard.
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/40 text-xs mb-1">API key</p>
              <p className="text-white font-mono text-sm">{status!.key!.masked}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1">Last used</p>
              <p className="text-white">{formatDate(status!.key!.last_used_at)}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={regenerate}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/20 text-yellow-300 text-sm hover:bg-yellow-500/30 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Regenerate
            </button>
            <button
              onClick={revoke}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              <Trash2 size={14} />
              Revoke
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-white/50 text-xs">
            Generate a key, paste it into the ManyHandz connector in Grok Bot, and connect Gmail or Outlook there.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm mt-3">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  );
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

  // Sync state
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");

  const simpropConn = connections.find(c => c.platform === "simpro");

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

  async function syncNow(platform: string) {
    setSyncingPlatform(platform);
    setSyncMsg("");
    try {
      const result = await callFn("mhv2-simpro-sync", { customer_id: customerId });
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
          Connect Grok Bot for inbox and knowledge base, plus your job management software. ManyHandz stays the source of truth for Voice, Chat, and Grok.
        </p>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
          {syncMsg}
        </div>
      )}

      <GrokBotCard />

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
              name="simpro-build-url"
              autoComplete="off"
              placeholder="Build URL (e.g. https://acme.simprocloud.com)"
              value={simproBuildUrl}
              onChange={e => setSimproBuildUrl(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="text"
              name="simpro-client-id"
              autoComplete="off"
              placeholder="Client ID"
              value={simpropClientId}
              onChange={e => setSimpropClientId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="password"
              name="simpro-client-secret"
              autoComplete="new-password"
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
