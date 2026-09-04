import { useState, useEffect } from "react";
import { Loader2, Phone, Clock, TrendingUp, RotateCcw } from "lucide-react";
import { getMe, getVoiceCalls } from "../lib/api";
import { formatCallTime } from "../lib/call-log";
import { usageIncludedMinutes } from "../../supabase/functions/_shared/plan-minutes.ts";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY };
}


function fmtMins(mins: number) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDate(iso: string) {
  return formatCallTime(iso);
}

export default function Usage() {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<any>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [calls, setCalls] = useState<any[]>([]);


  useEffect(() => {
    (async () => {
      try {
        const { customer: me } = await getMe();
        if (!me?.id) { setLoading(false); return; }
        setPlan(typeof me.plan === "string" ? me.plan : null);
        const [ubRes, callLog] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/mh_usage_balance?customer_id=eq.${me.id}`, { headers: authHeaders() }),
          getVoiceCalls(me.id),
        ]);
        const ub = await ubRes.json();
        if (Array.isArray(ub) && ub[0]) setBalance(ub[0]);
        if (Array.isArray(callLog)) setCalls(callLog);
      } catch (e) {
        console.error("Usage load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-yellow-400" size={32} /></div>;

  const used = parseFloat(balance?.used_minutes_this_period || 0);
  const included = usageIncludedMinutes(balance?.included_minutes, plan);
  const rollover = parseFloat(balance?.rollover_minutes || 0);
  const total = included + rollover;
  const remaining = Math.max(0, total - used);
  const pct = Math.min(100, (used / total) * 100);
  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Usage</h1>
        <p className="text-white/40 text-sm">Your call minutes and usage history.</p>
      </div>

      {/* Minutes summary */}
      <div className="aurora-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2"><Clock size={14} /> This month's minutes</h2>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="aurora-card p-4">
            <div className="text-2xl font-bold text-white">{fmtMins(used)}</div>
            <div className="text-xs text-white/40 mt-1">Used</div>
          </div>
          <div className="aurora-card p-4">
            <div className="text-2xl font-bold text-green-400">{fmtMins(remaining)}</div>
            <div className="text-xs text-white/40 mt-1">Remaining</div>
          </div>
          <div className="aurora-card p-4">
            <div className="text-2xl font-bold text-white">{fmtMins(total)}</div>
            <div className="text-xs text-white/40 mt-1">Total included</div>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-white/40 mb-1.5">
            <span>{pct.toFixed(0)}% used</span>
            <span>{fmtMins(total)} total</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Breakdown */}
        <div className="space-y-1.5 text-sm text-white/50 pt-1">
          <div className="flex justify-between"><span className="flex items-center gap-1.5"><TrendingUp size={12} /> Included in plan</span><span>{included} mins</span></div>
          {rollover > 0 && (
            <div className="flex justify-between"><span className="flex items-center gap-1.5"><RotateCcw size={12} className="text-yellow-400" /> Rolled over from last month</span><span className="text-yellow-400">+{fmtMins(rollover)}</span></div>
          )}
        </div>

        {pct >= 100 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
            You've used all your included minutes. Calls will continue — overage will be added to your next invoice.
          </div>
        )}
        {pct >= 80 && pct < 100 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
            You've used 80% of your included minutes. Unused minutes roll over next month.
          </div>
        )}
      </div>

      {/* Call history */}
      <div className="aurora-card p-6">
        <h2 className="text-sm font-semibold text-yellow-400 mb-4 flex items-center gap-2"><Phone size={14} /> Call history</h2>

        {calls.length === 0 ? (
          <p className="text-white/30 text-sm">No calls yet. Once your AI starts answering calls they'll appear here.</p>
        ) : (
          <div className="space-y-2">
            {calls.map(call => (
              <div key={call.id} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                <div>
                  <div className="text-sm font-medium">{call.from_number || "Unknown"}</div>
                  <div className="text-xs text-white/30 mt-0.5">{call.started_at ? fmtDate(call.started_at) : "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-white/70">{call.duration_seconds ? fmtMins(call.duration_seconds / 60) : "—"}</div>
                  <div className="text-xs text-white/30 mt-0.5">{call.status || "completed"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
