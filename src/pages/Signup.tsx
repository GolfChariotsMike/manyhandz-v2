import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { requestMagicLink } from "../lib/api";
import { parseSignupCountry, signupWebsitePlaceholder } from "../lib/onboarding";
import { Mail } from "lucide-react";

const industries = [
  "Trade / Construction", "Hospitality", "Health / Allied Health",
  "Retail", "Professional Services", "Real Estate",
  "Sport / Fitness", "Education", "Other",
];

export default function Signup() {
  const [params] = useSearchParams();
  const country = parseSignupCountry(params.get("country"));
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestMagicLink(email, businessName, industry, website, country);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
        <div className="aurora-card aurora-glow p-10 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="text-yellow-400" size={28} />
          </div>
          <h2 className="text-2xl font-bold mb-3">Check your email</h2>
          <p className="text-white/50 mb-2">We sent a sign-in link to</p>
          <p className="text-yellow-400 font-semibold mb-6">{email}</p>
          <p className="text-white/30 text-sm">Click the link in the email to get started. It expires in 15 minutes.</p>
          <button className="text-white/30 text-xs mt-8 hover:text-white/50 transition-colors" onClick={() => setSent(false)}>
            Wrong email? Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
      <div className="aurora-card aurora-glow p-8 w-full max-w-lg">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
          Get started free
        </h1>
        <p className="text-white/50 mb-8">Set up your AI team in under 5 minutes</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-white/60 mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@yourbusiness.com" />
          </div>
          <div>
            <label className="text-sm text-white/60 mb-1 block">Business name</label>
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Smith Plumbing" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-white/60 mb-1 block">Industry</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)}>
                <option value="">Select...</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Website <span className="text-white/30">(optional)</span></label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder={signupWebsitePlaceholder(country)} />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading || !email}>
            {loading ? "Sending link..." : "Send me a sign-in link →"}
          </button>
          <p className="text-white/30 text-xs text-center">No password needed. We'll email you a link.</p>
        </form>

        <p className="text-white/40 text-sm mt-6 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-yellow-400 hover:text-yellow-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
