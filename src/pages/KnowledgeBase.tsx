import { useState, useEffect } from "react";
import { getMe, getKnowledgeBase, updateKnowledgeBase, getVoiceConfig } from "../lib/api";
import { Save } from "lucide-react";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

export default function KnowledgeBase() {
  const [kb, setKb] = useState<any>(null);
  const [voiceConfig, setVoiceConfig] = useState<any>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { customer } = await getMe();
      const [rows, vcRows] = await Promise.all([
        getKnowledgeBase(customer.id),
        getVoiceConfig(customer.id),
      ]);
      if (Array.isArray(rows) && rows.length > 0) setKb(rows[0]);
      if (Array.isArray(vcRows) && vcRows.length > 0) {
        setVoiceConfig(vcRows[0]);
        setAiPrompt(vcRows[0].system_prompt || "");
      }
    })();
  }, []);

  const save = async () => {
    if (!kb) return;
    setSaving(true);
    const token = localStorage.getItem("mh_token") || SUPABASE_ANON_KEY;
    await Promise.all([
      updateKnowledgeBase(kb.id, {
        services: kb.services, faqs: kb.faqs, hours: kb.hours,
        tone: kb.tone, about: kb.about, custom_instructions: kb.custom_instructions,
      }),
      voiceConfig?.id ? fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${voiceConfig.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: aiPrompt }),
      }) : Promise.resolve(),
      // Push updated prompt to ElevenLabs agent
      voiceConfig?.el_agent_id && aiPrompt ? fetch(`https://api.elevenlabs.io/v1/convai/agents/${voiceConfig.el_agent_id}`, {
        method: "PATCH",
        headers: { "xi-api-key": "sk_0e78210938ba7868491c59100a01a9a4cd5581e77da9cca9", "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_config: { agent: { prompt: { prompt: aiPrompt } } } }),
      }) : Promise.resolve(),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!kb) return <div className="text-white/50">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Knowledge Base</h1>
          <p className="text-white/50">This is what your AI knows about your business.</p>
        </div>
        <button onClick={save} className="btn-primary flex items-center gap-2" disabled={saving}>
          {saved ? <><Check size={18} /> Saved</> : saving ? <><Loader size={18} className="animate-spin" /> Saving...</> : <><Save size={18} /> Save changes</>}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3">About</h3>
          <textarea
            rows={4}
            value={kb.about || ""}
            onChange={e => setKb({ ...kb, about: e.target.value })}
            placeholder="A short description of your business..."
          />
        </div>

        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3">Tone</h3>
          <select value={kb.tone || "friendly"} onChange={e => setKb({ ...kb, tone: e.target.value })}>
            <option value="friendly">Friendly</option>
            <option value="formal">Formal / Professional</option>
            <option value="casual">Casual</option>
          </select>
          <p className="text-xs text-white/40 mt-2">How your AI speaks to customers.</p>
        </div>

        <div className="aurora-card p-6 col-span-full">
          <h3 className="font-semibold mb-3">Services</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {(kb.services || []).map((s: string, i: number) => (
              <span key={i} className="bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                {s}
                <button
                  onClick={() => setKb({ ...kb, services: kb.services.filter((_: any, j: number) => j !== i) })}
                  className="text-yellow-400/50 hover:text-white"
                >×</button>
              </span>
            ))}
          </div>
          <input
            placeholder="Add a service and press Enter"
            onKeyDown={e => {
              if (e.key === "Enter" && (e.target as HTMLInputElement).value) {
                setKb({ ...kb, services: [...(kb.services || []), (e.target as HTMLInputElement).value] });
                (e.target as HTMLInputElement).value = "";
              }
            }}
          />
        </div>

        <div className="aurora-card p-6 col-span-full">
          <h3 className="font-semibold mb-3">FAQs</h3>
          {(kb.faqs || []).map((faq: any, i: number) => (
            <div key={i} className="mb-4 p-4 bg-white/5 rounded-xl">
              <input
                value={faq.q || ""}
                onChange={e => {
                  const faqs = [...kb.faqs];
                  faqs[i] = { ...faqs[i], q: e.target.value };
                  setKb({ ...kb, faqs });
                }}
                placeholder="Question"
                className="mb-2"
              />
              <textarea
                rows={2}
                value={faq.a || ""}
                onChange={e => {
                  const faqs = [...kb.faqs];
                  faqs[i] = { ...faqs[i], a: e.target.value };
                  setKb({ ...kb, faqs });
                }}
                placeholder="Answer"
              />
            </div>
          ))}
          <button
            className="btn-secondary text-sm"
            onClick={() => setKb({ ...kb, faqs: [...(kb.faqs || []), { q: "", a: "" }] })}
          >
            + Add FAQ
          </button>
        </div>

        <div className="aurora-card p-6 col-span-full">
          <h3 className="font-semibold mb-3">Business Hours</h3>
          <textarea
            rows={3}
            value={typeof kb.hours === "object" ? JSON.stringify(kb.hours, null, 2) : kb.hours || ""}
            onChange={e => {
              try { setKb({ ...kb, hours: JSON.parse(e.target.value) }); } catch { }
            }}
            placeholder='{"monday": "9am-5pm", "tuesday": "9am-5pm", ...}'
            className="font-mono text-sm"
          />
        </div>

        <div className="aurora-card p-6 col-span-full">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold">AI Prompt</h3>
              <p className="text-xs text-white/40 mt-0.5">The system prompt your AI uses on every call. Controls personality, rules, and behaviour.</p>
            </div>
            <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full ml-4 flex-shrink-0">Voice AI</span>
          </div>
          <textarea
            rows={10}
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder={`You are a helpful AI assistant for [Business Name]. Your job is to answer calls professionally, help callers with their enquiries, and take messages when needed.\n\nRules:\n- Always greet the caller warmly\n- Ask for their name early in the conversation\n- Take a message if you can't help\n- Never make up information you don't know`}
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function Check(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function Loader(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" /></svg>; }
