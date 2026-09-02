import { useState } from "react";
import { Link } from "react-router-dom";
import { requestMagicLink } from "../lib/api";
import { classifyLoginError, signupUrlFromLoginEmail } from "../lib/login";
import { Mail } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [unknownEmail, setUnknownEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim());
  const signupHref = signupUrlFromLoginEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setUnknownEmail(false);
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (err: unknown) {
      const classified = classifyLoginError(err);
      if (classified.kind === "no_account") {
        setUnknownEmail(true);
      } else {
        setError(classified.message);
      }
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
          <p className="text-white/30 text-sm">Click the link in the email to sign in. It expires in 15 minutes.</p>
          <button className="text-white/30 text-xs mt-8 hover:text-white/50 transition-colors" onClick={() => setSent(false)}>
            Wrong email? Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
      <div className="aurora-card aurora-glow p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">
          ManyHandz
        </h1>
        <p className="text-white/50 mb-8">Sign in to your dashboard</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-white/60 mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setUnknownEmail(false); }} required placeholder="you@yourbusiness.com" autoFocus />
          </div>

          {unknownEmail && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-3">
              <p className="text-yellow-100 text-sm">No account for that email. Create a new account?</p>
              <Link to={signupHref} className="btn-primary w-full inline-block text-center">
                Create a new account
              </Link>
            </div>
          )}

          {error && !unknownEmail && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading || !email}>
            {loading ? "Sending link..." : "Send me a sign-in link →"}
          </button>
          <p className="text-white/30 text-xs text-center">No password needed. We'll email you a secure link.</p>
        </form>

        <p className="text-white/40 text-sm mt-6 text-center">
          Don't have an account?{" "}
          <Link to={signupHref} className="text-yellow-400 hover:text-yellow-300">Get started free</Link>
        </p>
      </div>
    </div>
  );
}
