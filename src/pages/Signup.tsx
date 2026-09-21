import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HONEYPOT_FIELD, assessSignupWebsiteUrl } from "../../supabase/functions/_shared/signup-protection.ts";
import { requestSignupLink, scrapeWebsite } from "../lib/api";
import {
  canApplyScrapedKb,
  hoursRowsFromKnowledge,
  normalizeHomeState,
  normalizeMarket,
  notifyMobilePlaceholder,
  parseSignupCountry,
  parseSignupEmail,
  signupWebsitePlaceholder,
  type Market,
} from "../lib/onboarding";
import {
  DEFAULT_HOURS,
  INDUSTRIES,
  SIGNUP_CAPABILITY_CHIPS,
  applyIndustryTemplate,
  type FAQ,
  type HoursRow,
  type SignupCapabilityId,
} from "../lib/onboarding-templates";
import { MAGIC_LINK_EXPIRY_COPY, buildSignupLinkPayload, toggleSignupCapability, turnstileSiteKey } from "../lib/signup-draft";
import KnowledgeEditor from "../components/KnowledgeEditor";
import TurnstileField from "../components/TurnstileField";
import { ChevronRight, Loader2, Mail } from "lucide-react";

type Step = "details" | "scan" | "preview" | "sent";

const scrapeMessages = [
  "Scanning your website...",
  "Extracting business information...",
  "Building your knowledge base...",
  "Almost ready...",
];

export default function Signup() {
  const [params, setParams] = useSearchParams();
  const country = parseSignupCountry(params.get("country"));

  function selectCountry(market: Market) {
    const next = new URLSearchParams(params);
    next.set("country", market);
    setParams(next, { replace: true });
  }
  const [email, setEmail] = useState(() => parseSignupEmail(params.get("email")));
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [noWebsite, setNoWebsite] = useState(false);
  const [capabilities, setCapabilities] = useState<SignupCapabilityId[]>([]);
  const [notifyMobile, setNotifyMobile] = useState("");
  const [about, setAbout] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [hours, setHours] = useState<HoursRow[]>(DEFAULT_HOURS);
  const [tone, setTone] = useState("friendly");
  const [homeState, setHomeState] = useState("");
  const [scanRequestedUrl, setScanRequestedUrl] = useState("");
  const [scanFinalUrl, setScanFinalUrl] = useState("");
  const [scanNote, setScanNote] = useState("");
  const [scrapePhase, setScrapePhase] = useState(0);
  const [step, setStep] = useState<Step>("details");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [companyFax, setCompanyFax] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  function applyTemplateIfEmpty(nextIndustry = industry) {
    const template = applyIndustryTemplate(nextIndustry);
    if (!template) return;
    setAbout((current) => current || template.about);
    setServices((current) => current.length ? current : template.services);
    setFaqs((current) => current.length ? current : template.faqs);
  }

  async function handleDetailsNext() {
    setError("");
    if (!noWebsite) {
      const websiteCheck = assessSignupWebsiteUrl(website);
      if (!websiteCheck.ok) {
        setError(websiteCheck.message);
        return;
      }
    }
    if (noWebsite) {
      applyTemplateIfEmpty();
      setStep("preview");
      return;
    }

    setStep("scan");
    setScrapePhase(0);
    const interval = setInterval(() => {
      setScrapePhase((p) => Math.min(p + 1, scrapeMessages.length - 1));
    }, 3000);

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
        if (typeof data.business_name === "string" && data.business_name.trim()) {
          setBusinessName((current) => current || data.business_name);
        }
        if (!industry && typeof data.industry === "string" && (INDUSTRIES as readonly string[]).includes(data.industry)) {
          setIndustry(data.industry);
        }
        setAbout(data.about || "");
        setServices(Array.isArray(data.services) ? data.services.map(String) : []);
        setFaqs(Array.isArray(data.faqs) ? data.faqs : []);
        if (data.hours) setHours(hoursRowsFromKnowledge(data.hours));
        if (data.tone) setTone(data.tone);
        const scrapedState = normalizeHomeState(data.home_state);
        if (scrapedState && country === "AU") setHomeState(scrapedState);
      } else {
        setScanNote(data.thin_content
          ? "We couldn't read enough from that site (it might be pictures or a login page). Fill this in yourself."
          : "That address sent us to a different site, so we left this blank rather than guess.");
        applyTemplateIfEmpty();
      }
    } catch {
      setScanRequestedUrl(website.trim());
      setScanFinalUrl("");
      setScanNote("We couldn't scan that site. Fill this in yourself.");
      applyTemplateIfEmpty();
    }
    clearInterval(interval);
    setStep("preview");
  }

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!businessName.trim()) {
      setError("Add your business name so we can set up your AI.");
      return;
    }
    if (!companyFax.trim() && turnstileSiteKey() && !turnstileToken.trim()) {
      setError("Please wait a moment and try again.");
      return;
    }
    setLoading(true);
    try {
      await requestSignupLink(buildSignupLinkPayload({
        email,
        businessName,
        industry,
        website,
        country,
        homeState,
        notifyMobile,
        capabilities,
        about,
        services,
        faqs,
        hours,
        tone,
        noWebsite,
        turnstileToken,
        companyFax,
      }));
      setStep("sent");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send your setup link.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "sent") {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-10 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="text-yellow-400" size={28} />
          </div>
          <h2 className="text-2xl font-bold mb-3">Your setup is ready</h2>
          <p className="text-white/50 mb-2">We emailed a link to get your number:</p>
          <p className="text-yellow-400 font-semibold mb-6">{email}</p>
          <p className="text-white/30 text-sm">Open it to confirm your email and claim your ManyHandz number. It expires in {MAGIC_LINK_EXPIRY_COPY}.</p>
          <button className="text-white/30 text-xs mt-8 hover:text-white/50 transition-colors" onClick={() => setStep("preview")}>
            Wrong email? Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg flex flex-col items-center justify-start px-4 pt-12 pb-16">
      <h1 className="text-2xl font-bold text-center bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent mb-2">
        Get started free
      </h1>
      <p className="text-white/50 mb-8 text-sm text-center">Build your AI first. We’ll email a setup link when you’re ready.</p>

      {step === "details" && (
        <div className="aurora-card aurora-glow p-8 w-full max-w-xl animate-fade-in relative">
          <h2 className="text-2xl font-bold mb-1">Tell us about your business</h2>
          <p className="text-white/50 mb-6 text-sm">No login yet — we’ll scan your site and preview your AI first.</p>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-white/60 mb-2 block">Country</label>
              <div className="grid grid-cols-2 gap-3">
                {(["AU", "US"] as Market[]).map((market) => (
                  <button
                    key={market}
                    type="button"
                    onClick={() => selectCountry(market)}
                    className={`aurora-card p-3 text-sm font-semibold transition-all ${
                      country === market ? "border-yellow-500 bg-yellow-500/10 text-yellow-400" : "text-white/60 hover:bg-white/5"
                    }`}
                  >
                    {market === "AU" ? "Australia" : "United States"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1 block">Website</label>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={signupWebsitePlaceholder(country)}
                disabled={noWebsite}
                className={noWebsite ? "opacity-40" : ""}
              />
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={noWebsite}
                  onChange={(e) => {
                    setNoWebsite(e.target.checked);
                    if (e.target.checked) setWebsite("");
                  }}
                  className="w-4 h-4 accent-yellow-500"
                  style={{ width: "16px", height: "16px" }}
                />
                <span className="text-xs text-white/50">I don’t have a website</span>
              </label>
            </div>

            <div className="mh-hp" aria-hidden="true">
              <label>
                Company fax
                <input
                  type="text"
                  name={HONEYPOT_FIELD}
                  tabIndex={-1}
                  autoComplete="off"
                  value={companyFax}
                  onChange={(e) => setCompanyFax(e.target.value)}
                />
              </label>
            </div>

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

            <div>
              <label className="text-sm text-white/60 mb-2 block">What should your AI do? <span className="text-white/30">(optional)</span></label>
              <div className="flex flex-wrap gap-2">
                {SIGNUP_CAPABILITY_CHIPS.map((chip) => {
                  const on = capabilities.includes(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setCapabilities((current) => toggleSignupCapability(current, chip.id))}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                        on ? "bg-yellow-500/20 border-yellow-500 text-yellow-400" : "border-white/15 text-white/50 hover:bg-white/5"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1 block">Notify mobile <span className="text-white/30">(optional)</span></label>
              <input
                type="tel"
                value={notifyMobile}
                onChange={(e) => setNotifyMobile(e.target.value)}
                placeholder={notifyMobilePlaceholder(country)}
              />
              <p className="text-xs text-white/30 mt-1">We’ll SMS you when someone leaves a message.</p>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

          <button type="button" className="btn-primary w-full mt-6 flex items-center justify-center gap-2" onClick={handleDetailsNext}>
            {noWebsite ? "Preview my setup" : "Scan my website"} <ChevronRight size={18} />
          </button>
          <p className="text-white/40 text-sm mt-6 text-center">
            Already have an account?{" "}
            <Link to="/login" className="text-yellow-400 hover:text-yellow-300">Sign in</Link>
          </p>
        </div>
      )}

      {step === "scan" && (
        <div className="aurora-card aurora-glow p-12 w-full max-w-xl text-center animate-fade-in">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-600/20 to-yellow-400/20 animate-pulse" />
            <Loader2 className="w-20 h-20 text-yellow-400 animate-spin relative z-10" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Setting up your AI</h2>
          <p className="text-white/50 text-lg">{scrapeMessages[scrapePhase]}</p>
        </div>
      )}

      {step === "preview" && (
        <form onSubmit={handleSendLink} className="aurora-card aurora-glow p-8 w-full max-w-2xl animate-fade-in relative">
          <h2 className="text-2xl font-bold mb-1">Review your knowledge base</h2>
          <p className="text-white/50 mb-6 text-sm">Edit anything that’s wrong. Then we’ll email your setup link — no number is purchased yet.</p>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm text-white/60 mb-1 block">Business name <span className="text-red-400">*</span></label>
              <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required placeholder="e.g. Smith Plumbing" />
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
            showHomeState={normalizeMarket(country) === "AU"}
            scanRequestedUrl={scanRequestedUrl}
            scanFinalUrl={scanFinalUrl}
            scanNote={scanNote}
          />

          <div className="mt-8">
            <label className="text-sm text-white/60 mb-1 block">Email me my setup link</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@yourbusiness.com" />
          </div>

          <div className="mh-hp" aria-hidden="true">
            <label>
              Company fax
              <input
                type="text"
                name={HONEYPOT_FIELD}
                tabIndex={-1}
                autoComplete="off"
                value={companyFax}
                onChange={(e) => setCompanyFax(e.target.value)}
              />
            </label>
          </div>

          <TurnstileField onToken={setTurnstileToken} />

          {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

          <button type="submit" className="btn-primary w-full mt-6 flex items-center justify-center gap-2" disabled={loading || !email || !businessName.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Sending link..." : "Email me my setup link →"}
          </button>
          <button type="button" className="btn-secondary w-full mt-3 text-sm text-white/50" onClick={() => setStep("details")}>
            Back
          </button>
          <p className="text-white/30 text-xs text-center mt-4">We’ll email a link that expires in {MAGIC_LINK_EXPIRY_COPY}. Your number is provisioned after you confirm.</p>
        </form>
      )}
    </div>
  );
}
