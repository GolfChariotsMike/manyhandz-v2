import { useEffect, useState } from "react";
import { Check, Loader, Sparkles } from "lucide-react";
import { getMe, getVoiceConfig } from "../lib/api";
import { AGENT_CAPABILITIES, capsFromConfig, capsSavePayload } from "../lib/capabilities";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";

export default function Capabilities() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [caps, setCaps] = useState<Record<string, boolean>>(() => capsFromConfig(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { customer } = await getMe();
        if (customer?.id) {
          setCustomerId(customer.id);
          const cfg = await getVoiceConfig(customer.id);
          const row = Array.isArray(cfg) ? cfg[0] || null : null;
          setConfig(row);
          setCaps(capsFromConfig(row));
        }
      } catch (e: unknown) {
        console.error("Capabilities load:", e instanceof Error ? e.message : e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveCaps() {
    const id = typeof config?.id === "string" ? config.id : "";
    if (!id) return;
    setSaving(true);
    try {
      const payload = capsSavePayload(caps);
      await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${id}`, {
        method: "PATCH",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await fetch(`${SUPABASE_URL}/functions/v1/mh-sync-agent`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId }),
      }).catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-white/50">Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1 flex items-center gap-3">
        <Sparkles size={28} className="text-yellow-400" />
        Capabilities
      </h1>
      <p className="text-white/50 mb-8">
        What Charlie is allowed to do on phone calls and website chat. Same settings for both.
      </p>

      <div className="aurora-card p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Agent capabilities</h3>
          <button
            onClick={saveCaps}
            disabled={saving || !config?.id}
            className="text-xs px-3 py-1.5 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded-lg transition disabled:opacity-50"
          >
            {saved ? "Saved ✓" : saving ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-white/40 mb-4">
          Controls what your agent is allowed to do on phone calls and website chat. Changes sync to the agent immediately. Callers hear faint typing while the agent looks something up.
        </p>
        {!config?.id && (
          <p className="text-sm text-white/40 mb-4">
            Provision a number on Voice first so we have a settings row to save.
          </p>
        )}
        <div className="space-y-3">
          {AGENT_CAPABILITIES.map((c) => (
            <div key={c.key} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => setCaps((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                className={`mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 relative ${
                  caps[c.key] ? "bg-yellow-500" : "bg-white/10"
                }`}
                aria-pressed={caps[c.key]}
                aria-label={c.label}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  caps[c.key] ? "left-5" : "left-1"
                }`} />
              </button>
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-white/40">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
        {saving && (
          <p className="text-xs text-white/30 mt-4 flex items-center gap-2">
            <Loader size={12} className="animate-spin" /> Saving…
          </p>
        )}
        {saved && (
          <p className="text-xs text-green-400 mt-4 flex items-center gap-2">
            <Check size={12} /> Synced to Charlie.
          </p>
        )}
      </div>
    </div>
  );
}
