import { useState, useEffect, useRef } from "react";
import { getMe, getVoiceCalls, getVoiceConfig } from "../lib/api";
import { Phone, PhoneIncoming, PhoneForwarded, PhoneMissed, Plus, Trash2, Play, Pause, Check, Loader } from "lucide-react";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
const EL_API_KEY = "sk_0e78210938ba7868491c59100a01a9a4cd5581e77da9cca9";
const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const PREVIEW_TEXT = "Hi there! Thanks for calling. I'm your AI receptionist — how can I help you today?";

const VOICES = [
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", accent: "Australian", gender: "Male",   desc: "Deep, confident, energetic" },
  { id: "ouFAjcjtdrVBT9bRFhFQ", name: "David",  accent: "Australian", gender: "Male",   desc: "Deep, calm, trustworthy" },
  { id: "VyyyOgRmsqOzaZXnKWnI", name: "Sunny",  accent: "Australian", gender: "Female", desc: "Warm, friendly, upbeat" },
  { id: "5GZaeOOG7yqLdoTRsaa6", name: "Sally",  accent: "Australian", gender: "Female", desc: "Kind, professional" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", accent: "British",    gender: "Male",   desc: "Steady, authoritative broadcaster" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",   accent: "British",    gender: "Female", desc: "Velvety, composed, professional" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",  accent: "American",   gender: "Female", desc: "Mature, reassuring, confident" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",  accent: "American",   gender: "Male",   desc: "Deep, resonant, comforting" },
];

export default function Voice() {
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadData = async () => {
    try {
      const { customer: c } = await getMe();
      setCustomer(c);
      const [cfg, callLog] = await Promise.all([
        getVoiceConfig(c.id),
        getVoiceCalls(c.id),
      ]);
      const cfgRow = Array.isArray(cfg) ? cfg[0] || null : null;
      setConfig(cfgRow);
      if (cfgRow?.voice_id) setActiveVoiceId(cfgRow.voice_id);
      if (cfgRow?.greeting_script) setGreeting(cfgRow.greeting_script);
      setCalls(Array.isArray(callLog) ? callLog : []);
    } catch (e: any) {
      // Auth errors redirect in api.ts; other errors surface quietly
      console.error("Voice loadData:", e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  async function handleProvision() {
    if (!customer?.id) { setProvisionError("Could not load your account. Please refresh and try again."); return; }
    setProvisioning(true);
    setProvisionError("");
    try {
      const res = await fetch("https://provision.manyhandz.ai/provision-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customer.id, country: "AU" }),
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
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": EL_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, model_id: "eleven_turbo_v2", voice_settings: { stability: 0.75, similarity_boost: 0.75 } }),
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

  async function handleSaveGreeting() {
    const agentId = config?.el_agent_id || customer?.el_agent_id;
    if (!agentId || !greeting.trim()) return;
    setSavingGreeting(true);
    try {
      await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        method: "PATCH",
        headers: { "xi-api-key": EL_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_config: { agent: { first_message: greeting.trim() } } }),
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
      // Update EL agent voice
      await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        method: "PATCH",
        headers: { "xi-api-key": EL_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_config: { tts: { voice_id: activeVoiceId } } }),
      });
      // Save to voice_config
      await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${config.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: activeVoiceId }),
      });
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
          <p className="text-sm text-white/40 mt-2">AI persona: {config?.ai_name || (customer?.business_name ? customer.business_name + " AI" : "AI Assistant")}</p>
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
              <p className="text-xs text-white/40 mb-3">Keep your current number. Forward calls to <span className="text-yellow-400 font-mono">{customer.twilio_number}</span> when you can't answer.</p>
              <p className="text-xs text-white/50 mb-2 font-medium">To forward when busy or unanswered:</p>
              <div className="space-y-2 text-xs font-mono">
                <div className="bg-black/30 rounded-lg px-3 py-2">
                  <span className="text-white/30">Telstra · </span>
                  <span className="text-yellow-300">**61*{customer.twilio_number.replace('+', '')}#</span>
                </div>
                <div className="bg-black/30 rounded-lg px-3 py-2">
                  <span className="text-white/30">Optus · </span>
                  <span className="text-yellow-300">**21*{customer.twilio_number.replace('+', '')}#</span>
                </div>
                <div className="bg-black/30 rounded-lg px-3 py-2">
                  <span className="text-white/30">Vodafone · </span>
                  <span className="text-yellow-300">**61*{customer.twilio_number.replace('+', '')}#</span>
                </div>
                <p className="text-white/25 pt-1">Dial the code above from your mobile to activate. To cancel: ##61# (Telstra/Vodafone) or ##21# (Optus).</p>
              </div>
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

      {/* Whitelist */}
      <div className="aurora-card p-6 mb-8">
        <h3 className="font-semibold mb-3">Whitelist</h3>
        <p className="text-sm text-white/50 mb-4">
          These numbers bypass AI and get connected directly to your bridge number.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(config?.whitelist || []).map((num: string, i: number) => (
            <span key={i} className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm flex items-center gap-2">
              {num}
              <button className="text-green-300/50 hover:text-white"><Trash2 size={14} /></button>
            </span>
          ))}
          {(!config?.whitelist || config.whitelist.length === 0) && (
            <span className="text-white/30 text-sm">No whitelisted numbers</span>
          )}
        </div>
        <div className="flex gap-2">
          <input placeholder="+61400000000" className="flex-1" />
          <button className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} /> Add</button>
        </div>
        <div className="mt-4">
          <label className="text-sm text-white/60 block mb-1">Bridge to number</label>
          <input value={config?.bridge_to_number || ""} placeholder="+61400000000" readOnly />
        </div>
      </div>

      {/* Call log */}
      <div className="aurora-card p-6">
        <h3 className="font-semibold mb-4">Recent calls</h3>
        {calls.length === 0 ? (
          <p className="text-white/30 text-sm">No calls yet.</p>
        ) : (
          <div className="space-y-3">
            {calls.map((call: any) => (
              <div key={call.id} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                {call.outcome === "handled" && <PhoneIncoming size={18} className="text-green-400" />}
                {call.outcome === "transferred" && <PhoneForwarded size={18} className="text-blue-400" />}
                {call.outcome === "missed" && <PhoneMissed size={18} className="text-red-400" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{call.caller_number}</p>
                  <p className="text-xs text-white/40">
                    {new Date(call.created_at).toLocaleString()} · {call.duration_seconds || 0}s · {call.outcome}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
