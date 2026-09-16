import { Plus, X } from "lucide-react";
import { AU_HOME_STATES } from "../lib/onboarding";
import type { FAQ, HoursRow } from "../lib/onboarding-templates";

type Props = {
  about: string;
  setAbout: (value: string) => void;
  services: string[];
  setServices: (value: string[]) => void;
  faqs: FAQ[];
  setFaqs: (value: FAQ[]) => void;
  hours: HoursRow[];
  setHours: (value: HoursRow[]) => void;
  tone: string;
  setTone: (value: string) => void;
  homeState?: string;
  setHomeState?: (value: string) => void;
  showHomeState?: boolean;
  scanRequestedUrl?: string;
  scanFinalUrl?: string;
  scanNote?: string;
};

export default function KnowledgeEditor({
  about,
  setAbout,
  services,
  setServices,
  faqs,
  setFaqs,
  hours,
  setHours,
  tone,
  setTone,
  homeState,
  setHomeState,
  showHomeState,
  scanRequestedUrl,
  scanFinalUrl,
  scanNote,
}: Props) {
  function addService(label: string) {
    const value = label.trim();
    if (!value) return;
    setServices([...services, value]);
  }

  function updateFaq(index: number, field: "q" | "a", value: string) {
    const next = [...faqs];
    next[index] = { ...next[index], [field]: value };
    setFaqs(next);
  }

  function updateHour(index: number, field: keyof HoursRow, value: string | boolean) {
    const next = [...hours];
    next[index] = { ...next[index], [field]: value };
    setHours(next);
  }

  return (
    <div className="space-y-6">
      {scanRequestedUrl && (
        <div className="aurora-card p-5">
          <label className="text-sm font-semibold text-yellow-400 mb-2 block">Website we scanned</label>
          <p className="text-sm text-white/80 break-all">{scanRequestedUrl}</p>
          {scanFinalUrl && scanFinalUrl !== scanRequestedUrl && (
            <p className="text-xs text-white/50 mt-2 break-all">After redirects that became: {scanFinalUrl}</p>
          )}
          {scanNote && <p className="text-xs text-yellow-400/80 mt-2">{scanNote}</p>}
        </div>
      )}

      {showHomeState && setHomeState && (
        <div className="aurora-card p-5">
          <label className="text-sm font-semibold text-yellow-400 mb-2 block">Home state</label>
          <p className="text-xs text-white/50 mb-2">
            Used as the default Australian state on SimPRO job addresses when the caller doesn&apos;t say one.
          </p>
          <select value={homeState || ""} onChange={(e) => setHomeState(e.target.value)}>
            <option value="">Not set — don&apos;t guess</option>
            {AU_HOME_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>
      )}

      <div className="aurora-card p-5">
        <label className="text-sm font-semibold text-yellow-400 mb-2 block">About your business</label>
        <textarea
          rows={3}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Describe what your business does..."
        />
      </div>

      <ServiceList services={services} setServices={setServices} onAdd={addService} />

      <div className="aurora-card p-5">
        <label className="text-sm font-semibold text-yellow-400 mb-2 block">FAQs</label>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white/5 rounded-xl p-4 relative group">
              <button type="button" onClick={() => setFaqs(faqs.filter((_, idx) => idx !== i))} className="absolute top-3 right-3 text-white/20 hover:text-red-400 transition-colors">
                <X size={16} />
              </button>
              <input value={faq.q} onChange={(e) => updateFaq(i, "q", e.target.value)} placeholder="Question" className="mb-2 text-sm font-medium" />
              <textarea rows={2} value={faq.a} onChange={(e) => updateFaq(i, "a", e.target.value)} placeholder="Answer" className="text-sm" />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setFaqs([...faqs, { q: "", a: "" }])} className="btn-secondary w-full mt-3 flex items-center justify-center gap-2 text-sm">
          <Plus size={16} /> Add FAQ
        </button>
      </div>

      <div className="aurora-card p-5">
        <label className="text-sm font-semibold text-yellow-400 mb-2 block">Business hours</label>
        <div className="space-y-2">
          {hours.map((h, i) => (
            <div key={h.day} className="flex items-center gap-3 text-sm">
              <span className="w-24 text-white/60">{h.day}</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={h.closed}
                  onChange={(e) => updateHour(i, "closed", e.target.checked)}
                  className="w-4 h-4 accent-yellow-500"
                  style={{ width: "16px", height: "16px" }}
                />
                <span className="text-white/40 text-xs">Closed</span>
              </label>
              {!h.closed && (
                <>
                  <input type="time" value={h.open} onChange={(e) => updateHour(i, "open", e.target.value)} className="w-28 text-center text-sm py-1" />
                  <span className="text-white/30">to</span>
                  <input type="time" value={h.close} onChange={(e) => updateHour(i, "close", e.target.value)} className="w-28 text-center text-sm py-1" />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="aurora-card p-5">
        <label className="text-sm font-semibold text-yellow-400 mb-3 block">Tone of voice</label>
        <div className="flex gap-3">
          {[
            { id: "professional", label: "Professional", desc: "Formal and businesslike" },
            { id: "friendly", label: "Friendly", desc: "Warm and approachable" },
            { id: "casual", label: "Casual", desc: "Relaxed and conversational" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTone(t.id)}
              className={`flex-1 aurora-card p-4 text-center transition-all ${
                tone === t.id ? "border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/30" : "hover:bg-white/5"
              }`}
            >
              <div className="font-semibold text-sm">{t.label}</div>
              <div className="text-xs text-white/40 mt-1">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServiceList({
  services,
  setServices,
  onAdd,
}: {
  services: string[];
  setServices: (value: string[]) => void;
  onAdd: (value: string) => void;
}) {
  return (
    <div className="aurora-card p-5">
      <label className="text-sm font-semibold text-yellow-400 mb-2 block">Your services</label>
      <div className="flex flex-wrap gap-2 mb-3">
        {services.map((s, i) => (
          <span key={`${s}-${i}`} className="inline-flex items-center gap-1 bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-sm">
            {s}
            <button type="button" onClick={() => setServices(services.filter((_, idx) => idx !== i))} className="hover:text-red-400 transition-colors">
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <AddServiceField onAdd={onAdd} />
    </div>
  );
}

function AddServiceField({ onAdd }: { onAdd: (value: string) => void }) {
  return (
    <div className="flex gap-2">
      <input
        defaultValue=""
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const input = e.currentTarget;
          onAdd(input.value);
          input.value = "";
        }}
        placeholder="Add a service..."
        className="flex-1"
      />
      <button
        type="button"
        className="btn-secondary px-3"
        onClick={(e) => {
          const input = e.currentTarget.parentElement?.querySelector("input");
          if (!input) return;
          onAdd(input.value);
          input.value = "";
        }}
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
