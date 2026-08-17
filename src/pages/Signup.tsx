import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signup } from "../lib/api";

const industries = [
  "Trade / Construction", "Hospitality", "Health / Allied Health",
  "Retail", "Professional Services", "Real Estate",
  "Sport / Fitness", "Education", "Other",
];

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(email, password, businessName, industry, website);
      navigate("/onboarding");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
      <div className="aurora-card aurora-glow p-8 w-full max-w-lg">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
          Get started free
        </h1>
        <p className="text-white/50 mb-8">Set up your AI team in under 5 minutes</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-sm text-white/60 mb-1 block">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-white/60 mb-1 block">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-white/60 mb-1 block">Business name</label>
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Smith Plumbing" />
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Industry</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)}>
                <option value="">Select...</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-white/60 mb-1 block">Website (optional)</label>
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="yoursite.com.au" />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Creating your account..." : "Create account"}
          </button>
        </form>

        <p className="text-white/40 text-sm mt-6 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-yellow-400 hover:text-yellow-400">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
