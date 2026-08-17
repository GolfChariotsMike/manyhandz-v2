import { useState, useEffect } from "react";
import { getMe, getVoiceCalls, getVoiceConfig, getVoiceNumbers } from "../lib/api";
import { Phone, PhoneIncoming, PhoneForwarded, PhoneMissed, Plus, Trash2 } from "lucide-react";

export default function Voice() {
  const [numbers, setNumbers] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");

  const loadData = async () => {
    const { customer: c } = await getMe();
    setCustomer(c);
    const [nums, cfg, callLog] = await Promise.all([
      getVoiceNumbers(c.id),
      getVoiceConfig(c.id),
      getVoiceCalls(c.id),
    ]);
    setNumbers(nums);
    setConfig(cfg?.[0] || null);
    setCalls(callLog);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  async function handleProvision() {
    if (!customer?.id) return;
    setProvisioning(true);
    setProvisionError("");
    try {
      const res = await fetch("https://provision.manyhandz.ai/provision-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customer.id, country: "AU" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to provision number");
      await loadData();
    } catch (e: any) {
      setProvisionError(e.message || "Could not provision a number. Please contact support.");
    } finally {
      setProvisioning(false);
    }
  }

  if (loading) return <div className="text-white/50">Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Voice</h1>
      <p className="text-white/50 mb-8">AI answers your phone calls 24/7.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Phone number */}
        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Phone size={18} className="text-green-400" /> Your Number
          </h3>
          {numbers.length > 0 ? (
            <p className="text-2xl font-bold text-green-400">{numbers[0].twilio_number}</p>
          ) : (
            <div>
              <p className="text-white/50 text-sm mb-3">No number provisioned yet.</p>
              <button
                className="btn-primary text-sm"
                onClick={handleProvision}
                disabled={provisioning}
              >
                {provisioning ? "Provisioning..." : "Provision a number"}
              </button>
              {provisionError && <p className="text-red-400 text-xs mt-2">{provisionError}</p>}
            </div>
          )}
        </div>

        {/* Status */}
        <div className="aurora-card p-6">
          <h3 className="font-semibold mb-3">Status</h3>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${config?.active ? "bg-green-400" : "bg-red-400"}`} />
            <span className="text-lg">{config?.active ? "Active" : "Paused"}</span>
          </div>
          <p className="text-sm text-white/40 mt-2">AI persona: {config?.ai_name || (customer?.business_name ? customer.business_name + " AI" : "AI Assistant")}</p>
        </div>
      </div>

      {/* Whitelist */}
      <div className="aurora-card p-6 mb-8">
        <h3 className="font-semibold mb-3">Whitelist</h3>
        <p className="text-sm text-white/50 mb-4">
          These numbers bypass AI and get connected directly to your bridge number.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(config?.whitelist || []).map((num: string, i: number) => (
            <span key={i} className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm flex items-center gap-2">
              {num}
              <button className="text-green-300/50 hover:text-white"><Trash2 size={14} /></button>
            </span>
          ))}
          {(!config?.whitelist || config.whitelist.length === 0) && (
            <span className="text-white/30 text-sm">No whitelisted numbers</span>
          )}
        </div>
        <div className="flex gap-2">
          <input placeholder="+61400000000" className="flex-1" />
          <button className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} /> Add</button>
        </div>
        <div className="mt-4">
          <label className="text-sm text-white/60 block mb-1">Bridge to number</label>
          <input value={config?.bridge_to_number || ""} placeholder="+61400000000" readOnly />
        </div>
      </div>

      {/* Call log */}
      <div className="aurora-card p-6">
        <h3 className="font-semibold mb-4">Recent calls</h3>
        {calls.length === 0 ? (
          <p className="text-white/30 text-sm">No calls yet.</p>
        ) : (
          <div className="space-y-3">
            {calls.map((call: any) => (
              <div key={call.id} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                {call.outcome === "handled" && <PhoneIncoming size={18} className="text-green-400" />}
                {call.outcome === "transferred" && <PhoneForwarded size={18} className="text-blue-400" />}
                {call.outcome === "missed" && <PhoneMissed size={18} className="text-red-400" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{call.caller_number}</p>
                  <p className="text-xs text-white/40">
                    {new Date(call.created_at).toLocaleString()} · {call.duration_seconds || 0}s · {call.outcome}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
