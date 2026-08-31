import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, scrapeWebsite, updateProfile, saveOnboardingKnowledge } from "../lib/api";
import { meCache } from "../lib/meCache";
import {
  canApplyScrapedKb,
  clearOnboardingDraft,
  initialWebsite,
  knowledgePayloadFromForm,
  loadDraftForCustomer,
  onboardingNumberBlurb,
  notifyMobilePlaceholder,
  profileUpdatesFromForm,
  provisionNumberBody,
  provisionedNumberPlaceholder,
  saveOnboardingDraft,
  signupWebsitePlaceholder,
} from "../lib/onboarding";
import { Check, Loader2, Plus, X, ChevronRight } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

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

const stepLabels = ["Business Details", "Scanning", "Knowledge Base", "Connect", "Done"];

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

  // Do not hydrate from localStorage until we know customer.id — leftover
  // drafts from the last account Mike onboarded in this browser used to stick.
  const [step, setStep] = useState<Step>(1);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [contactAbout, setContactAbout] = useState("");

  const [about, setAbout] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [hours, setHours] = useState<HoursRow[]>(defaultHours);
  const [tone, setTone] = useState("friendly");

  const [noWebsite, setNoWebsite] = useState(false);

  const [provisionedNumber, setProvisionedNumber] = useState("");
  const [notifyMobile, setNotifyMobile] = useState("");
  const [scanRequestedUrl, setScanRequestedUrl] = useState("");
  const [scanFinalUrl, setScanFinalUrl] = useState("");
  const [scanNote, setScanNote] = useState("");
  const [step1Error, setStep1Error] = useState("");
  const [step1Saving, setStep1Saving] = useState(false);
  const [kbError, setKbError] = useState("");
  const [kbSaving, setKbSaving] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [finishSaving, setFinishSaving] = useState(false);

  // Scraping animation
  const [scrapePhase, setScrapePhase] = useState(0);
  const scrapeMessages = [
    "Scanning your website...",
    "Extracting business information...",
    "Building your knowledge base...",
    "Almost ready..."
  ];

  // Init — load this customer only. Discard a draft that belongs to someone else.
  useEffect(() => {
    (async () => {
      try {
        const { customer: c } = await getMe();
        setCustomer(c);

        const draft = loadDraftForCustomer(c.id);
        const belongs = Boolean(draft);
        setBusinessName((draft?.businessName as string) || c.business_name || "");
        setWebsite(initialWebsite({
          typedThisSession: "",
          draftWebsite: (draft?.website as string) || "",
          customerWebsite: c.website_url || "",
          draftBelongsToCustomer: belongs,
        }));
        setIndustry((draft?.industry as string) || c.industry || "");
        setContactAbout((draft?.contactAbout as string) || "");
        setAbout((draft?.about as string) || "");
        setServices((draft?.services as string[]) || []);
        setFaqs((draft?.faqs as FAQ[]) || []);
        setHours((draft?.hours as HoursRow[]) || defaultHours);
        setTone((draft?.tone as string) || "friendly");
        setNoWebsite(Boolean(draft?.noWebsite));
        setProvisionedNumber((draft?.provisionedNumber as string) || "");
        setNotifyMobile((draft?.notifyMobile as string) || "");
        setScanRequestedUrl((draft?.scanRequestedUrl as string) || "");
        setScanFinalUrl((draft?.scanFinalUrl as string) || "");
        setScanNote((draft?.scanNote as string) || "");
        const restored = belongs && draft?.step ? (draft.step as Step) : 1;
        setStep(restored === 2 ? 1 : restored);

        if (c.onboarding_complete) {
          clearOnboardingDraft();
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

  useEffect(() => {
    if (!loading && customer?.id) {
      saveOnboardingDraft({
        customerId: customer.id,
        step,
        businessName,
        website,
        industry,
        contactAbout,
        about,
        services,
        faqs,
        hours,
        tone,
        provisionedNumber,
        noWebsite,
        notifyMobile,
        scanRequestedUrl,
        scanFinalUrl,
        scanNote,
      });
    }
  }, [step, businessName, website, industry, contactAbout, about, services, faqs, hours, tone, provisionedNumber, noWebsite, notifyMobile, scanRequestedUrl, scanFinalUrl, scanNote, loading, customer?.id]);

  function goStep(s: Step) { setStep(s); }

  // Step 1 → Step 2/3
  async function handleStep1() {
    if (!businessName.trim()) return;
    setStep1Error("");
    setStep1Saving(true);
    try {
      await updateProfile(profileUpdatesFromForm({
        businessName,
        website: website || "",
        industry,
      }));
    } catch (e: unknown) {
      setStep1Error(e instanceof Error ? e.message : "Could not save business details. Please try again.");
      setStep1Saving(false);
      return;
    }
    setStep1Saving(false);

    if (website.trim()) {
      goStep(2);
      setScrapePhase(0);
      const interval = setInterval(() => {
        setScrapePhase(p => Math.min(p + 1, scrapeMessages.length - 1));
      }, 3000);

      const applyTemplate = () => {
        if (industry && industryTemplates[industry]) {
          const t = industryTemplates[industry];
          setAbout(t.about);
          setServices(t.services);
          setFaqs(t.faqs);
        }
      };

      try {
        const typedUrl = website.trim();
        const url = typedUrl.startsWith("http") ? typedUrl : `https://${typedUrl}`;
        const data = await scrapeWebsite(url);
        const requested = data.requested_url || url;
        const finalUrl = data.final_url || requested;
        setScanRequestedUrl(requested);
        setScanFinalUrl(finalUrl);

        if (canApplyScrapedKb(typedUrl, data)) {
          setScanNote("");
          setAbout(data.about || "");
          setServices(data.services || []);
          setFaqs(data.faqs || []);
          if (data.hours) {
            const merged = defaultHours.map(h => {
              const scraped = data.hours?.[h.day.toLowerCase()];
              if (scraped) return { ...h, open: scraped.open || h.open, close: scraped.close || h.close, closed: scraped.closed ?? h.closed };
              return h;
            });
            setHours(merged);
          }
          if (data.tone) setTone(data.tone);
        } else {
          if (data.thin_content) {
            setScanNote("We couldn't read enough from that site (it might be pictures or a login page). Fill this in yourself.");
          } else {
            setScanNote("That address sent us to a different site, so we left this blank rather than guess.");
          }
          setAbout("");
          setServices([]);
          setFaqs([]);
          applyTemplate();
        }
      } catch {
        setScanRequestedUrl(website.trim());
        setScanFinalUrl("");
        setScanNote("We couldn't scan that site. Fill this in yourself.");
        applyTemplate();
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

  // Step 3 → save KB then auto-provision voice
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");

  async function handleSaveKB() {
    setKbError("");
    setKbSaving(true);
    try {
      await saveOnboardingKnowledge(knowledgePayloadFromForm({
        about,
        services,
        faqs,
        hours,
        tone,
      }));
    } catch (e: unknown) {
      setKbError(e instanceof Error ? e.message : "Could not save knowledge base. Please try again.");
      setKbSaving(false);
      return;
    }
    setKbSaving(false);
    // Auto-provision voice number — skip if already provisioned
    if (customer?.id && !customer.twilio_number && !provisionedNumber) {
      setProvisioning(true);
      setProvisionError("");
      try {
        const res = await fetch(`https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mh-provision-number`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw` },
          body: JSON.stringify(provisionNumberBody(customer.id, customer.country)),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to provision number");
        if (data.phone_number) setProvisionedNumber(data.phone_number);
      } catch (e: any) {
        setProvisionError(e.message || "Could not provision a number. Please contact support.");
      } finally {
        setProvisioning(false);
      }
    } else if (customer?.twilio_number && !provisionedNumber) {
      // Already provisioned — just show the existing number
      setProvisionedNumber(customer.twilio_number);
    }
    goStep(4);
  }

  // Finish onboarding
  async function handleFinish() {
    setFinishError("");
    setFinishSaving(true);
    try {
      await updateProfile(profileUpdatesFromForm({
        businessName,
        website: website || "",
        industry,
        onboardingComplete: true,
      }));
      meCache.clear();
      clearOnboardingDraft();
      goStep(5);
      setTimeout(() => navigate("/"), 2000);
    } catch (e: unknown) {
      setFinishError(e instanceof Error ? e.message : "Could not finish onboarding. Please try again.");
      setFinishSaving(false);
    }
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

  // embedCode removed (chat widget step removed)

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
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder={signupWebsitePlaceholder(customer?.country)} disabled={noWebsite} className={noWebsite ? "opacity-40" : ""} />
              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noWebsite}
                    onChange={e => { setNoWebsite(e.target.checked); if (e.target.checked) setWebsite(""); }}
                    className="w-4 h-4 accent-yellow-500"
                    style={{ width: "16px", height: "16px" }}
                  />
                  <span className="text-xs text-white/50">I don't have a website</span>
                </label>
              </div>
              {!noWebsite && <p className="text-xs text-yellow-400/60 mt-1">We'll scan your website to set up your AI automatically</p>}
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

          {step1Error && <p className="text-red-400 text-sm mt-4">{step1Error}</p>}

          <button className="btn-primary w-full mt-6 flex items-center justify-center gap-2" onClick={handleStep1} disabled={!businessName.trim() || step1Saving}>
            {step1Saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
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
            {scanRequestedUrl && (
              <div className="aurora-card p-5">
                <label className="text-sm font-semibold text-yellow-400 mb-2 block">Website we scanned</label>
                <p className="text-sm text-white/80 break-all">{scanRequestedUrl}</p>
                {scanFinalUrl && scanFinalUrl !== scanRequestedUrl && (
                  <p className="text-xs text-white/50 mt-2 break-all">
                    After redirects that became: {scanFinalUrl}
                  </p>
                )}
                {scanNote && <p className="text-xs text-yellow-400/80 mt-2">{scanNote}</p>}
              </div>
            )}
            <div className="aurora-card p-5">
              <label className="text-sm font-semibold text-yellow-400 mb-2 block">📞 Your ManyHandz number</label>
              <p className="text-sm text-white/70">{onboardingNumberBlurb(customer?.country)}</p>
            </div>
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

          {kbError && <p className="text-red-400 text-sm mt-6">{kbError}</p>}

          <div className="flex gap-3 mt-8">
            <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={handleSaveKB} disabled={kbSaving}>
              {kbSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Looks good <ChevronRight size={18} />
            </button>
            <button className="btn-secondary px-5 text-sm text-white/50 hover:text-white/70" onClick={() => goStep(4)}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Number ready */}
      {step === 4 && (
        <div className="aurora-card aurora-glow p-10 w-full max-w-xl animate-fade-in text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
            <Check className="text-green-400" size={36} />
          </div>
          <h2 className="text-3xl font-bold mb-2">You're all set! 🎉</h2>
          <p className="text-white/50 mb-8">Your AI is live. Here's your dedicated number:</p>

          {provisioning && <p className="text-yellow-400/70 text-sm mb-4">Provisioning your number...</p>}
          {provisionError && <p className="text-red-400 text-sm mb-4">{provisionError}</p>}

          <div className="aurora-card p-4 mb-6 text-left">
            <label className="text-xs text-white/40 block mb-1">Where should we SMS you when someone leaves a message?</label>
            <input
              type="tel"
              placeholder={notifyMobilePlaceholder(customer?.country)}
              value={notifyMobile}
              onChange={e => setNotifyMobile(e.target.value)}
              className="w-full bg-transparent text-white text-sm outline-none placeholder:text-white/20"
            />
          </div>

          <div className="aurora-card p-6 mb-8 inline-block w-full">
            <div className="text-4xl font-bold text-yellow-400 tracking-wider mb-1">
              {provisionedNumber || provisionedNumberPlaceholder(customer?.country)}
            </div>
            <p className="text-xs text-white/40">Your AI answers calls to this number 24/7</p>
          </div>

          <p className="text-white/30 text-sm mb-8">Call it right now to hear your AI in action. We'll walk you through going live from your dashboard.</p>

          {finishError && <p className="text-red-400 text-sm mb-4">{finishError}</p>}

          <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={handleFinish} disabled={finishSaving}>
            {finishSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Go to dashboard <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Step 5 — Done */}
      {step === 5 && (
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
