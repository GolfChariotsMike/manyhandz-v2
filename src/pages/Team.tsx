import { useState, useEffect } from "react";
import { Plus, Trash2, GripVertical, Phone, Save, Loader2 } from "lucide-react";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

function authHeaders() {
  const token = localStorage.getItem("mh_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token || ANON_KEY}`, apikey: ANON_KEY };
}

async function getMe() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mh-v2-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "me", token: localStorage.getItem("mh_token") }) });
  return r.json();
}

interface StaffMember {
  id?: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  sort_order: number;
}

interface VoiceConfig {
  notify_sms?: string;
  transfer_mode?: string;
}

export default function Team() {
  const [customerId, setCustomerId] = useState<string>("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [notifySms, setNotifySms] = useState("");
  const [transferMode, setTransferMode] = useState<"order" | "all">("order");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const me = await getMe();
      if (!me?.id) return;
      setCustomerId(me.id);

      // Load staff
      const sr = await fetch(`${SUPABASE_URL}/rest/v1/mh_staff?customer_id=eq.${me.id}&order=sort_order.asc`, { headers: authHeaders() });
      const staffData = await sr.json();
      if (Array.isArray(staffData)) setStaff(staffData);

      // Load voice config (notify_sms, transfer_mode)
      const vr = await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?customer_id=eq.${me.id}&select=notify_sms,transfer_mode`, { headers: authHeaders() });
      const vc = await vr.json();
      if (Array.isArray(vc) && vc[0]) {
        setNotifySms(vc[0].notify_sms || "");
        setTransferMode((vc[0].transfer_mode as "order" | "all") || "order");
      }

      setLoading(false);
    })();
  }, []);

  function addStaff() {
    setStaff(s => [...s, { name: "", phone: "", role: "", active: true, sort_order: s.length }]);
  }

  function updateStaff(idx: number, field: keyof StaffMember, value: string | boolean) {
    setStaff(s => s.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  }

  function removeStaff(idx: number) {
    setStaff(s => s.filter((_, i) => i !== idx));
  }

  // Simple drag-to-reorder
  function onDragStart(idx: number) { setDragIdx(idx); }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...staff];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setDragIdx(idx);
    setStaff(next.map((m, i) => ({ ...m, sort_order: i })));
  }
  function onDragEnd() { setDragIdx(null); }

  async function handleSave() {
    setSaving(true);
    try {
      // Save voice config (notify_sms + transfer_mode)
      await fetch(`${SUPABASE_URL}/rest/v1/mh_voice_config?customer_id=eq.${customerId}`, {
        method: "PATCH",
        headers: { ...authHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ notify_sms: notifySms || null, transfer_mode: transferMode }),
      });

      // Delete existing staff and re-insert (simplest upsert approach)
      await fetch(`${SUPABASE_URL}/rest/v1/mh_staff?customer_id=eq.${customerId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (staff.length > 0) {
        const toInsert = staff.filter(m => m.name && m.phone).map((m, i) => ({
          customer_id: customerId,
          name: m.name,
          phone: m.phone,
          role: m.role || "Staff",
          active: m.active,
          sort_order: i,
        }));
        if (toInsert.length > 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/mh_staff`, {
            method: "POST",
            headers: { ...authHeaders(), Prefer: "return=minimal" },
            body: JSON.stringify(toInsert),
          });
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-yellow-400" size={32} />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Team & Call Routing</h1>
        <p className="text-white/40 text-sm">Add your team and set rules for where calls get transferred.</p>
      </div>

      {/* Notify number */}
      <div className="aurora-card p-6">
        <h2 className="text-sm font-semibold text-yellow-400 mb-4 flex items-center gap-2"><Phone size={14} /> Message Notifications</h2>
        <label className="text-xs text-white/40 block mb-1">SMS me at this number when someone leaves a message</label>
        <input
          type="tel"
          value={notifySms}
          onChange={e => setNotifySms(e.target.value)}
          placeholder="e.g. 0412 345 678"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-yellow-500/50 placeholder:text-white/20"
        />
      </div>

      {/* Transfer mode */}
      <div className="aurora-card p-6">
        <h2 className="text-sm font-semibold text-yellow-400 mb-4">Transfer Mode</h2>
        <div className="flex gap-3">
          {[
            { id: "order", label: "Try in order", desc: "Call staff one at a time until someone answers" },
            { id: "all", label: "Ring all", desc: "Call all active staff simultaneously" },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setTransferMode(m.id as "order" | "all")}
              className={`flex-1 aurora-card p-4 text-left transition-all ${transferMode === m.id ? "border-yellow-500 bg-yellow-500/10" : "hover:bg-white/5"}`}
            >
              <div className="font-semibold text-sm mb-1">{m.label}</div>
              <div className="text-xs text-white/40">{m.desc}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-white/30 mt-3">If no one answers, the AI takes a message and SMSes you.</p>
      </div>

      {/* Staff list */}
      <div className="aurora-card p-6">
        <h2 className="text-sm font-semibold text-yellow-400 mb-4">Staff</h2>

        {staff.length === 0 && (
          <p className="text-white/30 text-sm mb-4">No staff added yet. Add team members to enable call transfers.</p>
        )}

        <div className="space-y-3 mb-4">
          {staff.map((member, idx) => (
            <div
              key={idx}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={e => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-3 bg-white/5 rounded-lg p-3 border transition-all ${dragIdx === idx ? "border-yellow-500/50 opacity-50" : "border-white/5"}`}
            >
              <GripVertical size={16} className="text-white/20 cursor-grab shrink-0" />
              <div className="flex-1 grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={member.name}
                  onChange={e => updateStaff(idx, "name", e.target.value)}
                  className="bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b border-white/10 pb-0.5"
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={member.phone}
                  onChange={e => updateStaff(idx, "phone", e.target.value)}
                  className="bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b border-white/10 pb-0.5"
                />
                <input
                  type="text"
                  placeholder="Role (optional)"
                  value={member.role}
                  onChange={e => updateStaff(idx, "role", e.target.value)}
                  className="bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b border-white/10 pb-0.5"
                />
              </div>
              <button
                onClick={() => updateStaff(idx, "active", !member.active)}
                className={`text-xs px-2 py-1 rounded shrink-0 ${member.active ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}
              >
                {member.active ? "Active" : "Off"}
              </button>
              <button onClick={() => removeStaff(idx)} className="text-white/20 hover:text-red-400 shrink-0">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={addStaff} className="flex items-center gap-2 text-sm text-white/40 hover:text-yellow-400 transition-colors">
          <Plus size={14} /> Add staff member
        </button>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saved ? "Saved!" : saving ? "Saving..." : "Save changes"}
      </button>
    </div>
  );
}
