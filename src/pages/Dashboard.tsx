import { useState, useEffect, useRef } from "react";
import { getMe, getVoiceCalls } from "../lib/api";
import { Phone, BookOpen, Zap, Check, ArrowRight, Mail, MessageSquare, DollarSign, PhoneIncoming, Play, Pause, Loader, ChevronDown, ChevronUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const EL_PROXY = `${"https://kouembkldbpdbhzeaoth.supabase.co"}/functions/v1/mhv2-el-proxy`;
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

function CallStats({ calls }: { calls: any[] }) {
  const totalCalls = calls.length;
  const totalSecs = calls.reduce((acc: number, c: any) => acc + (c.duration_seconds || 0), 0);
  const totalMins = Math.round(totalSecs / 60);
  const avgSecs = totalCalls > 0 ? Math.round(totalSecs / totalCalls) : 0;
  const avgFmt = avgSecs >= 60 ? `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s` : `${avgSecs}s`;
  const stats = [
    { label: "Total calls", value: totalCalls },
    { label: "Total minutes", value: totalMins },
    { label: "Avg call length", value: avgFmt },
  ];
  return (
    <div className="mt-8">
      <div className="grid grid-cols-3 gap-4 mb-4">
        {stats.map(stat => (
          <div key={stat.label} className="aurora-card p-5 text-center">
            <p className="text-2xl font-bold mb-1">{stat.value}</p>
            <p className="text-xs text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>
      <CallLog calls={calls} />
    </div>
  );
}

function CallLog({ calls }: { calls: any[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Record<string, any[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function toggleExpand(call: any) {
    const id = call.id;
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (transcript[id] || !call.conversation_id) return;
    setLoadingId(id);
    try {
      const res = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "transcript", conversation_id: call.conversation_id }),
      });
      const data = await res.json();
      setTranscript(t => ({ ...t, [id]: data.transcript || [] }));
    } catch { setTranscript(t => ({ ...t, [id]: [] })); }
    finally { setLoadingId(null); }
  }

  async function playAudio(call: any) {
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null); return;
    }
    if (!call.conversation_id) return;
    audioRef.current?.pause();
    setPlayingId(call.id);
    try {
      const res = await fetch(EL_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: "audio", conversation_id: call.conversation_id }),
      });
      if (!res.ok) throw new Error("No audio");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
      audio.play();
    } catch { setPlayingId(null); }
  }

  function fmt(secs: number) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function fmtTime(ts: string | null | undefined) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="aurora-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Recent calls</h3>
        <Link to="/voice" className="text-xs text-white/40 hover:text-white/70 transition-colors">View all →</Link>
      </div>
      {calls.length === 0 ? (
        <p className="text-white/30 text-sm">No calls yet.</p>
      ) : (
        <div className="space-y-2">
          {calls.map((call: any) => (
            <div key={call.id} className="bg-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleExpand(call)}>
                <PhoneIncoming size={16} className="text-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{call.from_number || "Unknown"}</p>
                  <p className="text-xs text-white/40">{fmtTime(call.started_at || call.created_at)} · {call.duration_seconds ? fmt(call.duration_seconds) : "—"}</p>
                </div>
                {call.conversation_id && (
                  <button
                    onClick={e => { e.stopPropagation(); playAudio(call); }}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    {playingId === call.id ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                )}
                {expandedId === call.id ? <ChevronUp size={14} className="text-white/30 shrink-0" /> : <ChevronDown size={14} className="text-white/30 shrink-0" />}
              </div>
              {expandedId === call.id && (
                <div className="px-4 pb-4 border-t border-white/5 pt-3">
                  {loadingId === call.id ? (
                    <div className="flex items-center gap-2 text-white/40 text-xs"><Loader size={12} className="animate-spin" /> Loading transcript…</div>
                  ) : (transcript[call.id] || []).length > 0 ? (
                    <div className="space-y-2">
                      {(transcript[call.id] || []).map((turn: any, i: number) => (
                        <div key={i} className={`text-xs ${turn.role === "user" ? "text-white/70" : "text-yellow-400/80"}`}>
                          <span className="font-semibold mr-1">{turn.role === "user" ? "Caller:" : "Agent:"}</span>
                          {turn.message}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/30">No transcript available.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STEPS = [
  {
    id: "test_call",
    icon: Phone,
    color: "from-green-500/20 to-emerald-500/20",
    iconColor: "text-green-400",
    title: "Call your AI",
    desc: "Give your number a ring. Hear how your AI introduces itself and handles the call.",
    cta: "View your number →",
    link: "/voice",
  },
  {
    id: "knowledge_base",
    icon: BookOpen,
    color: "from-yellow-600/20 to-yellow-400/20",
    iconColor: "text-yellow-400",
    title: "Fine-tune your knowledge base",
    desc: "Review what your AI knows about your business. Edit services, FAQs, and hours.",
    cta: "Edit knowledge base →",
    link: "/knowledge-base",
  },
  {
    id: "go_live",
    icon: Zap,
    color: "from-purple-500/20 to-violet-500/20",
    iconColor: "text-purple-400",
    title: "Go live",
    desc: "Forward your business number to your AI and start handling real calls 24/7.",
    cta: "Set up call forwarding →",
    link: "/voice",
  },
  {
    id: "quoting",
    icon: null,
    color: "from-emerald-500/20 to-teal-500/20",
    iconColor: "text-emerald-400",
    title: "Enable AI quoting",
    desc: "Add your common jobs and prices. Your AI will quote callers on the spot and know when to book an inspection instead.",
    cta: "Add price list →",
    link: "/quoting",
  },
];

export default function Dashboard() {
  const [customer, setCustomer] = useState<any>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    getMe().then(d => {
      setCustomer(d.customer);
      const saved = localStorage.getItem(`mh_steps_${d.customer?.id}`);
      if (saved) setCompletedSteps(JSON.parse(saved));
      if (d.customer?.id) {
        getVoiceCalls(d.customer.id).then(data => setCalls(Array.isArray(data) ? data.slice(0, 10) : []));
      }
    }).catch(() => {});
  }, []);

  function markDone(stepId: string) {
    const next = [...completedSteps, stepId];
    setCompletedSteps(next);
    if (customer?.id) localStorage.setItem(`mh_steps_${customer.id}`, JSON.stringify(next));
  }

  const allDone = STEPS.every(s => completedSteps.includes(s.id));

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">
        {customer?.business_name ? `Welcome, ${customer.business_name}` : "Dashboard"}
      </h1>
      <p className="text-white/50 mb-8">Let's get your AI live.</p>

      {/* Getting Started */}
      {!allDone && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Getting started</h2>
            <span className="text-xs text-white/40">{completedSteps.length} of {STEPS.length} done</span>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-white/10 rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${(completedSteps.length / STEPS.length) * 100}%` }}
            />
          </div>

          <div className="space-y-4">
            {STEPS.map((step, i) => {
              const done = completedSteps.includes(step.id);
              const locked = i > 0 && !completedSteps.includes(STEPS[i - 1].id);
              return (
                <div
                  key={step.id}
                  className={`aurora-card p-6 flex items-center gap-5 transition-all ${
                    done ? "opacity-50" : locked ? "opacity-40" : "hover:bg-white/5"
                  }`}
                >
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center flex-shrink-0`}>
                    {done
                      ? <Check className="text-green-400" size={22} />
                      : step.icon ? <step.icon className={step.iconColor} size={22} /> : <DollarSign className={step.iconColor} size={22} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-semibold mb-0.5 ${done ? "line-through text-white/40" : ""}`}>{step.title}</h3>
                    <p className="text-sm text-white/50">{step.desc}</p>
                  </div>
                  {!done && !locked && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() => { navigate(step.link); }}
                        className="btn-primary text-sm px-4 py-2 whitespace-nowrap"
                      >
                        {step.cta}
                      </button>
                      <button
                        onClick={() => markDone(step.id)}
                        className="text-xs text-white/30 hover:text-white/50 transition-colors whitespace-nowrap"
                      >
                        Mark done
                      </button>
                    </div>
                  )}
                  {done && <Check className="text-green-400 flex-shrink-0" size={20} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All done banner */}
      {allDone && (
        <div className="aurora-card p-6 mb-8 flex items-center gap-4 border border-green-500/30">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <Check className="text-green-400" size={20} />
          </div>
          <div>
            <p className="font-semibold">You're live! 🎉</p>
            <p className="text-sm text-white/50">Your AI is handling calls around the clock.</p>
          </div>
        </div>
      )}

      {/* Product tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { id: "voice", icon: Phone, name: "Voice", desc: "AI phone answering", link: "/voice", color: "from-green-500/20 to-emerald-500/20", active: !!customer?.voice_active },
          { id: "email", icon: Mail, name: "DraftPilot", desc: "AI email drafts", link: "/email", color: "from-blue-500/20 to-cyan-500/20", active: false },
          { id: "chat", icon: MessageSquare, name: "Chat Widget", desc: "AI website chat", link: "/chat", color: "from-yellow-600/20 to-yellow-400/20", active: false },
        ].map(p => (
          <Link key={p.id} to={p.link} className="aurora-card p-5 hover:bg-white/5 transition-all group">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center mb-3`}>
              <p.icon className="text-white/80" size={20} />
            </div>
            <h3 className="font-semibold mb-1">{p.name}</h3>
            <p className="text-xs text-white/50 mb-3">{p.desc}</p>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}>
                {p.active ? "Active" : "Not set up"}
              </span>
              <ArrowRight size={14} className="text-white/20 group-hover:text-white/50 transition-all" />
            </div>
          </Link>
        ))}
      </div>

      {/* Call stats + recent calls */}
      {calls.length > 0 && <CallStats calls={calls} />}
    </div>
  );
}
