import { useState, useEffect } from "react";
import { getMe, getKnowledgeBase, updateKnowledgeBase } from "../lib/api";
import { Save } from "lucide-react";

export default function KnowledgeBase() {
  const [kb, setKb] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { customer } = await getMe();
      const rows = await getKnowledgeBase(customer.id);
      if (rows.length > 0) setKb(rows[0]);
    })();
  }, []);

  const save = async () => {
    if (!kb) return;
    setSaving(true);
    await updateKnowledgeBase(kb.id, {
      services: kb.services, faqs: kb.faqs, hours: kb.hours,
      tone: kb.tone, about: kb.about, custom_instructions: kb.custom_instructions,
    });
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
              <span key={i} className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                {s}
                <button
                  onClick={() => setKb({ ...kb, services: kb.services.filter((_: any, j: number) => j !== i) })}
                  className="text-indigo-300/50 hover:text-white"
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
      </div>
    </div>
  );
}

function Check(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function Loader(props: any) { return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" /></svg>; }
