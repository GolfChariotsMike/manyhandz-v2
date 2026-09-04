import { useState, useEffect } from "react";
import { Loader2, CheckCircle, AlertCircle, Clock, CreditCard, Zap, Check } from "lucide-react";
import { getMe } from "../lib/api";
import { trialCountdown, trialCountdownHeadline } from "../lib/trialCountdown";
import {
  BIG_BUSINESS_INCLUDED_MINUTES,
  SMALL_BUSINESS_INCLUDED_MINUTES,
} from "../../supabase/functions/_shared/plan-minutes.ts";

const PROVISION_URL = "https://provision.manyhandz.ai";

const PLANS = {
  small_business: {
    label: "Small Business",
    description: `${SMALL_BUSINESS_INCLUDED_MINUTES} mins/mo included`,
    monthly: { id: "price_1U6On9Ex2m1vqgKrd4WcbAo5", amount: "$199", period: "/mo", savings: null },
    annual:  { id: "price_1U6OnAEx2m1vqgKribI5jcGM", amount: "$116", period: "/mo", savings: "Save 30% — billed $1,399/yr" },
  },
  big_business: {
    label: "Big Business",
    description: `${BIG_BUSINESS_INCLUDED_MINUTES.toLocaleString("en-US")} mins/mo included`,
    monthly: { id: "price_1U6tqpEx2m1vqgKrwkDcVZnu", amount: "$499", period: "/mo", savings: null },
    annual:  { id: "price_1U6tquEx2m1vqgKrgYZmvdMo", amount: "$349", period: "/mo", savings: "Save 30% — billed $4,199/yr" },
  },
};

type BillingCustomer = {
  id?: string;
  subscription_status?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  plan?: string | null;
  twilio_number?: string | null;
};

export default function Billing() {
  const [customer, setCustomer] = useState<BillingCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [tier, setTier] = useState<"small_business" | "big_business">("small_business");
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { customer: me } = await getMe();
        if (me?.id) setCustomer(me);
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
      const { customer: me } = await getMe();
      const selectedPrice = PLANS[tier][billing];
      const res = await fetch(`${PROVISION_URL}/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: me.id, price_id: selectedPrice.id, plan: `${tier}_${billing}` }),
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
  const countdown = trialCountdown(status, customer?.trial_ends_at);
  const trialHeadline = trialCountdownHeadline(countdown);
  const isActive = status === "active";
  const isTrial = countdown.state === "days" || countdown.state === "last_day";
  const isExpired = countdown.state === "ended";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Billing</h1>
        <p className="text-white/40 text-sm">Manage your plan and subscription.</p>
      </div>

      {(isActive || isTrial || isExpired) && (
        <div className={`aurora-card p-6 flex items-start gap-4 ${isExpired ? "border-red-500/40" : isTrial ? "border-yellow-500/40" : "border-green-500/40"}`}>
          {isActive && <CheckCircle className="text-green-400 shrink-0 mt-0.5" size={20} />}
          {isTrial && <Clock className="text-yellow-400 shrink-0 mt-0.5" size={20} />}
          {isExpired && <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />}
          <div>
            {isActive && (
              <>
                <div className="font-semibold text-green-400">Active — {customer?.plan === "annual" ? "Annual plan" : "Monthly plan"}</div>
                <div className="text-sm text-white/40 mt-0.5">Your AI receptionist is live and answering calls.</div>
              </>
            )}
            {isTrial && (
              <>
                <div className="font-semibold text-yellow-400">{trialHeadline}</div>
                <div className="text-sm text-white/40 mt-0.5">Add a payment method before your trial ends to keep your number and agent.</div>
              </>
            )}
            {isExpired && (
              <>
                <div className="font-semibold text-red-400">{trialHeadline}</div>
                <div className="text-sm text-white/40 mt-0.5">Your AI is no longer answering calls. Subscribe to reactivate.</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Plan selector — show if not active */}
      {!isActive && (
        <div className="aurora-card p-6 space-y-6">
          <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2"><CreditCard size={14} /> Choose a plan</h2>

          {/* Billing period toggle */}
          <div className="flex gap-2 p-1 bg-white/5 rounded-lg w-fit">
            {(["monthly", "annual"] as const).map(b => (
              <button key={b} onClick={() => setBilling(b)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer ${
                  billing === b ? "bg-yellow-400 text-black" : "text-white/50 hover:text-white"
                }`}>
                {b === "monthly" ? "Monthly" : "Annual — save 30%"}
              </button>
            ))}
          </div>

          {/* Tier cards */}
          <div className="flex gap-3">
            {(["small_business", "big_business"] as const).map(t => {
              const price = PLANS[t][billing];
              const selected = tier === t;
              return (
                <button key={t} onClick={() => setTier(t)}
                  className={`flex-1 aurora-card p-5 text-left transition-all relative cursor-pointer ${
                    selected ? "border-yellow-400 bg-yellow-500/15 ring-2 ring-yellow-400/60" : "border-white/10 hover:border-white/20 hover:bg-white/5"
                  }`}>
                  {selected && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center">
                      <Check size={12} className="text-black" strokeWidth={3} />
                    </div>
                  )}
                  {t === "big_business" && (
                    <div className="absolute -top-2.5 left-3 bg-gradient-to-r from-yellow-400 to-orange-400 text-black text-xs font-bold px-2 py-0.5 rounded-full">BIG BUSINESS</div>
                  )}
                  <div className="font-bold text-2xl mt-1">{price.amount}<span className="text-sm font-normal text-white/40">{price.period}</span></div>
                  <div className="text-sm font-semibold mt-1">{PLANS[t].label}</div>
                  <div className="text-xs text-yellow-400 mt-1">{PLANS[t].description}</div>
                  {price.savings && <div className="text-xs text-white/40 mt-1">{price.savings}</div>}
                </button>
              );
            })}
          </div>

          <div className="space-y-2 text-sm text-white/50">
            {[
              "Dedicated AU phone number",
              tier === "big_business"
                ? `${BIG_BUSINESS_INCLUDED_MINUTES.toLocaleString("en-US")} mins/mo included`
                : `${SMALL_BUSINESS_INCLUDED_MINUTES} mins/mo included`,
              "AI answers every call 24/7",
              "Message notifications via SMS",
              "Staff call transfers",
              "Knowledge base updates",
              tier === "big_business" ? "Priority support" : "Cancel anytime",
            ].map(f => (
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
            {checkingOut ? "Redirecting to checkout..." : `Subscribe — ${PLANS[tier][billing].amount}${PLANS[tier][billing].period}`}
          </button>

          <p className="text-xs text-white/30 text-center">Secure checkout via Stripe. Cancel anytime.</p>
        </div>
      )}

      {/* Active plan details */}
      {isActive && (
        <div className="aurora-card p-6">
          <h2 className="text-sm font-semibold text-yellow-400 mb-4">Plan details</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-white/40">Plan</span><span>{customer?.plan === "annual" ? "Annual ($1,399/yr)" : "Monthly ($199/mo)"}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Number</span><span>{customer?.twilio_number || "—"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
