import { useState, useEffect } from "react";
import { getMe } from "../lib/api";
import { BookOpen, Zap, Check, ArrowRight, Mail, MessageSquare } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

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
];

export default function Dashboard() {
  const [customer, setCustomer] = useState<any>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    getMe().then(d => {
      setCustomer(d.customer);
      // Load completed steps from localStorage
      const saved = localStorage.getItem(`mh_steps_${d.customer?.id}`);
      if (saved) setCompletedSteps(JSON.parse(saved));
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
                      : <step.icon className={step.iconColor} size={22} />
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
    </div>
  );
}
