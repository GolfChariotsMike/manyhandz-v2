import { useState, useEffect } from "react";
import { Loader2, Plus, Trash2, DollarSign, Clock, Save } from "lucide-react";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

function authHeaders() {
  const token = localStorage.getItem("mh_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token || ANON_KEY}`, apikey: ANON_KEY };
}

async function getMe() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mh-v2-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "me", token: localStorage.getItem("mh_token") }),
  });
  return r.json();
}

const PRICE_TYPES = [
  { value: "flat", label: "Flat rate" },
  { value: "hourly", label: "Hourly" },
  { value: "range", label: "Price range" },
  { value: "inspect", label: "Quote on inspection" },
];

const EXAMPLES = [
  { job_name: "Callout / Service fee", price_type: "flat", price_min: 120, price_max: null, duration_hours_min: null, duration_hours_max: null, notes: "" },
  { job_name: "Replace powerpoint", price_type: "flat", price_min: 180, price_max: null, duration_hours_min: 0.5, duration_hours_max: 1, notes: "" },
  { job_name: "General labour", price_type: "hourly", price_min: 95, price_max: null, duration_hours_min: null, duration_hours_max: null, notes: "Minimum 1 hour call-out" },
  { job_name: "Hot water system install", price_type: "range", price_min: 800, price_max: 1400, duration_hours_min: 3, duration_hours_max: 5, notes: "Excludes unit cost" },
];

type PriceItem = {
  id?: string;
  job_name: string;
  price_type: string;
  price_min: number | null;
  price_max: number | null;
  duration_hours_min: number | null;
  duration_hours_max: number | null;
  notes: string;
  sort_order: number;
  isNew?: boolean;
  isDirty?: boolean;
};

function emptyItem(sort_order: number): PriceItem {
  return { job_name: "", price_type: "flat", price_min: null, price_max: null, duration_hours_min: null, duration_hours_max: null, notes: "", sort_order, isNew: true, isDirty: true };
}

export default function Quoting() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<PriceItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await getMe();
      const cid = me?.customer?.id || me?.id;
      if (!cid) { setLoading(false); return; }
      setCustomerId(cid);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/mh_price_list?customer_id=eq.${cid}&order=sort_order.asc`, { headers: authHeaders() });
      const rows = await r.json();
      setItems(Array.isArray(rows) ? rows : []);
      setLoading(false);
    })();
  }, []);

  function update(idx: number, field: keyof PriceItem, value: any) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value, isDirty: true } : item));
  }

  function addRow() {
    setItems(prev => [...prev, emptyItem(prev.length)]);
  }

  function removeRow(idx: number) {
    const item = items[idx];
    if (item.id) {
      fetch(`${SUPABASE_URL}/rest/v1/mh_price_list?id=eq.${item.id}`, { method: "DELETE", headers: authHeaders() });
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function loadExamples() {
    setItems(EXAMPLES.map((e, i) => ({ ...e, price_max: e.price_max ?? null, sort_order: i, isNew: true, isDirty: true })));
  }

  async function save() {
    setSaving(true);
    try {
      for (const item of items.filter(i => i.isDirty)) {
        const payload = {
          customer_id: customerId,
          job_name: item.job_name,
          price_type: item.price_type,
          price_min: item.price_min,
          price_max: item.price_max,
          duration_hours_min: item.duration_hours_min,
          duration_hours_max: item.duration_hours_max,
          notes: item.notes,
          sort_order: item.sort_order,
        };
        if (item.id) {
          await fetch(`${SUPABASE_URL}/rest/v1/mh_price_list?id=eq.${item.id}`, {
            method: "PATCH", headers: { ...authHeaders(), Prefer: "return=representation" },
            body: JSON.stringify(payload),
          });
        } else {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/mh_price_list`, {
            method: "POST", headers: { ...authHeaders(), Prefer: "return=representation" },
            body: JSON.stringify(payload),
          });
          const created = await r.json();
          if (Array.isArray(created) && created[0]?.id) {
            setItems(prev => prev.map(i => i === item ? { ...i, id: created[0].id, isNew: false, isDirty: false } : i));
          }
        }
      }
      setItems(prev => prev.map(i => ({ ...i, isDirty: false, isNew: false })));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      // Update EL agent system prompt with new pricing
      await fetch(`${SUPABASE_URL}/functions/v1/mh-sync-agent`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ customer_id: customerId }),
      }).catch(() => {});
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  function priceLabel(item: PriceItem) {
    if (item.price_type === "inspect") return "Quote on inspection";
    if (item.price_type === "hourly") return item.price_min ? `$${item.price_min}/hr` : "";
    if (item.price_type === "range") return (item.price_min && item.price_max) ? `$${item.price_min}–$${item.price_max}` : "";
    return item.price_min ? `$${item.price_min}` : "";
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-yellow-400" size={32} /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Quoting</h1>
        <p className="text-white/40 text-sm">Add your common jobs and prices. Your AI will use this to quote callers confidently — and know when to say "we'll need to come take a look."</p>
      </div>

      {items.length === 0 && (
        <div className="aurora-card p-8 text-center space-y-4">
          <DollarSign className="mx-auto text-yellow-400/50" size={40} />
          <div>
            <p className="font-semibold mb-1">No price list yet</p>
            <p className="text-white/40 text-sm">Add your common jobs so your AI can quote callers on the spot.</p>
          </div>
          <button onClick={loadExamples} className="btn-secondary text-sm">Load example prices</button>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className={`aurora-card p-4 space-y-3 ${item.isDirty ? "border-yellow-500/30" : ""}`}>
              <div className="flex gap-3 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Job name (e.g. Replace powerpoint)"
                    value={item.job_name}
                    onChange={e => update(idx, "job_name", e.target.value)}
                    className="w-full bg-transparent text-white text-sm outline-none placeholder:text-white/20 border-b border-white/10 pb-1"
                  />
                </div>
                <button onClick={() => removeRow(idx)} className="text-white/20 hover:text-red-400 transition-colors shrink-0 mt-1">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-white/30 block mb-1">Price type</label>
                  <select
                    value={item.price_type}
                    onChange={e => update(idx, "price_type", e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                  >
                    {PRICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {item.price_type !== "inspect" && (
                  <div>
                    <label className="text-xs text-white/30 block mb-1">{item.price_type === "range" ? "Min $" : item.price_type === "hourly" ? "$/hr" : "Price $"}</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={item.price_min ?? ""}
                      onChange={e => update(idx, "price_min", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                    />
                  </div>
                )}

                {item.price_type === "range" && (
                  <div>
                    <label className="text-xs text-white/30 block mb-1">Max $</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={item.price_max ?? ""}
                      onChange={e => update(idx, "price_max", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs text-white/30 block mb-1 flex items-center gap-1"><Clock size={10} /> Duration</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      placeholder="Min hrs"
                      step="0.5"
                      value={item.duration_hours_min ?? ""}
                      onChange={e => update(idx, "duration_hours_min", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                    />
                    <span className="text-white/20 text-xs">–</span>
                    <input
                      type="number"
                      placeholder="Max hrs"
                      step="0.5"
                      value={item.duration_hours_max ?? ""}
                      onChange={e => update(idx, "duration_hours_max", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Notes (optional — e.g. after hours add $80)"
                  value={item.notes}
                  onChange={e => update(idx, "notes", e.target.value)}
                  className="w-full bg-transparent text-white/50 text-xs outline-none placeholder:text-white/20"
                />
              </div>

              {(item.job_name || item.price_type === "inspect") && (
                <div className="text-xs text-white/30 italic">
                  AI will say: "{item.job_name ? `"${item.job_name} — ${priceLabel(item) || 'price TBC'}"` : '...'}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={addRow} className="btn-secondary flex items-center gap-2 text-sm">
          <Plus size={14} /> Add job
        </button>
        {items.length > 0 && (
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? "✓ Saved" : <><Save size={14} /> Save price list</>}
          </button>
        )}
      </div>

      <div className="aurora-card p-5 text-sm text-white/40 space-y-1.5">
        <p className="font-semibold text-white/60 text-xs uppercase tracking-wide mb-2">How your AI uses this</p>
        <p>• <span className="text-white/60">Flat / hourly / range</span> — AI quotes confidently on the call</p>
        <p>• <span className="text-white/60">Quote on inspection</span> — AI says "we'll need to come take a look" and books a visit</p>
        <p>• <span className="text-white/60">Duration</span> — AI can tell callers how long a job typically takes</p>
        <p>• <span className="text-white/60">Notes</span> — AI mentions any caveats (after-hours rates, excludes materials, etc.)</p>
      </div>
    </div>
  );
}
