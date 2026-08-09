import { useState, useEffect } from "react";
import { getMe, getUsage } from "../lib/api";
import { Phone, Mail, MessageSquare } from "lucide-react";

export default function Usage() {
  const [customer, setCustomer] = useState<any>(null);
  const [usage, setUsage] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { customer: c } = await getMe();
      setCustomer(c);
      const u = await getUsage(c.id);
      setUsage(u);
    })();
  }, []);

  const plans: Record<string, { name: string; price: string }> = {
    free: { name: "Free", price: "$0/mo" },
    starter: { name: "Starter", price: "$49/mo" },
    pro: { name: "Pro", price: "$99/mo" },
    agency: { name: "Agency", price: "$199/mo" },
  };

  const plan = plans[customer?.plan || "free"] || plans.free;

  const voiceUsage = usage.filter(u => u.product === "voice");
  const emailUsage = usage.filter(u => u.product === "email");
  const chatUsage = usage.filter(u => u.product === "chat");

  const totalCost = usage.reduce((sum, u) => sum + Number(u.markup_usd || 0), 0);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Usage & Billing</h1>
      <p className="text-white/50 mb-8">Track your AI usage and costs.</p>

      {/* Plan card */}
      <div className="aurora-card aurora-glow p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">Current plan</p>
            <p className="text-2xl font-bold">{plan.name}</p>
            <p className="text-white/50">{plan.price}</p>
          </div>
          <button className="btn-primary text-sm">Upgrade</button>
        </div>
      </div>

      {/* Per-product breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="aurora-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={18} className="text-green-400" />
            <h3 className="font-semibold">Voice</h3>
          </div>
          <p className="text-2xl font-bold">{voiceUsage.reduce((s, u) => s + (u.units || 0), 0)} calls</p>
          <p className="text-sm text-white/50">${voiceUsage.reduce((s, u) => s + Number(u.markup_usd || 0), 0).toFixed(2)} this month</p>
        </div>
        <div className="aurora-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Mail size={18} className="text-blue-400" />
            <h3 className="font-semibold">DraftPilot</h3>
          </div>
          <p className="text-2xl font-bold">{emailUsage.reduce((s, u) => s + (u.units || 0), 0)} drafts</p>
          <p className="text-sm text-white/50">${emailUsage.reduce((s, u) => s + Number(u.markup_usd || 0), 0).toFixed(2)} this month</p>
        </div>
        <div className="aurora-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={18} className="text-purple-400" />
            <h3 className="font-semibold">Chat</h3>
          </div>
          <p className="text-2xl font-bold">{chatUsage.reduce((s, u) => s + (u.units || 0), 0)} chats</p>
          <p className="text-sm text-white/50">${chatUsage.reduce((s, u) => s + Number(u.markup_usd || 0), 0).toFixed(2)} this month</p>
        </div>
      </div>

      {/* Total */}
      <div className="aurora-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">Total this month</p>
            <p className="text-3xl font-bold text-indigo-400">${totalCost.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
