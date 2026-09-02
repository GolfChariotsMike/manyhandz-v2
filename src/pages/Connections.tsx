import { useState, useEffect } from "react";
import { Plug, CheckCircle, AlertCircle, RefreshCw, Trash2, Loader2, Bot, Copy, Check, KeyRound, ExternalLink } from "lucide-react";
import { generateGrokbotKey, getGrokbotKey, getMe, getVoiceConfig, revokeGrokbotKey, saveVoiceNotifySms, updateProfile } from "../lib/api";
import { notifyMobilePlaceholder } from "../lib/onboarding";
import { notifyChannelOn, notifyEmailPayloadFromForm, notifySmsSettingsPayload } from "../lib/notify-settings";

const GROK_BOT_DOWNLOAD_URL = "https://x.ai/bot";
const GROK_BOT_MCP_URL = "https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-grokbot/mcp";

function grokBotPasteLine(rawKey: string | null) {
  const auth = rawKey
    ? `Authorization: Bearer ${rawKey}`
    : "Authorization: Bearer (paste the mh_live_ key you copied when you generated it)";
  return `Add a custom connector named ManyHandz. MCP URL: ${GROK_BOT_MCP_URL} ${auth}`;
}

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

function GrokBotSetupSteps({
  rawKey,
  copied,
  onCopy,
}: {
  rawKey: string | null;
  copied: "key" | "paste" | null;
  onCopy: (value: string, which: "key" | "paste") => void;
}) {
  const paste = grokBotPasteLine(rawKey);
  return (
    <div className="space-y-3">
      <ol className="text-white/70 text-sm space-y-1.5 list-decimal pl-5">
        <li>Download Grok Bot</li>
        <li>Start a new bot</li>
        <li>Copy this into Grok Bot</li>
      </ol>
      <div>
        <p className="text-white/40 text-xs mb-1">Copy this into Grok Bot</p>
        <div className="flex gap-2">
          <code className="flex-1 bg-black/40 border border-yellow-500/20 rounded-xl px-3 py-2.5 text-white/80 text-xs break-all">
            {paste}
          </code>
          <button
            type="button"
            onClick={() => onCopy(paste, "paste")}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/20 text-yellow-300 text-sm hover:bg-yellow-500/30 transition-all"
          >
            {copied === "paste" ? <Check size={14} /> : <Copy size={14} />}
            {copied === "paste" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <p className="text-white/40 text-xs">
        Connect Gmail or Outlook inside Grok Bot, not here.
      </p>
    </div>
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
  try {
    const data = await callFn("mhv2-crm-connections", { customer_id: customerId, action: "list" });
    if (Array.isArray(data.connections)) return data.connections;
  } catch { /* function not deployed yet — fall back to REST */ }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mh_crm_connections?customer_id=eq.${customerId}&is_active=eq.true&select=id,platform,last_synced_at,jobs_synced_count`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  const rows = await res.json();
  return Array.isArray(rows)
    ? rows
    : [];
}

interface Connection {
  id: string;
  platform: string;
  last_synced_at: string | null;
  jobs_synced_count: number;
  account_name?: string | null;
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
  const [copied, setCopied] = useState<"key" | "paste" | null>(null);

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

  async function copyText(value: string, which: "key" | "paste") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the text and copy it manually.");
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
              onClick={() => copyText(rawKey, "key")}
              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/20 text-yellow-300 text-sm hover:bg-yellow-500/30 transition-all"
            >
              {copied === "key" ? <Check size={14} /> : <Copy size={14} />}
              {copied === "key" ? "Copied" : "Copy"}
            </button>
          </div>
          <GrokBotSetupSteps
            rawKey={rawKey}
            copied={copied}
            onCopy={copyText}
          />
        </div>
      ) : connected ? (
        <div className="space-y-3">
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
          <GrokBotSetupSteps
            rawKey={null}
            copied={copied}
            onCopy={copyText}
          />
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
            Generate a key, then copy the setup line into Grok Bot. Connect Gmail or Outlook inside Grok Bot, not here.
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

function NotifyToggle({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-10 h-6 rounded-full transition-colors shrink-0 relative ${
        on ? "bg-yellow-500" : "bg-white/10"
      }`}
      aria-pressed={on}
      aria-label={label}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
        on ? "left-5" : "left-1"
      }`} />
    </button>
  );
}

function SimproNotifySettings({
  customer,
  voice,
}: {
  customer: { email?: string | null; country?: string | null; notify_email?: string | null; notify_email_enabled?: boolean | null } | null;
  voice: { notify_sms?: string | null; notify_sms_enabled?: boolean | null } | null;
}) {
  const [email, setEmail] = useState(customer?.notify_email || "");
  const [emailOn, setEmailOn] = useState(notifyChannelOn(customer?.notify_email_enabled));
  const [sms, setSms] = useState(voice?.notify_sms || "");
  const [smsOn, setSmsOn] = useState(notifyChannelOn(voice?.notify_sms_enabled));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail(customer?.notify_email || "");
    setEmailOn(notifyChannelOn(customer?.notify_email_enabled));
  }, [customer?.notify_email, customer?.notify_email_enabled]);

  useEffect(() => {
    setSms(voice?.notify_sms || "");
    setSmsOn(notifyChannelOn(voice?.notify_sms_enabled));
  }, [voice?.notify_sms, voice?.notify_sms_enabled]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateProfile(notifyEmailPayloadFromForm(email, emailOn));
      const smsRow = await saveVoiceNotifySms(notifySmsSettingsPayload(sms, smsOn, customer?.country));
      const savedSms = smsRow?.voice?.notify_sms;
      if (typeof savedSms === "string" || savedSms === null) setSms(savedSms || "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save alerts");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
      <div>
        <h3 className="text-white font-medium text-sm">Office alerts</h3>
        <p className="text-white/40 text-xs mt-1">
          These alerts fire when Charlie creates a SimPRO lead, and when someone leaves a message (SMS). Login email stays for signing in. Turn a channel off to skip it without deleting the address or number.
        </p>
      </div>

      <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
        <NotifyToggle on={emailOn} label="Notification email" onToggle={() => setEmailOn((v) => !v)} />
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium block mb-1">Notification email</label>
          <p className="text-xs text-white/40 mb-2">
            Lead-alert address. Off = do not email, even if a login email exists.
            {emailOn && !email.trim() && customer?.email
              ? ` Empty falls back to ${customer.email}.`
              : ""}
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!emailOn}
            placeholder={customer?.email || "office@yourbusiness.com"}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50 disabled:opacity-40"
          />
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
        <NotifyToggle on={smsOn} label="Notification SMS" onToggle={() => setSmsOn((v) => !v)} />
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium block mb-1">Notification SMS</label>
          <p className="text-xs text-white/40 mb-2">
            Office mobile for lead and take-a-message texts. Off = no office SMS. We never text the caller on this number.
          </p>
          <input
            type="tel"
            value={sms}
            onChange={(e) => setSms(e.target.value)}
            disabled={!smsOn}
            placeholder={notifyMobilePlaceholder(customer?.country)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50 disabled:opacity-40"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-500/20 text-yellow-300 text-sm font-medium hover:bg-yellow-500/30 transition-all disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
        {saved ? "Saved!" : saving ? "Saving..." : "Save alerts"}
      </button>
    </div>
  );
}

export default function Connections() {
  const [customerId, setCustomerId] = useState("");
  const [customer, setCustomer] = useState<{
    id?: string;
    email?: string | null;
    country?: string | null;
    notify_email?: string | null;
    notify_email_enabled?: boolean | null;
  } | null>(null);
  const [voice, setVoice] = useState<{ notify_sms?: string | null; notify_sms_enabled?: boolean | null } | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [_loading, setLoading] = useState(true);

  // SimPRO form state
  const [simproBuildUrl, setSimproBuildUrl] = useState("");
  const [simproAccessToken, setSimproAccessToken] = useState("");
  const [simpropClientId, setSimpropClientId] = useState("");
  const [simpropClientSecret, setSimpropClientSecret] = useState("");
  const [simpropLoading, setSimpropLoading] = useState(false);
  const [simpropError, setSimpropError] = useState("");

  const [servicem8ApiKey, setServicem8ApiKey] = useState("");
  const [servicem8Loading, setServicem8Loading] = useState(false);
  const [servicem8Error, setServicem8Error] = useState("");
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState("");

  const [syncMsg, setSyncMsg] = useState("");

  const simpropConn = connections.find(c => c.platform === "simpro");
  const servicem8Conn = connections.find(c => c.platform === "servicem8");
  const googleCalConn = connections.find(c => c.platform === "google_calendar");
  const msCalConn = connections.find(c => c.platform === "microsoft_calendar");
  const xeroConn = connections.find(c => c.platform === "xero");

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
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const err = params.get("error");
    if (connected) {
      setSyncMsg(
        connected === "google_calendar" ? "Google Calendar connected"
          : connected === "microsoft_calendar" ? "Outlook Calendar connected"
          : connected === "xero" ? "Xero connected"
          : "Connected",
      );
      window.history.replaceState({}, "", "/connections");
      setTimeout(() => setSyncMsg(""), 4000);
    } else if (err) {
      setOauthError(
        err === "not_configured"
          ? "That ManyHandz app is not configured yet. Ask ManyHandz support to add the OAuth app."
          : `Could not finish connecting (${err}). Try again or take a message for the team.`,
      );
      window.history.replaceState({}, "", "/connections");
    }
    getMe().then(({ customer: c }) => {
      if (c?.id) {
        setCustomer(c);
        setCustomerId(c.id);
        loadConnections(c.id);
        getVoiceConfig(c.id)
          .then((cfg) => {
            const row = Array.isArray(cfg) ? cfg[0] || null : null;
            setVoice(row);
          })
          .catch(() => setVoice(null));
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
        access_token: simproAccessToken,
        api_key: simproAccessToken,
        client_id: simpropClientId,
        client_secret: simpropClientSecret,
      });
      setSimproBuildUrl(""); setSimproAccessToken(""); setSimpropClientId(""); setSimpropClientSecret("");
      await loadConnections();
    } catch (e: any) {
      setSimpropError(e.message);
    }
    setSimpropLoading(false);
  }

  async function connectServicem8() {
    setServicem8Loading(true);
    setServicem8Error("");
    try {
      await callFn("mhv2-servicem8-connect", {
        customer_id: customerId,
        api_key: servicem8ApiKey,
      });
      setServicem8ApiKey("");
      await loadConnections();
    } catch (e: any) {
      setServicem8Error(e.message);
    }
    setServicem8Loading(false);
  }

  async function startOAuth(fn: string, label: string) {
    setOauthLoading(fn);
    setOauthError("");
    try {
      const data = await callFn(fn, { customer_id: customerId });
      if (!data.url) throw new Error(`Could not start ${label} connect`);
      window.location.href = data.url;
    } catch (e: any) {
      setOauthError(e.message);
      setOauthLoading(null);
    }
  }

  async function disconnect(conn: Connection) {
    if (!confirm(`Disconnect ${conn.platform}? Your synced data will be preserved.`)) return;
    await callFn("mhv2-crm-connections", {
      customer_id: customerId,
      action: "disconnect",
      connection_id: conn.id,
    });
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
              <p className="text-white/40 text-xs">Create a real job from a call — the agent never reads other customers' jobs</p>
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
                <p className="text-white/40 text-xs mb-1">Last checked</p>
                <p className="text-white">{formatDate(simpropConn.last_synced_at)}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
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
              In SimPRO go to <strong>System → Setup → API</strong>. Paste your Build URL and Access Token (API key). Client ID and Client Secret are optional when you use an Access Token. The token is stored encrypted and is never shown again.
            </p>
            <input
              type="text"
              name="simpro-build-url"
              autoComplete="off"
              placeholder="Build URL (e.g. https://acme.simprosuite.com)"
              value={simproBuildUrl}
              onChange={e => setSimproBuildUrl(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="password"
              name="simpro-access-token"
              autoComplete="new-password"
              placeholder="Access Token / API key"
              value={simproAccessToken}
              onChange={e => setSimproAccessToken(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="text"
              name="simpro-client-id"
              autoComplete="off"
              placeholder="Client ID (optional with Access Token)"
              value={simpropClientId}
              onChange={e => setSimpropClientId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="password"
              name="simpro-client-secret"
              autoComplete="new-password"
              placeholder="Client Secret (optional with Access Token)"
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
              disabled={simpropLoading || !simproBuildUrl || !(simproAccessToken || (simpropClientId && simpropClientSecret))}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {simpropLoading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              Connect SimPRO
            </button>
          </div>
        )}

        <SimproNotifySettings customer={customer} voice={voice} />
      </div>

      {/* ServiceM8 Card */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <span className="text-emerald-300 font-bold text-sm">S8</span>
            </div>
            <div>
              <h2 className="text-white font-semibold">ServiceM8</h2>
              <p className="text-white/40 text-xs">Create jobs from a call with your ServiceM8 API key</p>
            </div>
          </div>
          {servicem8Conn ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle size={16} />
              Connected
            </div>
          ) : (
            <span className="text-white/30 text-sm">Not connected</span>
          )}
        </div>

        {servicem8Conn ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-white/40 text-xs mb-1">Last synced</p>
                <p className="text-white">{formatDate(servicem8Conn.last_synced_at)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Jobs synced</p>
                <p className="text-white">{servicem8Conn.jobs_synced_count ?? 0}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => disconnect(servicem8Conn)}
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
              In ServiceM8 go to <strong>Settings → API</strong>, create an API key, then paste it below. ManyHandz tests the key before saving it.
            </p>
            <input
              type="password"
              name="servicem8-api-key"
              autoComplete="new-password"
              placeholder="ServiceM8 API key"
              value={servicem8ApiKey}
              onChange={e => setServicem8ApiKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
            />
            {servicem8Error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {servicem8Error}
              </div>
            )}
            <button
              onClick={connectServicem8}
              disabled={servicem8Loading || !servicem8ApiKey}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {servicem8Loading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              Connect ServiceM8
            </button>
          </div>
        )}
      </div>

      {/* Google Calendar Card */}
      <OauthCard
        title="Google Calendar"
        blurb="Check free/busy and book a real event when a caller wants a time"
        initials="G"
        accent="bg-red-500/20"
        initialsClass="text-red-300"
        connected={googleCalConn}
        accountName={googleCalConn?.account_name}
        lastSynced={googleCalConn?.last_synced_at}
        formatDate={formatDate}
        loading={oauthLoading === "mhv2-google-cal-connect"}
        onConnect={() => startOAuth("mhv2-google-cal-connect", "Google Calendar")}
        onDisconnect={() => googleCalConn && disconnect(googleCalConn)}
      />

      {/* Outlook Calendar Card */}
      <OauthCard
        title="Outlook Calendar"
        blurb="Microsoft 365 calendar — same booking tools as Google Calendar"
        initials="O"
        accent="bg-sky-500/20"
        initialsClass="text-sky-300"
        connected={msCalConn}
        accountName={msCalConn?.account_name}
        lastSynced={msCalConn?.last_synced_at}
        formatDate={formatDate}
        loading={oauthLoading === "mhv2-ms-cal-connect"}
        onConnect={() => startOAuth("mhv2-ms-cal-connect", "Outlook Calendar")}
        onDisconnect={() => msCalConn && disconnect(msCalConn)}
      />

      {/* Xero Card */}
      <OauthCard
        title="Xero"
        blurb="Create a draft sales invoice from a call — never auto-approved"
        initials="X"
        accent="bg-cyan-500/20"
        initialsClass="text-cyan-300"
        connected={xeroConn}
        accountName={xeroConn?.account_name}
        lastSynced={xeroConn?.last_synced_at}
        formatDate={formatDate}
        loading={oauthLoading === "mhv2-xero-connect"}
        onConnect={() => startOAuth("mhv2-xero-connect", "Xero")}
        onDisconnect={() => xeroConn && disconnect(xeroConn)}
      />

      {oauthError && (
        <div className="flex items-center gap-2 text-red-400 text-sm mb-6">
          <AlertCircle size={14} />
          {oauthError}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-2xl border border-white/5 bg-white/3 p-5 text-white/40 text-sm space-y-2">
        <p className="font-medium text-white/60">What your AI can do with connected data:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Create a new SimPRO lead or ServiceM8 job from a phone call or website chat and confirm the number</li>
          <li>Book a real calendar slot when Google or Outlook Calendar is connected</li>
          <li>Raise a Xero draft invoice — the office still approves it</li>
          <li>If a system is not connected, the agent takes a message — it never pretends a job, booking, or invoice was created</li>
        </ul>
      </div>
    </div>
  );
}

function OauthCard({
  title,
  blurb,
  initials,
  accent,
  initialsClass,
  connected,
  accountName,
  lastSynced,
  formatDate,
  loading,
  onConnect,
  onDisconnect,
}: {
  title: string;
  blurb: string;
  initials: string;
  accent: string;
  initialsClass: string;
  connected?: Connection;
  accountName?: string | null;
  lastSynced?: string | null;
  formatDate: (d: string | null) => string;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="glass-card rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${accent} flex items-center justify-center`}>
            <span className={`${initialsClass} font-bold text-sm`}>{initials}</span>
          </div>
          <div>
            <h2 className="text-white font-semibold">{title}</h2>
            <p className="text-white/40 text-xs">{blurb}</p>
          </div>
        </div>
        {connected ? (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle size={16} />
            Connected
          </div>
        ) : (
          <span className="text-white/30 text-sm">Not connected</span>
        )}
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/40 text-xs mb-1">Account</p>
              <p className="text-white">{accountName || "Connected"}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1">Last synced</p>
              <p className="text-white">{formatDate(lastSynced ?? null)}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={onDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-all"
            >
              <Trash2 size={14} />
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-white/50 text-xs">
            Sign in with {title} to connect this shop. If the ManyHandz app is not set up yet, you will get a clear error — the page will not crash.
          </p>
          <button
            onClick={onConnect}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            Connect {title}
          </button>
        </div>
      )}
    </div>
  );
}
