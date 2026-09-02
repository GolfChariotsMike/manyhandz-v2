import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Loader, Save } from "lucide-react";
import {
  getMe,
  getKnowledgeBase,
  updateKnowledgeBase,
  getVoiceConfig,
  getPriceList,
  getActiveConnectionPlatforms,
} from "../lib/api";
import {
  composedAiPromptFromRows,
  knowledgeVoiceSaveBody,
  liveAiPromptFromRows,
  nextDisplayedPrompt,
  parseHoursForPrompt,
  type PriceItem,
} from "../lib/knowledge-prompt";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

export default function KnowledgeBase() {
  const [kb, setKb] = useState<any>(null);
  const [voiceConfig, setVoiceConfig] = useState<any>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hoursText, setHoursText] = useState("");
  const [hoursError, setHoursError] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [priceList, setPriceList] = useState<PriceItem[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [promptReady, setPromptReady] = useState(false);
  const serviceInputRef = useRef<HTMLInputElement>(null);
  const lastComposedRef = useRef("");

  const promptRows = useCallback((systemPrompt: string) => ({
    businessName,
    about: kb?.about,
    services: kb?.services,
    faqs: kb?.faqs,
    hours: parseHoursForPrompt(hoursText, kb?.hours || null),
    tone: kb?.tone,
    priceList,
    voice: voiceConfig,
    platforms,
    systemPrompt,
  }), [businessName, kb, hoursText, priceList, voiceConfig, platforms]);

  useEffect(() => {
    (async () => {
      const { customer } = await getMe();
      const cid = customer?.id;
      if (!cid) return;
      setCustomerId(cid);
      setBusinessName(customer?.business_name || "");
      const [rows, vcRows, prices, plats] = await Promise.all([
        getKnowledgeBase(cid),
        getVoiceConfig(cid),
        getPriceList(cid),
        getActiveConnectionPlatforms(cid),
      ]);
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      const vc = Array.isArray(vcRows) && vcRows.length > 0 ? vcRows[0] : null;
      const list = Array.isArray(prices) ? prices : [];
      if (row) {
        setKb(row);
        setHoursText(row.hours && Object.keys(row.hours).length > 0 ? JSON.stringify(row.hours, null, 2) : "");
      }
      if (vc) setVoiceConfig(vc);
      setPriceList(list);
      setPlatforms(plats);
      const sourceRows = {
        businessName: customer?.business_name || "",
        about: row?.about,
        services: row?.services,
        faqs: row?.faqs,
        hours: row?.hours || null,
        tone: row?.tone,
        priceList: list,
        voice: vc,
        platforms: plats,
        systemPrompt: vc?.system_prompt || "",
      };
      const composed = composedAiPromptFromRows(sourceRows);
      setAiPrompt(liveAiPromptFromRows(sourceRows) || composed);
      lastComposedRef.current = composed;
      setPromptReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!promptReady || !kb) return;
    const composed = composedAiPromptFromRows(promptRows(""));
    setAiPrompt((cur) => nextDisplayedPrompt(cur, composed, lastComposedRef.current));
    lastComposedRef.current = composed;
  }, [promptReady, kb, promptRows]);

  const save = async () => {
    if (!kb) return;
    setSaving(true);

    // Auto-add any typed-but-not-entered service text
    let services = kb.services || [];
    const typedService = serviceInputRef.current?.value?.trim();
    if (typedService) {
      services = [...services, typedService];
      setKb((prev: any) => ({ ...prev, services }));
      if (serviceInputRef.current) serviceInputRef.current.value = "";
    }

    // Parse hours from text — skip if invalid JSON
    let hours = kb.hours;
    if (hoursText.trim()) {
      try { hours = JSON.parse(hoursText); setHoursError(false); }
      catch { setHoursError(true); setSaving(false); return; }
    } else {
      hours = {};
    }

    const composed = composedAiPromptFromRows({
      ...promptRows(""),
      services,
      hours,
    });
    const voiceBody = knowledgeVoiceSaveBody(aiPrompt, composed);
    setAiPrompt(voiceBody.system_prompt);

    await Promise.all([
      updateKnowledgeBase(kb.id, {
        services, faqs: kb.faqs, hours,
        tone: kb.tone, about: kb.about, custom_instructions: kb.custom_instructions,
      }),
      voiceConfig?.id ? fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?id=eq.${voiceConfig.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(voiceBody),
      }) : Promise.resolve(),
      fetch(`${SUPABASE_URL}/functions/v1/mh-sync-agent`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId || (await getMe()).customer?.id }),
      }).catch(() => {}),
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
            ref={serviceInputRef}
            placeholder="Type a service and press Enter (or just Save)"
            onKeyDown={e => {
              if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                setKb({ ...kb, services: [...(kb.services || []), (e.target as HTMLInputElement).value.trim()] });
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
            value={hoursText}
            onChange={e => { setHoursText(e.target.value); setHoursError(false); }}
            placeholder='{"monday": "9am-5pm", "tuesday": "9am-5pm", ...}'
            className={`font-mono text-sm ${hoursError ? "border-red-500" : ""}`}
          />
          {hoursError && <p className="text-xs text-red-400 mt-1">Invalid JSON — fix the format before saving.</p>}
        </div>

        <div className="aurora-card p-6 col-span-full">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold">AI Prompt</h3>
              <p className="text-xs text-white/40 mt-0.5">
                The live system prompt Charlie uses on phone calls and website chat — including SimPRO booking, lookup, site-contact, and honesty rules when that capability is on.
              </p>
            </div>
            <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full ml-4 flex-shrink-0">Phone + Chat</span>
          </div>
          <textarea
            rows={20}
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder="Loading the live prompt…"
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}
