import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const FAQS = [
  {
    category: "Getting Started",
    items: [
      {
        q: "How do I get my AI up and running?",
        a: "Once you've completed onboarding, your AI is already live on your ManyHandz number. Head to the Voice page to set your greeting, pick a voice, and then either use your ManyHandz number as your main business number or forward your existing number to it.",
      },
      {
        q: "How do I get calls to go to my AI?",
        a: "Two options:\n\n1. Use your ManyHandz number directly — put it on your website, Google Business profile, and business cards.\n\n2. Forward your existing number — go to your phone's Settings → Phone → Call Forwarding (iPhone) or Phone app → Settings → Calls → Call Forwarding (Android) and enter your ManyHandz number.",
      },
      {
        q: "How do I know if my agent is working?",
        a: "Easy test — just call your ManyHandz number directly. If the AI picks up and introduces itself, you're live. If call forwarding isn't working after that, it's likely a carrier restriction (see below).",
      },
      {
        q: "Why isn't call forwarding working?",
        a: "Some mobile carriers don't support call forwarding on certain plans — particularly basic prepaid plans. If the option is greyed out in your phone settings or forwarding just doesn't activate, contact your carrier and ask if call forwarding is included on your plan. If it's not, the simplest fix is to use your ManyHandz number as your main number instead.",
      },
    ],
  },
  {
    category: "Your AI Agent",
    items: [
      {
        q: "What can my AI actually do?",
        a: "Your AI answers calls 24/7, handles common questions using your knowledge base, qualifies leads, takes messages, and can transfer calls to your team. It uses everything you've set up — your greeting, your services, your FAQs, your team — to handle calls the way you would.",
      },
      {
        q: "How does the AI know about my business?",
        a: "It learns from your Knowledge Base. Head to the Knowledge Base page and fill in your About section, services, FAQs, and business hours. The more detail you add, the better it handles calls. You can update it any time.",
      },
      {
        q: "Can the AI transfer calls to my staff?",
        a: "Yes. Add your team members on the Team page with their name, phone number, and role. When a caller needs a real person, the AI will call the right team member, screen the call (so they know who's calling and why), and bridge them together. If no one's available, it takes a message and SMS's the right person.",
      },
      {
        q: "What happens when the AI can't answer a question?",
        a: "If the AI doesn't know something, it'll offer to take a message or transfer the caller to your team rather than guessing. It won't make up information.",
      },
      {
        q: "Can I change the AI's voice or greeting?",
        a: "Yes — both are on the Voice page. You can pick from 8 voices (Australian, British, and American accents) and preview each one before saving. Your greeting is what the AI says when it first picks up — keep it natural and under 2 sentences.",
      },
    ],
  },
  {
    category: "Calls & Minutes",
    items: [
      {
        q: "How do minutes work?",
        a: "Your plan includes a set number of minutes per month (600 on Small Business, 2,000 on Big Business). Minutes are counted from when the AI picks up to when the call ends. Unused minutes don't roll over.",
      },
      {
        q: "What happens if I go over my included minutes?",
        a: "We'll be in touch before that becomes an issue. If you're regularly hitting your limit, it's usually a sign you'd benefit from upgrading to the Big Business plan.",
      },
      {
        q: "Does the AI answer every single call?",
        a: "Yes — as long as calls are reaching your ManyHandz number (either directly or via forwarding), the AI answers every one, 24/7, including weekends and public holidays.",
      },
    ],
  },
  {
    category: "Account & Billing",
    items: [
      {
        q: "How do I change my plan?",
        a: "Head to the Billing page. You can upgrade or downgrade at any time — changes take effect at the start of your next billing period.",
      },
      {
        q: "Can I cancel anytime?",
        a: "Yes. No lock-in contracts. Cancel from the Billing page and your plan stays active until the end of the period you've already paid for.",
      },
      {
        q: "What happens to my number if I cancel?",
        a: "Your ManyHandz number is deactivated when your plan ends. If you've been using it as your main business number, make sure to update your listings before cancelling.",
      },
    ],
  },
  {
    category: "Still Need Help?",
    items: [
      {
        q: "I have a question that's not answered here.",
        a: "Reach out to us at hello@manyhandz.ai — we're a small team and we actually reply. If something isn't working the way you expect, let us know and we'll sort it out.",
      },
    ],
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<string | null>(null);

  function toggle(key: string) {
    setOpen(prev => prev === key ? null : key);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Help & FAQ</h1>
        <p className="text-white/40 text-sm">Answers to common questions about setup, your AI agent, and your account.</p>
      </div>

      {FAQS.map(section => (
        <div key={section.category}>
          <h2 className="text-xs font-semibold text-yellow-400 uppercase tracking-widest mb-3">{section.category}</h2>
          <div className="space-y-2">
            {section.items.map((item, i) => {
              const key = `${section.category}-${i}`;
              const isOpen = open === key;
              return (
                <div key={key} className="aurora-card overflow-hidden">
                  <button
                    onClick={() => toggle(key)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left gap-4"
                  >
                    <span className="text-sm font-medium text-white/90">{item.q}</span>
                    {isOpen
                      ? <ChevronUp size={16} className="text-white/40 shrink-0" />
                      : <ChevronDown size={16} className="text-white/40 shrink-0" />
                    }
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5">
                      <div className="border-t border-white/10 pt-4 text-sm text-white/50 leading-relaxed whitespace-pre-line">
                        {item.a}
                        {item.q.includes("not answered") && (
                          <a href="mailto:hello@manyhandz.ai" className="block mt-3 text-yellow-400 hover:text-yellow-300 transition-colors">
                            Email us → hello@manyhandz.ai
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
