import { useState, useEffect } from "react";
import { getMe } from "../lib/api";
import { Phone, Mail, MessageSquare, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    getMe().then(d => setCustomer(d.customer)).catch(() => {});
  }, []);

  const products = [
    {
      id: "voice", icon: Phone, name: "Voice", desc: "AI phone answering",
      status: "Setup required", link: "/voice", color: "from-green-500/20 to-emerald-500/20",
    },
    {
      id: "email", icon: Mail, name: "DraftPilot", desc: "AI email drafts",
      status: "Setup required", link: "/email", color: "from-blue-500/20 to-cyan-500/20",
    },
    {
      id: "chat", icon: MessageSquare, name: "Chat Widget", desc: "AI website chat",
      status: "Setup required", link: "/chat", color: "from-purple-500/20 to-pink-500/20",
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">
        Welcome{customer?.business_name ? `, ${customer.business_name}` : ""}
      </h1>
      <p className="text-white/50 mb-8">Here's your AI team overview.</p>

      {/* Product tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {products.map(p => (
          <Link
            key={p.id}
            to={p.link}
            className="aurora-card p-6 hover:bg-white/8 transition-all group"
          >
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center mb-4`}>
              <p.icon className="text-white/80" size={24} />
            </div>
            <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
            <p className="text-sm text-white/50 mb-3">{p.desc}</p>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full ${
                p.status === "Coming soon"
                  ? "bg-white/5 text-white/30"
                  : "bg-indigo-500/20 text-indigo-300"
              }`}>
                {p.status}
              </span>
              <ArrowRight size={16} className="text-white/30 group-hover:text-white/60 transition-all" />
            </div>
          </Link>
        ))}
      </div>

      {/* Usage summary */}
      <div className="aurora-card p-6">
        <h2 className="font-semibold mb-4">This month</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-3xl font-bold text-indigo-400">0</p>
            <p className="text-sm text-white/50">Calls handled</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-blue-400">0</p>
            <p className="text-sm text-white/50">Emails drafted</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-purple-400">0</p>
            <p className="text-sm text-white/50">Chats answered</p>
          </div>
        </div>
      </div>
    </div>
  );
}
