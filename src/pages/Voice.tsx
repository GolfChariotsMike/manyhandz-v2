import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getMe, getVoiceCalls, getVoiceConfig } from "../lib/api";
import { provisionNumberBody } from "../lib/onboarding";
import { VOICES } from "../lib/voices";
import { aiNamePlaceholder, aiNameSavePayload, resolveAiName } from "../lib/ai-name";
import {
  previewVoiceSettings,
  updateAgentVoicePayload,
  voiceConfigDbPatch,
  voiceControlsFromConfig,
  type TurnEagerness,
  type VoiceControls,
} from "../lib/voice-controls";
import { Phone, PhoneIncoming, Plus, Trash2, Play, Pause, Check, Loader, ChevronDown, ChevronUp } from "lucide-react";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const EL_PROXY = `${SUPABASE_URL}/functions/v1/mhv2-el-proxy`;
const PREVIEW_TEXT = "Hi there! Thanks for calling. I'm your AI receptionist — how can I help you today?";

function CallLog({ calls }: { calls: any[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Record<string, any[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function toggleExpand(call: any) {
    const id = call.id;
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (transcript[id] || !call.conversation_id) return;
    setLoadingId(id);
    try {
      const res = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "transcript", conversation_id: call.conversation_id }),
      });
      const data = await res.json();
      setTranscript(t => ({ ...t, [id]: data.transcript || [] }));
    } catch { setTranscript(t => ({ ...t, [id]: [] })); }
    finally { setLoadingId(null); }
  }

  async function playAudio(call: any) {
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null); return;
    }
    if (!call.conversation_id) return;
    audioRef.current?.pause();
    setPlayingId(call.id);
    try {
      const res = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "audio", conversation_id: call.conversation_id }),
      });
      if (!res.ok) throw new Error("No audio");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
      audio.play();
    } catch { setPlayingId(null); }
  }

  function fmt(secs: number) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  return (
    <div className="aurora-card p-6">
      <h3 className="font-semibold mb-4">Recent calls</h3>
      {calls.length === 0 ? (
        <p className="text-white/30 text-sm">No calls yet.</p>
      ) : (
        <div className="space-y-2">
          {calls.map((call: any) => (
            <div key={call.id} className="bg-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleExpand(call)}>
                <PhoneIncoming size={16} className="text-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{call.from_number || "Unknown"}</p>
                  <p className="text-xs text-white/40">
                    {call.started_at ? new Date(call.started_at).toLocaleString() : "—"}
                    {call.duration_seconds ? ` · ${fmt(call.duration_seconds)}` : ""}
                  </p>
                </div>
                {call.conversation_id && (
                  <button onClick={e => { e.stopPropagation(); playAudio(call); }}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition shrink-0">
                    {playingId === call.id ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                )}
                {expandedId === call.id ? <ChevronUp size={14} className="text-white/30 shrink-0" /> : <ChevronDown size={14} className="text-white/30 shrink-0" />}
              </div>
              {expandedId === call.id && (
                <div className="px-3 pb-3 border-t border-white/5 pt-3">
                  {loadingId === call.id ? (
                    <p className="text-xs text-white/30">Loading transcript...</p>
                  ) : !call.conversation_id ? (
                    <p className="text-xs text-white/30">No transcript available.</p>
                  ) : (transcript[call.id] || []).length === 0 ? (
                    <p className="text-xs text-white/30">No transcript yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {(transcript[call.id] || []).map((t: any, i: number) => (
                        <div key={i} className={`text-xs ${t.role === "agent" ? "text-white/60" : "text-white/90"}`}>
                          <span className={`font-semibold mr-1 ${t.role === "agent" ? "text-purple-400" : "text-blue-400"}`}>
                            {t.role === "agent" ? "Agent" : "Caller"}:
                          </span>
                          {t.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapabilitiesSection({ config, customerId, anon, url }: { config: any, customerId: string, anon: string, url: string }) {
  const CAPS = [
    { key: "cap_confirm_bookings", label: "Confirm bookings", desc: "Agent can confirm, reserve or book appointments for callers.", default: false },
    { key: "cap_quote_prices",     label: "Quote prices",    desc: "Agent can quote prices from the knowledge base.", default: false },
    { key: "cap_transfer_calls",   label: "Transfer calls",  desc: "Agent can transfer callers through to staff.", default: true },
    { key: "cap_send_sms",         label: "Send SMS",        desc: "Agent can send text messages to callers with links or info.", default: true },
    // Prompt text lives in src/lib/ai-disclosure.ts — paste aiDisclosurePromptRule() into live mh-sync-agent.
    { key: "cap_disclose_ai",      label: "Say you're AI",   desc: "On the first reply after the greeting, answer the caller and mention you are an AI assistant. Off = do not volunteer it.", default: false },
  ];

  const [caps, setCaps] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const c of CAPS) out[c.key] = config?.[c.key] ?? c.default;
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveCaps() {
    if (!config?.id) return;
    setSaving(true);
    await fetch(`${url}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
      method: "PATCH",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify(caps),
    });
    // Trigger agent resync
    await fetch(`${url}/functions/v1/mh-sync-agent`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    }).catch(() => {});
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="aurora-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Agent capabilities</h3>
        <button onClick={saveCaps} disabled={saving}
          className="text-xs px-3 py-1.5 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded-lg transition disabled:opacity-50">
          {saved ? "Saved ✓" : saving ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="text-xs text-white/40 mb-4">Controls what your agent is allowed to do on calls. Changes sync to the agent immediately.</p>
      <div className="space-y-3">
        {CAPS.map(c => (
          <div key={c.key} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
            <button onClick={() => setCaps(prev => ({ ...prev, [c.key]: !prev[c.key] }))}
              className={`mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 relative ${
                caps[c.key] ? "bg-yellow-500" : "bg-white/10"
              }`}>
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
    </div>
  );
}

function WhitelistSection({ config, anon, url }: { config: any, anon: string, url: string }) {
  const [whitelist, setWhitelist] = useState<string[]>(config?.whitelist || []);
  const [bridge, setBridge] = useState(config?.bridge_to_number || "");
  const [newNum, setNewNum] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function addNumber() {
    const n = newNum.trim();
    if (!n || whitelist.includes(n)) return;
    setWhitelist(prev => [...prev, n]);
    setNewNum("");
  }

  function removeNumber(num: string) {
    setWhitelist(prev => prev.filter(x => x !== num));
  }

  async function handleSave() {
    if (!config?.id) return;
    setSaving(true);
    try {
      await fetch(`${url}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
        method: "PATCH",
        headers: { "apikey": anon, "Authorization": `Bearer ${anon}`, "Content-Type": "application/json" },
        body: JSON.stringify({ whitelist, bridge_to_number: bridge || null }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="aurora-card p-6 mb-8">
      <h3 className="font-semibold mb-1">Whitelist</h3>
      <p className="text-sm text-white/50 mb-4">Numbers on this list bypass the AI and connect directly to your bridge number.</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {whitelist.length === 0 && <span className="text-white/30 text-sm">No whitelisted numbers</span>}
        {whitelist.map(num => (
          <span key={num} className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm flex items-center gap-2">
            {num}
            <button onClick={() => removeNumber(num)} className="text-green-300/50 hover:text-white"><Trash2 size={12} /></button>
          </span>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <input
          value={newNum}
          onChange={e => setNewNum(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addNumber()}
          placeholder="+61400000000"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-white/30 outline-none focus:border-violet-500"
        />
        <button onClick={addNumber} className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} /> Add</button>
      </div>

      <div className="mb-5">
        <label className="text-sm text-white/60 block mb-1">Bridge to number</label>
        <p className="text-xs text-white/30 mb-2">When a whitelisted number calls, the AI will forward them straight to this number.</p>
        <input
          value={bridge}
          onChange={e => setBridge(e.target.value)}
          placeholder="+61400000000"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-white/30 outline-none focus:border-violet-500"
        />
      </div>

      <button onClick={handleSave} disabled={saving || !config?.id} className="btn-primary text-sm flex items-center gap-2">
        {saving ? <Loader size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
        {saved ? "Saved!" : saving ? "Saving..." : "Save whitelist"}
      </button>
    </div>
  );
}

function VoiceSlider({
  label,
  left,
  right,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">{label}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-yellow-400 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer"
      />
      <div className="flex justify-between gap-3 text-xs text-white/40 mt-1">
        <span className="min-w-0">{left}</span>
        <span className="min-w-0 text-right">{right}</span>
      </div>
    </div>
  );
}

function VoiceControlsCard({
  controls,
  onChange,
  onSave,
  saving,
  saved,
  canSave,
}: {
  controls: VoiceControls;
  onChange: (next: VoiceControls) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
}) {
  const eagerness: { key: TurnEagerness; label: string; hint: string }[] = [
    { key: "patient", label: "Patient", hint: "Waits a bit" },
    { key: "normal", label: "Normal", hint: "Everyday pace" },
    { key: "eager", label: "Eager", hint: "Jumps in quick" },
  ];

  return (
    <div className="aurora-card p-6 mb-8">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Voice controls</h3>
        <button
          onClick={onSave}
          disabled={saving || !canSave}
          className="btn-primary text-sm flex items-center gap-2"
        >
          {saving ? <Loader size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? "Saved!" : saving ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="text-sm text-white/40 mb-5">
        How your receptionist sounds on the phone. Hit play on a voice above to hear these settings, then Save.
      </p>

      <div className="space-y-5">
        <VoiceSlider
          label="Stability"
          left="Consistent"
          right="Expressive"
          min={0}
          max={1}
          step={0.05}
          value={1 - controls.tts_stability}
          onChange={n => onChange({ ...controls, tts_stability: Math.round((1 - n) * 100) / 100 })}
        />
        <VoiceSlider
          label="Clarity / similarity"
          left="Softer"
          right="Clearer"
          min={0}
          max={1}
          step={0.05}
          value={controls.tts_similarity}
          onChange={n => onChange({ ...controls, tts_similarity: n })}
        />
        <VoiceSlider
          label="Talking speed"
          left="Slower"
          right="Faster"
          min={0.7}
          max={1.2}
          step={0.05}
          value={controls.tts_speed}
          onChange={n => onChange({ ...controls, tts_speed: n })}
        />

        <div>
          <p className="text-sm font-medium mb-2">How quickly it jumps in</p>
          <div className="grid grid-cols-3 gap-2">
            {eagerness.map(opt => {
              const active = controls.turn_eagerness === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChange({ ...controls, turn_eagerness: opt.key })}
                  className={`rounded-xl px-3 py-2.5 text-left border transition-all ${
                    active
                      ? "border-yellow-400 bg-yellow-500/15"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <p className={`text-sm font-medium ${active ? "text-yellow-300" : ""}`}>{opt.label}</p>
                  <p className="text-xs text-white/40">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Voice() {
  const location = useLocation();
  const isPreview = location.pathname === "/voice-preview";
  const [config, setConfig] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const [activeVoiceId, setActiveVoiceId] = useState<string>("IKne3meq5aSn9XLyUdCD");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [savingGreeting, setSavingGreeting] = useState(false);
  const [greetingSaved, setGreetingSaved] = useState(false);
  const [aiName, setAiName] = useState("");
  const [savingAiName, setSavingAiName] = useState(false);
  const [aiNameSaved, setAiNameSaved] = useState(false);
  const [controls, setControls] = useState<VoiceControls>(() => voiceControlsFromConfig(null));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadData = async () => {
    try {
      const { customer: c } = await getMe();
      setCustomer(c);
      if (c?.id) {
        getVoiceCalls(c.id)
          .then((callLog) => setCalls(Array.isArray(callLog) ? callLog : []))
          .catch(() => {});
        const cfg = await getVoiceConfig(c.id);
        const cfgRow = Array.isArray(cfg) ? cfg[0] || null : null;
        setConfig(cfgRow);
        if (cfgRow?.voice_id) setActiveVoiceId(cfgRow.voice_id);
        if (cfgRow?.greeting_script) setGreeting(cfgRow.greeting_script);
        setAiName(resolveAiName(cfgRow?.ai_name, c?.business_name));
        setControls(voiceControlsFromConfig(cfgRow));
      }
    } catch (e: any) {
      // Auth errors redirect in api.ts; other errors surface quietly
      console.error("Voice loadData:", e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!isPreview) loadData(); else setLoading(false); }, [isPreview]);

  async function handleProvision() {
    if (!customer?.id) { setProvisionError("Could not load your account. Please refresh and try again."); return; }
    setProvisioning(true);
    setProvisionError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mh-provision-number`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify(provisionNumberBody(customer.id, customer.country)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to provision number");
      // Show number immediately, then reload customer data
      if (data.phone_number) setCustomer((c: any) => ({ ...c, twilio_number: data.phone_number }));
      loadData();
    } catch (e: any) {
      setProvisionError(e.message || "Could not provision a number. Please contact support.");
    } finally {
      setProvisioning(false);
    }
  }

  async function handlePreview(voiceId: string) {
    // Stop any current audio
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingId === voiceId) { setPlayingId(null); return; }

    setPreviewingId(voiceId);
    try {
      const res = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({
          action: "preview_tts",
          voice_id: voiceId,
          text: PREVIEW_TEXT,
          voice_settings: previewVoiceSettings(controls),
        }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
      audio.play();
      setPlayingId(voiceId);
    } catch (e) {
      console.error("Preview error:", e);
    } finally {
      setPreviewingId(null);
    }
  }

  async function handleSaveAiName() {
    const payload = aiNameSavePayload(aiName);
    if (!payload || !config?.id || !customer?.id) return;
    setSavingAiName(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await fetch(`${SUPABASE_URL}/functions/v1/mh-sync-agent`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customer.id }),
      }).catch(() => {});
      setAiName(payload.ai_name);
      setConfig((prev: any) => prev ? { ...prev, ai_name: payload.ai_name } : prev);
      setAiNameSaved(true);
      setTimeout(() => setAiNameSaved(false), 2500);
    } catch (e) { console.error("Save AI name error:", e); }
    finally { setSavingAiName(false); }
  }

  async function handleSaveGreeting() {
    const agentId = config?.el_agent_id || customer?.el_agent_id;
    if (!agentId || !greeting.trim()) return;
    setSavingGreeting(true);
    try {
      await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify(updateAgentVoicePayload({
          agentId,
          voiceId: activeVoiceId,
          controls,
          greeting: greeting.trim(),
        })),
      });
      if (config?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
          method: "PATCH",
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ greeting_script: greeting.trim() }),
        });
      }
      setGreetingSaved(true);
      setTimeout(() => setGreetingSaved(false), 2500);
    } catch (e) { console.error("Save greeting error:", e); }
    finally { setSavingGreeting(false); }
  }

  async function handleSaveVoice() {
    const agentId = config?.el_agent_id || customer?.el_agent_id;
    if (!agentId) return;
    setSavingVoice(true);
    try {
      const elRes = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify(updateAgentVoicePayload({
          agentId,
          voiceId: activeVoiceId,
          controls,
        })),
      });
      if (!elRes.ok) throw new Error("Could not update the live agent");
      if (config?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
          method: "PATCH",
          headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(voiceConfigDbPatch(activeVoiceId, controls)),
        });
      }
      setVoiceSaved(true);
      setTimeout(() => setVoiceSaved(false), 2500);
    } catch (e) { console.error("Save voice error:", e); }
    finally { setSavingVoice(false); }
  }

  if (loading) return <div className="text-white/50">Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Voice</h1>
      <p className="text-white/50 mb-8">AI answers your phone calls 24/7.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Phone number */}
        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Phone size={18} className="text-green-400" /> Your Number
          </h3>
          {customer?.twilio_number ? (
            <p className="text-2xl font-bold text-green-400">{customer.twilio_number}</p>
          ) : (
            <div>
              <p className="text-white/50 text-sm mb-3">No number provisioned yet.</p>
              <button
                className="btn-primary text-sm"
                onClick={handleProvision}
                disabled={provisioning}
              >
                {provisioning ? "Provisioning..." : "Provision a number"}
              </button>
              {provisionError && <p className="text-red-400 text-xs mt-2">{provisionError}</p>}
            </div>
          )}
        </div>

        {/* Status */}
        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3">Status</h3>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${config?.active ? "bg-green-400" : "bg-red-400"}`} />
            <span className="text-lg">{config?.active ? "Active" : "Paused"}</span>
          </div>
          <div className="mt-4">
            <label className="text-sm text-white/60 block mb-1">AI name</label>
            <p className="text-xs text-white/30 mb-2">Your receptionist's name on the phone. Greeting stays separate.</p>
            <div className="flex gap-2">
              <input
                value={aiName}
                onChange={e => setAiName(e.target.value)}
                placeholder={aiNamePlaceholder(customer?.business_name)}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-white/30 outline-none focus:border-violet-500"
              />
              <button
                onClick={handleSaveAiName}
                disabled={savingAiName || !aiName.trim() || !config?.id}
                className="btn-primary text-sm flex items-center gap-2 shrink-0"
              >
                {savingAiName ? <Loader size={14} className="animate-spin" /> : aiNameSaved ? <Check size={14} /> : null}
                {aiNameSaved ? "Saved!" : savingAiName ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Go Live */}
      {customer?.twilio_number && (
        <div className="aurora-card p-6 mb-8 border border-yellow-500/20">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <span className="text-yellow-400">🚀</span> Go Live
          </h3>
          <p className="text-sm text-white/40 mb-5">Two ways to get calls to your AI — pick whichever suits you.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Option 1 */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="font-semibold text-sm mb-1">Option 1 — Use this as your main number</p>
              <p className="text-xs text-white/40 mb-3">The simplest option. Put <span className="text-yellow-400 font-mono">{customer.twilio_number}</span> on your website, Google listing, and business cards. The AI answers every call.</p>
              <div className="text-xs text-white/30 space-y-1">
                <p>✓ No setup required</p>
                <p>✓ AI answers 100% of calls</p>
                <p>✓ Best for new businesses or a fresh start</p>
              </div>
            </div>

            {/* Option 2 */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="font-semibold text-sm mb-1">Option 2 — Forward your existing number</p>
              <p className="text-xs text-white/40 mb-4">Keep your current number. Set it to forward unanswered calls to <span className="text-yellow-400 font-mono">{customer.twilio_number}</span> — the AI picks up anything you miss.</p>

              <div className="space-y-3 text-xs">
                <div className="bg-black/30 rounded-lg px-3 py-2.5">
                  <p className="text-white/60 font-semibold mb-1">📱 iPhone</p>
                  <p className="text-white/40">Settings → Phone → Call Forwarding → turn on → enter <span className="text-yellow-300 font-mono">{customer.twilio_number}</span></p>
                </div>
                <div className="bg-black/30 rounded-lg px-3 py-2.5">
                  <p className="text-white/60 font-semibold mb-1">🤖 Android</p>
                  <p className="text-white/40">Phone app → ⋮ Menu → Settings → Calls → Call Forwarding → Forward when unanswered → enter <span className="text-yellow-300 font-mono">{customer.twilio_number}</span></p>
                  <p className="text-white/25 mt-1">Note: exact path varies by manufacturer (Samsung, Pixel, etc.)</p>
                </div>
              </div>

              <p className="text-xs text-amber-400/70 mt-3 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2">
                ⚠️ Some carriers don't support call forwarding on certain plans (e.g. basic prepaid). If the option is greyed out or missing, contact your carrier to check.
              </p>
              <p className="text-xs text-white/30 mt-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                💡 <span className="text-white/50">Quick test:</span> Try calling <span className="text-yellow-300 font-mono">{customer.twilio_number}</span> directly. If your AI answers, your agent is working. If forwarding still doesn't work after that, it's almost certainly a carrier restriction on your plan.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Greeting */}
      <div className="aurora-card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Greeting</h3>
            <p className="text-sm text-white/40 mt-0.5">What your AI says when it picks up the phone.</p>
          </div>
          <button
            onClick={handleSaveGreeting}
            disabled={savingGreeting || !greeting.trim() || (!config?.el_agent_id && !customer?.el_agent_id)}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {savingGreeting ? <Loader size={14} className="animate-spin" /> : greetingSaved ? <Check size={14} /> : null}
            {greetingSaved ? "Saved!" : savingGreeting ? "Saving..." : "Save"}
          </button>
        </div>
        <textarea
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 resize-none focus:outline-none focus:border-violet-500 transition-colors"
          rows={3}
          placeholder={`Hey, thanks for calling ${customer?.business_name || 'us'}! How can I help you today?`}
          value={greeting}
          onChange={e => setGreeting(e.target.value)}
        />
        <p className="text-xs text-white/30 mt-2">Keep it natural and under 2 sentences. The AI will take it from there.</p>
      </div>

      {/* Voice Picker */}
      <div className="aurora-card p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold">AI Voice</h3>
            <p className="text-sm text-white/40 mt-0.5">Pick a voice for your receptionist. Hit play to hear a sample.</p>
          </div>
          <button
            onClick={handleSaveVoice}
            disabled={savingVoice || (!config?.el_agent_id && !customer?.el_agent_id)}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {savingVoice ? <Loader size={14} className="animate-spin" /> : voiceSaved ? <Check size={14} /> : null}
            {voiceSaved ? "Saved!" : savingVoice ? "Saving..." : "Save voice"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {VOICES.map(v => {
            const isActive = activeVoiceId === v.id;
            const isPreviewing = previewingId === v.id;
            const isPlaying = playingId === v.id;
            return (
              <div
                key={v.id}
                onClick={() => setActiveVoiceId(v.id)}
                className={`relative flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
                  isActive
                    ? "border-violet-500 bg-violet-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                {/* Selected indicator */}
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-all ${
                  isActive ? "border-violet-400 bg-violet-400" : "border-white/30"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{v.name}</span>
                    <span className="text-xs text-white/40">{v.accent} · {v.gender}</span>
                  </div>
                  <p className="text-xs text-white/50 truncate">{v.desc}</p>
                </div>
                {/* Preview button */}
                <button
                  onClick={e => { e.stopPropagation(); handlePreview(v.id); }}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0 transition-all"
                  title="Preview voice"
                >
                  {isPreviewing ? (
                    <Loader size={14} className="animate-spin text-white/60" />
                  ) : isPlaying ? (
                    <Pause size={14} className="text-violet-400" />
                  ) : (
                    <Play size={14} className="text-white/60" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        {!config?.el_agent_id && !customer?.el_agent_id && (
          <p className="text-xs text-white/30 mt-4">Voice selection will be available once your number is provisioned.</p>
        )}
      </div>

      <VoiceControlsCard
        controls={controls}
        onChange={setControls}
        onSave={handleSaveVoice}
        saving={savingVoice}
        saved={voiceSaved}
        canSave={Boolean(config?.el_agent_id || customer?.el_agent_id)}
      />

      {/* Capabilities */}
      <div className="mb-8">
        <CapabilitiesSection config={config} customerId={customer?.id} anon={SUPABASE_ANON_KEY} url={SUPABASE_URL} />
      </div>

      {/* Whitelist + Bridge */}
      <WhitelistSection config={config} anon={SUPABASE_ANON_KEY} url={SUPABASE_URL} />

      {/* Call log */}
      <CallLog calls={calls} />
    </div>
  );
}
