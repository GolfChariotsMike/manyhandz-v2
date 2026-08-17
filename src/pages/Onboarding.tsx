import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, scrapeWebsite, updateKnowledgeBase, getKnowledgeBase } from "../lib/api";
import { Check, Loader2, Phone, Mail, MessageSquare, Plus, X, Copy, ChevronRight } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STORAGE_KEY = "mh_onboarding_state";

interface FAQ { q: string; a: string }
interface HoursRow { day: string; open: string; close: string; closed: boolean }

const defaultHours: HoursRow[] = [
  { day: "Monday", open: "09:00", close: "17:00", closed: false },
  { day: "Tuesday", open: "09:00", close: "17:00", closed: false },
  { day: "Wednesday", open: "09:00", close: "17:00", closed: false },
  { day: "Thursday", open: "09:00", close: "17:00", closed: false },
  { day: "Friday", open: "09:00", close: "17:00", closed: false },
  { day: "Saturday", open: "09:00", close: "13:00", closed: false },
  { day: "Sunday", open: "", close: "", closed: true },
];

const industries = [
  "Trade / Construction", "Hospitality", "Health / Allied Health",
  "Retail", "Professional Services", "Real Estate",
  "Sport / Fitness", "Education", "Other",
];

const industryTemplates: Record<string, { about: string; services: string[]; faqs: FAQ[] }> = {
  "Trade / Construction": {
    about: "We're a local trade business providing quality workmanship and reliable service. We pride ourselves on showing up on time, doing the job right, and keeping our customers informed throughout.",
    services: ["Free quotes", "Residential work", "Commercial work", "Emergency callouts", "Maintenance"],
    faqs: [
      { q: "Do you provide free quotes?", a: "Yes, we offer free no-obligation quotes. Just give us a call or send us a message with the details." },
      { q: "How quickly can you come out?", a: "We aim to respond within 24 hours for standard jobs, and offer emergency callouts for urgent work." },
      { q: "Are you licensed and insured?", a: "Yes, we're fully licensed and insured for all work we carry out." },
    ],
  },
  "Hospitality": {
    about: "We're passionate about great food, great drinks, and great hospitality. Whether you're popping in for a quick bite or celebrating a special occasion, we're here to make it memorable.",
    services: ["Dine in", "Takeaway", "Function bookings", "Catering", "Gift vouchers"],
    faqs: [
      { q: "Do you take reservations?", a: "Yes, we take bookings — give us a call or message us your preferred date and time." },
      { q: "Do you cater for dietary requirements?", a: "Absolutely. Let us know your requirements and we'll do our best to accommodate you." },
      { q: "What are your trading hours?", a: "Please check our current hours — they can vary by day. Feel free to call us to confirm." },
    ],
  },
  "Health / Allied Health": {
    about: "We're a dedicated health practice committed to helping our patients achieve their best health outcomes. Our team takes a personalised approach to every patient.",
    services: ["Consultations", "Assessments", "Treatment plans", "Follow-up appointments", "Telehealth"],
    faqs: [
      { q: "How do I book an appointment?", a: "You can call us, message us, or book online. We'll find a time that works for you." },
      { q: "Do you accept health insurance?", a: "We accept most major health funds. Contact us to confirm your specific cover." },
      { q: "How long is each appointment?", a: "Initial consultations are typically 45-60 minutes. Follow-ups are usually 30 minutes." },
    ],
  },
  "Retail": {
    about: "We're a local retailer offering quality products and personal service. We love helping customers find exactly what they're looking for.",
    services: ["In-store shopping", "Online orders", "Click & collect", "Gift wrapping", "Returns & exchanges"],
    faqs: [
      { q: "What are your store hours?", a: "Please message us or check our website for current trading hours." },
      { q: "Do you offer refunds?", a: "Yes, we accept returns within 30 days with proof of purchase. Items must be in original condition." },
      { q: "Do you ship online orders?", a: "Yes, we ship Australia-wide. Flat rate shipping with free shipping on orders over a certain amount." },
    ],
  },
  "Professional Services": {
    about: "We're a professional services firm focused on delivering expert advice and practical solutions for our clients. We build long-term relationships based on trust, expertise, and results.",
    services: ["Consultations", "Advice & strategy", "Document preparation", "Ongoing support", "Reviews & audits"],
    faqs: [
      { q: "How do I get started?", a: "Book an initial consultation and we'll assess your situation and outline how we can help." },
      { q: "How much does it cost?", a: "Fees vary depending on the service. We provide a clear quote before commencing any work." },
      { q: "How quickly can I expect a response?", a: "We aim to respond to all enquiries within 1 business day." },
    ],
  },
  "Real Estate": {
    about: "We're a dedicated real estate team committed to helping buyers, sellers, and renters navigate the property market with confidence.",
    services: ["Property appraisals", "Sales", "Property management", "Rental listings", "Buyer's advocacy"],
    faqs: [
      { q: "How do I get a property appraisal?", a: "Contact us to book a free appraisal. One of our agents will visit your property and provide a market estimate." },
      { q: "What fees do you charge?", a: "Our fees vary by service. We'll provide full transparency on costs before you commit to anything." },
      { q: "How long does it take to sell a property?", a: "It depends on the market and property type. We'll give you a realistic timeline based on current conditions." },
    ],
  },
  "Sport / Fitness": {
    about: "We're passionate about helping people move, improve, and feel great. Whether you're a beginner or a seasoned athlete, we have something for you.",
    services: ["Classes & sessions", "Personal training", "Memberships", "Casual passes", "Group programs"],
    faqs: [
      { q: "Do I need to be fit to join?", a: "Not at all! We welcome all fitness levels and tailor sessions to suit you." },
      { q: "How do I book a session?", a: "You can book online or message us directly. We'll find a time that suits you." },
      { q: "Do you offer trial sessions?", a: "Yes, we offer trial sessions for new members. Ask us about our current intro offer." },
    ],
  },
  "Education": {
    about: "We're dedicated to helping students learn, grow, and reach their potential. Our approach is personalised, supportive, and results-focused.",
    services: ["Tutoring", "Group classes", "Online sessions", "Assessment prep", "Holiday programs"],
    faqs: [
      { q: "What ages do you work with?", a: "We work with students across a range of ages and year levels. Contact us to discuss your needs." },
      { q: "How do sessions work?", a: "Sessions are tailored to each student. We assess their current level and build a plan to fill gaps and extend their knowledge." },
      { q: "How quickly will I see results?", a: "Most students see improvement within a few sessions. Consistency is key." },
    ],
  },
  "Other": {
    about: "We're a local business focused on delivering great service and real value to our customers.",
    services: ["Enquiries welcome", "Custom quotes", "Consultations"],
    faqs: [
      { q: "How do I get in touch?", a: "Just call, message, or email us and we'll get back to you as soon as possible." },
      { q: "Do you offer quotes?", a: "Yes — contact us with the details of what you need and we'll provide a quote." },
    ],
  },
};

function saveState(state: Record<string, unknown>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadState(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

const stepLabels = ["Business Details", "Scanning", "Knowledge Base", "Pick Product", "Connect", "Done"];

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className="flex items-center justify-between mb-3">
        {stepLabels.map((label, i) => {
          const s = i + 1;
          const active = s === step;
          const done = s < step;
          return (
            <div key={i} className="flex flex-col items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                done ? "bg-green-500 text-white" :
                active ? "bg-gradient-to-br from-yellow-600 to-yellow-400 text-white shadow-lg shadow-yellow-500/30" :
                "bg-white/10 text-white/30"
              }`}>
                {done ? <Check size={16} /> : s}
              </div>
              <span className={`text-xs mt-1.5 hidden sm:block transition-colors ${active ? "text-yellow-400" : done ? "text-white/50" : "text-white/20"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-500"
          style={{ width: `${((step - 1) / (stepLabels.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const saved = loadState();

  const [step, setStep] = useState<Step>((saved?.step as Step) || 1);
  const [customer, setCustomer] = useState<any>(null);
  const [kbId, setKbId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Step 1
  const [businessName, setBusinessName] = useState<string>((saved?.businessName as string) || "");
  const [website, setWebsite] = useState<string>((saved?.website as string) || "");
  const [industry, setIndustry] = useState<string>((saved?.industry as string) || "");
  const [contactAbout, setContactAbout] = useState<string>((saved?.contactAbout as string) || "");

  // Step 3
  const [about, setAbout] = useState<string>((saved?.about as string) || "");
  const [services, setServices] = useState<string[]>((saved?.services as string[]) || []);
  const [newService, setNewService] = useState("");
  const [faqs, setFaqs] = useState<FAQ[]>((saved?.faqs as FAQ[]) || []);
  const [hours, setHours] = useState<HoursRow[]>((saved?.hours as HoursRow[]) || defaultHours);
  const [tone, setTone] = useState<string>((saved?.tone as string) || "friendly");

  // Step 4/5
  const [selectedProduct, setSelectedProduct] = useState<string>((saved?.selectedProduct as string) || "");
  const [provisionedNumber, setProvisionedNumber] = useState<string>((saved?.provisionedNumber as string) || "");
  const [copied, setCopied] = useState(false);

  // Scraping animation
  const [scrapePhase, setScrapePhase] = useState(0);
  const scrapeMessages = [
    "Scanning your website...",
    "Extracting business information...",
    "Building your knowledge base...",
    "Almost ready..."
  ];

  // Init — load customer
  useEffect(() => {
    (async () => {
      try {
        const { customer: c } = await getMe();
        setCustomer(c);
        if (c.business_name && !businessName) setBusinessName(c.business_name);
        if (c.website_url && !website) setWebsite(c.website_url);
        if (c.industry && !industry) setIndustry(c.industry);

        const kbRows = await getKnowledgeBase(c.id);
        if (kbRows.length > 0) setKbId(kbRows[0].id);

        if (c.onboarding_complete) {
          navigate("/");
          return;
        }
      } catch {
        navigate("/login");
        return;
      }
      setLoading(false);
    })();
  }, []);

  // Persist state
  useEffect(() => {
    if (!loading) {
      saveState({ step, businessName, website, industry, contactAbout, about, services, faqs, hours, tone, selectedProduct, provisionedNumber });
    }
  }, [step, businessName, website, industry, contactAbout, about, services, faqs, hours, tone, selectedProduct, provisionedNumber, loading]);

  function goStep(s: Step) { setStep(s); }

  // Step 1 → Step 2/3
  async function handleStep1() {
    if (!businessName.trim()) return;
    
    // Update customer record with business details via API
    try {
      const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
      const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
      if (customer?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/mh_v2_customers?id=eq.${customer.id}`, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            business_name: businessName,
            website_url: website || null,
            industry: industry || null,
          }),
        });
      }
    } catch {}

    if (website.trim()) {
      goStep(2);
      // Start scraping animation
      setScrapePhase(0);
      const interval = setInterval(() => {
        setScrapePhase(p => Math.min(p + 1, scrapeMessages.length - 1));
      }, 3000);

      try {
        const url = website.startsWith("http") ? website : `https://${website}`;
        const data = await scrapeWebsite(url);
        if (data.about) setAbout(data.about);
        if (data.services?.length) setServices(data.services);
        if (data.faqs?.length) setFaqs(data.faqs);
        if (data.hours) {
          const merged = defaultHours.map(h => {
            const scraped = data.hours?.[h.day.toLowerCase()];
            if (scraped) return { ...h, open: scraped.open || h.open, close: scraped.close || h.close, closed: scraped.closed ?? h.closed };
            return h;
          });
          setHours(merged);
        }
        if (data.tone) setTone(data.tone);

        // Save to KB
        if (kbId) {
          await updateKnowledgeBase(kbId, {
            about: data.about || "",
            services: data.services || [],
            faqs: data.faqs || [],
            hours: data.hours || {},
            tone: data.tone || "friendly",
          });
        }
      } catch {
        // Scrape failed — fall through to template
        if (industry && industryTemplates[industry]) {
          const t = industryTemplates[industry];
          setAbout(t.about); setServices(t.services); setFaqs(t.faqs);
        }
      }
      clearInterval(interval);
      goStep(3);
    } else {
      // No website — apply industry template if available
      if (industry && industryTemplates[industry]) {
        const t = industryTemplates[industry];
        setAbout(a => a || t.about);
        setServices(s => s.length ? s : t.services);
        setFaqs(f => f.length ? f : t.faqs);
      }
      goStep(3);
    }
  }

  // Step 3 → save KB
  async function handleSaveKB() {
    if (kbId) {
      try {
        await updateKnowledgeBase(kbId, {
          about,
          services,
          faqs,
          hours: hours.reduce((acc, h) => ({ ...acc, [h.day.toLowerCase()]: { open: h.open, close: h.close, closed: h.closed } }), {}),
          tone,
        });
      } catch {}
    }
    goStep(4);
  }

  // Step 5 — Connect
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");

  async function handleConnect() {
    if (selectedProduct === "voice" && customer?.id) {
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
        if (data.phone_number) setProvisionedNumber(data.phone_number);
      } catch (e: any) {
        setProvisionError(e.message || "Could not provision a number. Please contact support.");
      } finally {
        setProvisioning(false);
      }
    }
    goStep(5);
  }

  // Finish onboarding
  async function handleFinish() {
    try {
      const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
      const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
      if (customer?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/mh_v2_customers?id=eq.${customer.id}`, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ onboarding_complete: true }),
        });
      }
    } catch {}
    clearState();
    goStep(6);
    setTimeout(() => navigate("/"), 2000);
  }

  function addService() {
    if (newService.trim()) {
      setServices([...services, newService.trim()]);
      setNewService("");
    }
  }

  function removeService(i: number) {
    setServices(services.filter((_, idx) => idx !== i));
  }

  function addFaq() {
    setFaqs([...faqs, { q: "", a: "" }]);
  }

  function updateFaq(i: number, field: "q" | "a", val: string) {
    const updated = [...faqs];
    updated[i][field] = val;
    setFaqs(updated);
  }

  function removeFaq(i: number) {
    setFaqs(faqs.filter((_, idx) => idx !== i));
  }

  function updateHour(i: number, field: keyof HoursRow, val: string | boolean) {
    const updated = [...hours];
    (updated[i] as any)[field] = val;
    setHours(updated);
  }

  const embedCode = `<script src="https://manyhandz.ai/chat-widget.js" data-customer="${customer?.id || 'YOUR_ID'}"></script>`;

  if (loading) {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg flex flex-col items-center justify-start px-4 pt-12 pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-center bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
          ManyHandz
        </h1>
      </div>

      <ProgressBar step={step} />

      {/* Step 1 — Business Details */}
      {step === 1 && (
        <div className="aurora-card aurora-glow p-8 w-full max-w-xl animate-fade-in">
          <h2 className="text-2xl font-bold mb-1">Tell us about your business</h2>
          <p className="text-white/50 mb-6 text-sm">We'll use this to set up your AI automatically.</p>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-white/60 mb-1 block">Business name <span className="text-red-400">*</span></label>
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Smith Plumbing" />
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Website URL <span className="text-white/30">(optional)</span></label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="yoursite.com.au" />
              <p className="text-xs text-yellow-400/60 mt-1">We'll scan your website to set up your AI automatically</p>
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Industry</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)}>
                <option value="">Select your industry...</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">What do people most contact you about?</label>
              <textarea
                rows={3}
                value={contactAbout}
                onChange={e => setContactAbout(e.target.value)}
                placeholder="e.g. Booking appointments, asking about pricing, requesting quotes..."
              />
            </div>
          </div>

          <button className="btn-primary w-full mt-6 flex items-center justify-center gap-2" onClick={handleStep1} disabled={!businessName.trim()}>
            Next <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Step 2 — Scraping / Loading */}
      {step === 2 && (
        <div className="aurora-card aurora-glow p-12 w-full max-w-xl text-center animate-fade-in">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-600/20 to-yellow-400/20 animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-yellow-600/30 to-yellow-400/30 animate-ping" style={{ animationDuration: "2s" }} />
            <Loader2 className="w-20 h-20 text-yellow-400 animate-spin relative z-10" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Setting up your AI</h2>
          <p className="text-white/50 text-lg transition-all duration-500">
            {scrapeMessages[scrapePhase]}
          </p>
          <div className="flex justify-center gap-2 mt-6">
            {scrapeMessages.map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${i <= scrapePhase ? "bg-yellow-500" : "bg-white/15"}`} />
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — Review Knowledge Base */}
      {step === 3 && (
        <div className="aurora-card aurora-glow p-8 w-full max-w-2xl animate-fade-in">
          <h2 className="text-2xl font-bold mb-1">Review your knowledge base</h2>
          <p className="text-white/50 mb-6 text-sm">This is what your AI knows about your business. Edit anything that's wrong.</p>

          <div className="space-y-6">
            {/* About */}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-2 block">About your business</label>
              <textarea
                rows={3}
                value={about}
                onChange={e => setAbout(e.target.value)}
                placeholder="Describe what your business does..."
              />
            </div>

            {/* Services */}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-2 block">Your services</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {services.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-sm">
                    {s}
                    <button onClick={() => removeService(i)} className="hover:text-red-400 transition-colors">
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newService}
                  onChange={e => setNewService(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addService()}
                  placeholder="Add a service..."
                  className="flex-1"
                />
                <button onClick={addService} className="btn-secondary px-3">
                  <Plus size={18} />
                </button>
              </div>
            </div>

            {/* FAQs */}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-2 block">FAQs</label>
              <div className="space-y-3">
                {faqs.map((faq, i) => (
                  <div key={i} className="bg-white/5 rounded-xl p-4 relative group">
                    <button onClick={() => removeFaq(i)} className="absolute top-3 right-3 text-white/20 hover:text-red-400 transition-colors">
                      <X size={16} />
                    </button>
                    <input
                      value={faq.q}
                      onChange={e => updateFaq(i, "q", e.target.value)}
                      placeholder="Question"
                      className="mb-2 text-sm font-medium"
                    />
                    <textarea
                      rows={2}
                      value={faq.a}
                      onChange={e => updateFaq(i, "a", e.target.value)}
                      placeholder="Answer"
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
              <button onClick={addFaq} className="btn-secondary w-full mt-3 flex items-center justify-center gap-2 text-sm">
                <Plus size={16} /> Add FAQ
              </button>
            </div>

            {/* Business Hours */}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-2 block">Business hours</label>
              <div className="space-y-2">
                {hours.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-24 text-white/60">{h.day}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={h.closed}
                        onChange={e => updateHour(i, "closed", e.target.checked)}
                        className="w-4 h-4 accent-yellow-500"
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span className="text-white/40 text-xs">Closed</span>
                    </label>
                    {!h.closed && (
                      <>
                        <input
                          type="time"
                          value={h.open}
                          onChange={e => updateHour(i, "open", e.target.value)}
                          className="w-28 text-center text-sm py-1"
                        />
                        <span className="text-white/30">to</span>
                        <input
                          type="time"
                          value={h.close}
                          onChange={e => updateHour(i, "close", e.target.value)}
                          className="w-28 text-center text-sm py-1"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-3 block">Tone of voice</label>
              <div className="flex gap-3">
                {[
                  { id: "professional", label: "Professional", desc: "Formal and businesslike" },
                  { id: "friendly", label: "Friendly", desc: "Warm and approachable" },
                  { id: "casual", label: "Casual", desc: "Relaxed and conversational" },
                ].map(t => (
                  <button
                    key={t.id}
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

          <button className="btn-primary w-full mt-8 flex items-center justify-center gap-2" onClick={handleSaveKB}>
            Looks good <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Step 4 — Pick Product */}
      {step === 4 && (
        <div className="aurora-card aurora-glow p-8 w-full max-w-xl animate-fade-in">
          <h2 className="text-2xl font-bold mb-1">Pick your first product</h2>
          <p className="text-white/50 mb-6 text-sm">You can activate more from your dashboard anytime.</p>

          <div className="space-y-4">
            {[
              { id: "voice", icon: Phone, name: "Voice", desc: "AI answers your calls 24/7", tag: "Most popular", color: "from-green-500/20 to-emerald-500/20" },
              { id: "email", icon: Mail, name: "DraftPilot", desc: "AI drafts your email replies", color: "from-blue-500/20 to-cyan-500/20" },
              { id: "chat", icon: MessageSquare, name: "Chat Widget", desc: "AI chat for your website", color: "from-yellow-600/20 to-yellow-400/20" },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProduct(p.id)}
                className={`w-full aurora-card p-6 flex items-center gap-4 text-left transition-all group relative ${
                  selectedProduct === p.id
                    ? "border-yellow-500 bg-yellow-500/10 shadow-lg shadow-yellow-500/30"
                    : "hover:bg-white/5"
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                  <p.icon className={selectedProduct === p.id ? "text-white" : "text-white/70"} size={26} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-white text-lg">{p.name}</h3>
                  <p className="text-sm text-white/50">{p.desc}</p>
                </div>
                {p.tag && (
                  <span className="absolute top-3 right-3 text-xs bg-green-500/20 text-green-300 px-2.5 py-1 rounded-full font-medium">
                    {p.tag}
                  </span>
                )}
                {selectedProduct === p.id && (
                  <div className="w-6 h-6 rounded-full bg-yellow-500 flex items-center justify-center flex-shrink-0">
                    <Check size={14} className="text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {provisionError && <p className="text-red-400 text-sm mt-3">{provisionError}</p>}
          <button
            className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
            onClick={handleConnect}
            disabled={!selectedProduct || provisioning}
          >
            {provisioning ? "Setting up your number..." : <> Continue <ChevronRight size={18} /></>}
          </button>
        </div>
      )}

      {/* Step 5 — Connect */}
      {step === 5 && (
        <div className="aurora-card aurora-glow p-8 w-full max-w-xl animate-fade-in">
          {selectedProduct === "voice" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <Phone className="text-green-400" size={28} />
                </div>
                <h2 className="text-2xl font-bold mb-1">Your AI phone number</h2>
                <p className="text-white/50 text-sm">Forward your calls to this number and your AI takes over.</p>
              </div>

              <div className="aurora-card p-6 text-center mb-6">
                <div className="text-3xl font-bold text-yellow-400 tracking-wider mb-2">
                  {provisionedNumber || "+61 4XX XXX XXX"}
                </div>
                <p className="text-xs text-white/40">Your dedicated AI phone number</p>
              </div>

              <div className="aurora-card p-5 mb-6">
                <h3 className="font-semibold text-sm mb-3 text-yellow-400">How to forward your calls:</h3>
                <div className="space-y-2 text-sm text-white/60">
                  <p>📱 <strong className="text-white/80">iPhone:</strong> Settings → Phone → Call Forwarding → Enter number above</p>
                  <p>📱 <strong className="text-white/80">Android:</strong> Phone app → Settings → Call Forwarding → Enter number above</p>
                  <p>📞 <strong className="text-white/80">Landline:</strong> Contact your phone provider to set up forwarding</p>
                </div>
              </div>
            </>
          )}

          {selectedProduct === "email" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-4">
                  <Mail className="text-blue-400" size={28} />
                </div>
                <h2 className="text-2xl font-bold mb-1">Connect your email</h2>
                <p className="text-white/50 text-sm">Link your inbox so your AI can draft replies.</p>
              </div>

              <button
                className="w-full aurora-card p-5 flex items-center gap-4 hover:bg-white/5 transition-all mb-4"
                onClick={async () => {
                  try {
                    const { connectGmail } = await import("../lib/api");
                    const me = await (await import("../lib/api")).getMe();
                    const result = await connectGmail(me.customer.id);
                    if (result.url) window.location.href = result.url;
                  } catch (e) { alert("Failed to connect Gmail. Please try again."); }
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <span className="text-lg">📧</span>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Connect Gmail</div>
                  <div className="text-xs text-white/40">Sign in with Google to connect</div>
                </div>
                <ChevronRight size={18} className="text-white/30" />
              </button>

              <button
                className="w-full aurora-card p-5 flex items-center gap-4 hover:bg-white/5 transition-all mb-4"
                onClick={async () => {
                  try {
                    const { connectOutlook } = await import("../lib/api");
                    const me = await (await import("../lib/api")).getMe();
                    const result = await connectOutlook(me.customer.id);
                    if (result.url) window.location.href = result.url;
                  } catch (e) { alert("Failed to connect Outlook. Please try again."); }
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <span className="text-lg">📨</span>
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Connect Outlook</div>
                  <div className="text-xs text-white/40">Sign in with Microsoft to connect</div>
                </div>
                <ChevronRight size={18} className="text-white/30" />
              </button>

              <p className="text-xs text-white/30 text-center">More email providers coming soon</p>
            </>
          )}

          {selectedProduct === "chat" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-600/20 to-yellow-400/20 flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="text-yellow-400" size={28} />
                </div>
                <h2 className="text-2xl font-bold mb-1">Add chat to your website</h2>
                <p className="text-white/50 text-sm">Copy this code and paste it before the closing &lt;/body&gt; tag.</p>
              </div>

              <div className="aurora-card p-4 mb-4 relative group">
                <pre className="text-xs text-yellow-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {embedCode}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(embedCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="absolute top-3 right-3 btn-secondary px-2 py-1 text-xs flex items-center gap-1"
                >
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
            </>
          )}

          <button className="btn-primary w-full mt-4 flex items-center justify-center gap-2" onClick={handleFinish}>
            Done — go to dashboard <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Step 6 — Done */}
      {step === 6 && (
        <div className="aurora-card aurora-glow p-12 w-full max-w-xl text-center animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
            <Check className="text-green-400" size={40} />
          </div>
          <h2 className="text-3xl font-bold mb-3">You're all set! 🎉</h2>
          <p className="text-white/50 text-lg">Taking you to your dashboard...</p>
        </div>
      )}
    </div>
  );
}
