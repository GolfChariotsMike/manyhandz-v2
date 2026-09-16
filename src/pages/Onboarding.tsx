import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getKnowledgeBase,
  getMe,
  getVoiceConfig,
  provisionNumber,
  saveOnboardingKnowledge,
  saveVoiceNotifySms,
  updateProfile,
} from "../lib/api";
import { meCache } from "../lib/meCache";
import {
  clearOnboardingDraft,
  hoursRowsFromKnowledge,
  knowledgeLooksFilled,
  knowledgePayloadFromForm,
  normalizeHomeState,
  normalizeMarket,
  notifyMobilePlaceholder,
  ownerPhoneFromCustomer,
  profileUpdatesFromForm,
  provisionedNumberPlaceholder,
  resolveNotifySms,
} from "../lib/onboarding";
import { DEFAULT_HOURS, INDUSTRIES, applyIndustryTemplate, type FAQ, type HoursRow } from "../lib/onboarding-templates";
import KnowledgeEditor from "../components/KnowledgeEditor";
import { Check, ChevronRight, Loader2 } from "lucide-react";

type Step = "confirm" | "provisioning" | "done";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("confirm");
  const [customer, setCustomer] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [about, setAbout] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [hours, setHours] = useState<HoursRow[]>(DEFAULT_HOURS);
  const [tone, setTone] = useState("friendly");
  const [homeState, setHomeState] = useState("");
  const [notifyMobile, setNotifyMobile] = useState("");
  const [provisionedNumber, setProvisionedNumber] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const kbFilled = knowledgeLooksFilled({ about, services, faqs });

  useEffect(() => {
    (async () => {
      try {
        const { customer: c } = await getMe();
        if (c.onboarding_complete) {
          clearOnboardingDraft();
          navigate("/");
          return;
        }
        setCustomer(c);
        setBusinessName(c.business_name || "");
        setWebsite(c.website_url || "");
        setIndustry(c.industry || "");
        setHomeState(normalizeHomeState(c.home_state) || "");

        const [kbRows, voiceRows] = await Promise.all([
          getKnowledgeBase(c.id),
          getVoiceConfig(c.id),
        ]);
        const kb = Array.isArray(kbRows) ? kbRows[0] : null;
        const voice = Array.isArray(voiceRows) ? voiceRows[0] : null;
        if (knowledgeLooksFilled(kb)) {
          setAbout(typeof kb.about === "string" ? kb.about : "");
          setServices(Array.isArray(kb.services) ? kb.services.map(String) : []);
          setFaqs(Array.isArray(kb.faqs) ? kb.faqs : []);
          setHours(hoursRowsFromKnowledge(kb.hours));
          if (typeof kb.tone === "string" && kb.tone) setTone(kb.tone);
        } else {
          const template = applyIndustryTemplate(c.industry || "");
          if (template) {
            setAbout(template.about);
            setServices(template.services);
            setFaqs(template.faqs);
          }
        }
        const existingNotify = typeof voice?.notify_sms === "string" ? voice.notify_sms : ownerPhoneFromCustomer(c);
        setNotifyMobile(existingNotify || "");
        if (typeof c.twilio_number === "string" && c.twilio_number) {
          setProvisionedNumber(c.twilio_number);
        }
      } catch {
        navigate("/login");
        return;
      }
      setLoading(false);
    })();
  }, [navigate]);

  async function handleFinish() {
    if (!businessName.trim()) {
      setError("Add your business name.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await updateProfile(profileUpdatesFromForm({
        businessName,
        website: website || "",
        industry,
        homeState: normalizeMarket(customer?.country as string) === "AU" ? (homeState || null) : null,
      }));
      await saveOnboardingKnowledge(knowledgePayloadFromForm({
        about,
        services,
        faqs,
        hours,
        tone,
      }));
      const notify = resolveNotifySms({
        notifyMobile,
        country: typeof customer?.country === "string" ? customer.country : null,
        customer,
      });
      if (notify.notify_sms) {
        await saveVoiceNotifySms(notify);
      }

      const existingNumber = provisionedNumber || (typeof customer?.twilio_number === "string" ? customer.twilio_number : "");
      if (existingNumber) {
        await updateProfile(profileUpdatesFromForm({
          businessName,
          website: website || "",
          industry,
          onboardingComplete: true,
          homeState: normalizeMarket(customer?.country as string) === "AU" ? (homeState || null) : null,
        }));
        setProvisionedNumber(existingNumber);
      } else {
        setStep("provisioning");
        const customerId = typeof customer?.id === "string" ? customer.id : "";
        const data = await provisionNumber(customerId, typeof customer?.country === "string" ? customer.country : null);
        if (data.phone_number) setProvisionedNumber(data.phone_number);
      }
      meCache.clear();
      clearOnboardingDraft();
      setStep("done");
    } catch (e: unknown) {
      setStep("confirm");
      setError(e instanceof Error ? e.message : "Could not finish setup. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (step === "provisioning") {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-12 w-full max-w-xl text-center">
          <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-2">Getting your number</h2>
          <p className="text-white/50">Provisioning your ManyHandz line now…</p>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-10 w-full max-w-xl text-center animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
            <Check className="text-green-400" size={36} />
          </div>
          <h2 className="text-3xl font-bold mb-2">You&apos;re all set</h2>
          <p className="text-white/50 mb-8">Call this number to test your AI.</p>
          <div className="aurora-card p-6 mb-8">
            <div className="text-4xl font-bold text-yellow-400 tracking-wider mb-1">
              {provisionedNumber || provisionedNumberPlaceholder(customer?.country as string)}
            </div>
            <p className="text-xs text-white/40">Your AI answers this number 24/7</p>
          </div>
          <button className="btn-primary w-full" onClick={() => navigate("/")}>
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg flex flex-col items-center justify-start px-4 pt-12 pb-16">
      <h1 className="text-2xl font-bold text-center bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent mb-2">
        ManyHandz
      </h1>
      <p className="text-white/50 mb-8 text-sm text-center">
        {kbFilled ? "Confirm your setup, then we’ll get your number." : "Fill in a few details, then get your number."}
      </p>

      <div className="aurora-card aurora-glow p-8 w-full max-w-2xl animate-fade-in">
        <h2 className="text-2xl font-bold mb-1">{kbFilled ? "Looks good?" : "Finish your knowledge base"}</h2>
        <p className="text-white/50 mb-6 text-sm">
          Confirm your details and notify mobile. Your number is purchased on the next step.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-sm text-white/60 mb-1 block">Business name</label>
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Smith Plumbing" />
          </div>
          <div>
            <label className="text-sm text-white/60 mb-1 block">Industry</label>
            <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">Select...</option>
              {INDUSTRIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <KnowledgeEditor
          about={about}
          setAbout={setAbout}
          services={services}
          setServices={setServices}
          faqs={faqs}
          setFaqs={setFaqs}
          hours={hours}
          setHours={setHours}
          tone={tone}
          setTone={setTone}
          homeState={homeState}
          setHomeState={setHomeState}
          showHomeState={normalizeMarket(customer?.country as string) === "AU"}
        />

        <div className="aurora-card p-5 mt-6">
          <label className="text-sm font-semibold text-yellow-400 mb-2 block">Notify mobile</label>
          <input
            type="tel"
            placeholder={notifyMobilePlaceholder(customer?.country as string)}
            value={notifyMobile}
            onChange={(e) => setNotifyMobile(e.target.value)}
          />
          <p className="text-xs text-white/40 mt-2">Where should we SMS you when someone leaves a message?</p>
        </div>

        {error && <p className="text-red-400 text-sm mt-6">{error}</p>}

        <button
          className="btn-primary w-full mt-8 flex items-center justify-center gap-2"
          onClick={handleFinish}
          disabled={saving || !businessName.trim()}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Get my number <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
