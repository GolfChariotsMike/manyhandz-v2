import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, scrapeWebsite, updateKnowledgeBase, getKnowledgeBase } from "../lib/api";
import { Check, Loader2, Phone, Mail, MessageSquare } from "lucide-react";

type Step = "scraping" | "review" | "pick-product" | "done";

export default function Onboarding() {
  const [step, setStep] = useState<Step>("scraping");
  const [customer, setCustomer] = useState<any>(null);
  const [kb, setKb] = useState<any>(null);
  const [scrapeData, setScrapeData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { customer: c } = await getMe();
      setCustomer(c);

      // Try scraping if website exists
      if (c.website_url) {
        try {
          const data = await scrapeWebsite(c.website_url);
          setScrapeData(data);

          // Save to knowledge base
          const kbRows = await getKnowledgeBase(c.id);
          if (kbRows.length > 0) {
            await updateKnowledgeBase(kbRows[0].id, {
              services: data.services || [],
              faqs: data.faqs || [],
              hours: data.hours || {},
              tone: data.tone || "friendly",
              about: data.about || "",
            });
            setKb({ ...kbRows[0], ...data });
          }
        } catch (err) {
          console.error("Scrape failed:", err);
        }
      } else {
        const kbRows = await getKnowledgeBase(c.id);
        if (kbRows.length > 0) setKb(kbRows[0]);
      }

      setStep("review");
      setLoading(false);
    })();
  }, []);

  if (step === "scraping" || loading) {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Setting up your AI...</h2>
          <p className="text-white/50">
            {customer?.website_url ? "Scanning your website to learn about your business" : "Preparing your dashboard"}
          </p>
        </div>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-8 w-full max-w-2xl">
          <h2 className="text-2xl font-bold mb-2">Your Knowledge Base</h2>
          <p className="text-white/50 mb-6">
            {scrapeData ? "We extracted this from your website. Review and edit anything." : "Tell your AI about your business."}
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-white/60 mb-1 block">About your business</label>
              <textarea
                rows={3}
                value={kb?.about || ""}
                onChange={e => setKb({ ...kb, about: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Services (comma separated)</label>
              <input
                value={Array.isArray(kb?.services) ? kb.services.join(", ") : ""}
                onChange={e => setKb({ ...kb, services: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })}
              />
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Tone</label>
              <select value={kb?.tone || "friendly"} onChange={e => setKb({ ...kb, tone: e.target.value })}>
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
              </select>
            </div>
          </div>

          <button className="btn-primary w-full mt-6" onClick={() => setStep("pick-product")}>
            Looks good — continue
          </button>
        </div>
      </div>
    );
  }

  if (step === "pick-product") {
    const products = [
      { id: "voice", icon: Phone, name: "Voice", desc: "AI answers your phone calls 24/7", tag: "Recommended" },
      { id: "email", icon: Mail, name: "DraftPilot", desc: "AI drafts email replies from your inbox" },
      { id: "chat", icon: MessageSquare, name: "Chat Widget", desc: "AI chat on your website" },
    ];

    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-8 w-full max-w-2xl">
          <h2 className="text-2xl font-bold mb-2">Pick your first product</h2>
          <p className="text-white/50 mb-6">You can activate more from your dashboard anytime.</p>

          <div className="grid gap-4">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => { setStep("done"); setTimeout(() => navigate("/"), 1500); }}
                className="aurora-card p-6 flex items-center gap-4 text-left hover:bg-white/10 transition-all group relative"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                  <p.icon className="text-indigo-400" size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{p.name}</h3>
                  <p className="text-sm text-white/50">{p.desc}</p>
                </div>
                {p.tag && (
                  <span className="absolute top-3 right-3 text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-full">
                    {p.tag}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Done
  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
          <Check className="text-green-400" size={32} />
        </div>
        <h2 className="text-2xl font-bold mb-2">You're all set!</h2>
        <p className="text-white/50">Taking you to your dashboard...</p>
      </div>
    </div>
  );
}
