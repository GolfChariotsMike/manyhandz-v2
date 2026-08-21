import { useState, useEffect } from "react";
import { Loader2, CheckCircle, AlertCircle, Clock, CreditCard, Zap, Check } from "lucide-react";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";
const PROVISION_URL = "https://provision.manyhandz.ai";

const PRICES = {
  monthly: { id: "price_1U6On9Ex2m1vqgKrd4WcbAo5", label: "Monthly", amount: "$199", period: "/mo", savings: null },
  annual:  { id: "price_1U6OnAEx2m1vqgKribI5jcGM", label: "Annual", amount: "$116", period: "/mo", savings: "Save 30% — billed $1,399/yr" },
};

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

function daysLeft(trialEndsAt: string) {
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function Billing() {
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<"monthly" | "annual">("monthly");
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        if (!me?.id) { setLoading(false); return; }
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/mh_v2_customers?id=eq.${me.id}&select=subscription_status,trial_ends_at,plan,stripe_subscription_id,twilio_number`,
          { headers: authHeaders() }
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) setCustomer(rows[0]);
      } catch (e: any) {
        setError(e.message || "Failed to load billing info");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCheckout() {
    setCheckingOut(true);
    setError("");
    try {
      const me = await getMe();
      const res = await fetch(`${PROVISION_URL}/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: me.id, price_id: PRICES[plan].id, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Failed to create checkout session");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-yellow-400" size={32} />
    </div>
  );

  const status = customer?.subscription_status;
  const trialEnd = customer?.trial_ends_at;
  const days = trialEnd ? daysLeft(trialEnd) : 0;
  const isActive = status === "active";
  const isExpired = status === "expired" || (status === "trial" && days === 0);
  const isTrial = status === "trial" && days > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Billing</h1>
        <p className="text-white/40 text-sm">Manage your plan and subscription.</p>
      </div>

      {/* Status card */}
      <div className={`aurora-card p-6 flex items-start gap-4 ${isExpired ? "border-red-500/40" : isTrial ? "border-yellow-500/40" : "border-green-500/40"}`}>
        {isActive && <CheckCircle className="text-green-400 shrink-0 mt-0.5" size={20} />}
        {isTrial && <Clock className="text-yellow-400 shrink-0 mt-0.5" size={20} />}
        {isExpired && <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />}
        <div>
          {isActive && (
            <>
              <div className="font-semibold text-green-400">Active — {customer.plan === "annual" ? "Annual plan" : "Monthly plan"}</div>
              <div className="text-sm text-white/40 mt-0.5">Your AI receptionist is live and answering calls.</div>
            </>
          )}
          {isTrial && (
            <>
              <div className="font-semibold text-yellow-400">{days} day{days !== 1 ? "s" : ""} left in your free trial</div>
              <div className="text-sm text-white/40 mt-0.5">Add a payment method before your trial ends to keep your number and agent.</div>
            </>
          )}
          {isExpired && (
            <>
              <div className="font-semibold text-red-400">Trial expired — service paused</div>
              <div className="text-sm text-white/40 mt-0.5">Your AI is no longer answering calls. Subscribe to reactivate.</div>
            </>
          )}
        </div>
      </div>

      {/* Plan selector — show if not active */}
      {!isActive && (
        <div className="aurora-card p-6 space-y-6">
          <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2"><CreditCard size={14} /> Choose a plan</h2>

          <div className="flex gap-3">
            {(["monthly", "annual"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                className={`flex-1 aurora-card p-4 text-left transition-all relative cursor-pointer ${plan === p ? "border-yellow-400 bg-yellow-500/15 ring-2 ring-yellow-400/60" : "border-white/10 hover:border-white/20 hover:bg-white/5"}`}
              >
                {plan === p && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center">
                    <Check size={12} className="text-black" strokeWidth={3} />
                  </div>
                )}
                {p === "annual" && (
                  <div className="absolute -top-2.5 right-3 bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">BEST VALUE</div>
                )}
                <div className="font-bold text-xl">{PRICES[p].amount}<span className="text-sm font-normal text-white/40">{PRICES[p].period}</span></div>
                <div className="text-sm font-medium mt-1">{PRICES[p].label}</div>
                {PRICES[p].savings && <div className="text-xs text-yellow-400 mt-1">{PRICES[p].savings}</div>}
              </button>
            ))}
          </div>

          <div className="space-y-2 text-sm text-white/50">
            {["Dedicated AU phone number", "600 mins/mo included", "AI answers every call 24/7", "Message notifications via SMS", "Staff call transfers", "Knowledge base updates", "Cancel anytime"].map(f => (
              <div key={f} className="flex items-center gap-2"><Zap size={12} className="text-yellow-400" />{f}</div>
            ))}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleCheckout}
            disabled={checkingOut}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {checkingOut ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
            {checkingOut ? "Redirecting to checkout..." : `Subscribe — ${PRICES[plan].amount}${PRICES[plan].period}`}
          </button>

          <p className="text-xs text-white/30 text-center">Secure checkout via Stripe. Cancel anytime.</p>
        </div>
      )}

      {/* Active plan details */}
      {isActive && (
        <div className="aurora-card p-6">
          <h2 className="text-sm font-semibold text-yellow-400 mb-4">Plan details</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/40">Plan</span><span>{customer.plan === "annual" ? "Annual ($1,399/yr)" : "Monthly ($199/mo)"}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Number</span><span>{customer.twilio_number || "—"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
