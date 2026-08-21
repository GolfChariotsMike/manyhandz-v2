import { useState, useEffect } from "react";
import { Plus, Trash2, GripVertical, Save, Loader2, Crown } from "lucide-react";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

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

interface StaffMember {
  id?: string;
  name: string;
  phone: string;
  role: string;
  notes: string;
  is_owner: boolean;
  active: boolean;
  sort_order: number;
  phoneError?: boolean;
}

export default function Team() {
  const [customerId, setCustomerId] = useState<string>("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        if (!me?.id) { setLoading(false); return; }
        setCustomerId(me.id);

        const sr = await fetch(
          `${SUPABASE_URL}/rest/v1/mh_staff?customer_id=eq.${me.id}&order=sort_order.asc&select=id,name,phone,role,notes,is_owner,active,sort_order`,
          { headers: authHeaders() }
        );
        const staffData = await sr.json();
        if (Array.isArray(staffData)) {
          setStaff(staffData.map((m: any) => ({ ...m, notes: m.notes || "", is_owner: m.is_owner || false })));
        }
      } catch (e) {
        console.error("Team load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function addStaff() {
    setStaff(s => [...s, { name: "", phone: "", role: "", notes: "", is_owner: false, active: true, sort_order: s.length }]);
  }

  function updateStaff(idx: number, field: keyof StaffMember, value: string | boolean) {
    setStaff(s => s.map((m, i) => i === idx ? { ...m, [field]: value, ...(field === "phone" ? { phoneError: false } : {}) } : m));
  }

  function setOwner(idx: number) {
    // Only one owner at a time
    setStaff(s => s.map((m, i) => ({ ...m, is_owner: i === idx })));
  }

  function removeStaff(idx: number) {
    const wasOwner = staff[idx]?.is_owner;
    const next = staff.filter((_, i) => i !== idx);
    // If we removed the owner and there's still staff, assign first person as owner
    if (wasOwner && next.length > 0) next[0].is_owner = true;
    setStaff(next);
  }

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
    setError("");

    // Validate — phone required for all staff
    let hasError = false;
    const validated = staff.map(m => {
      if (m.name && !m.phone) { hasError = true; return { ...m, phoneError: true }; }
      return m;
    });
    if (hasError) {
      setStaff(validated);
      setError("All staff members need a phone number.");
      return;
    }

    // Filter out incomplete (no name)
    const valid = staff.filter(m => m.name && m.phone);

    setSaving(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/mh_staff?customer_id=eq.${customerId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (valid.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/mh_staff`, {
          method: "POST",
          headers: { ...authHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify(valid.map((m, i) => ({
            customer_id: customerId,
            name: m.name,
            phone: m.phone,
            role: m.role || "Staff",
            notes: m.notes || null,
            is_owner: m.is_owner,
            active: m.active,
            sort_order: i,
          }))),
        });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const ownerIdx = staff.findIndex(m => m.is_owner);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-yellow-400" size={32} />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Team</h1>
        <p className="text-white/40 text-sm">
          Add your team members. The AI picks who to call based on what the caller needs — and sends any missed messages to that same person.
        </p>
      </div>

      {/* How it works callout */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50 space-y-1.5">
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">1.</span> Caller explains what they need</div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">2.</span> AI picks the right person based on their role &amp; notes</div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">3.</span> AI calls them — they accept or decline</div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">4.</span> If they can't take it, AI takes a message and SMS's <em>that person</em></div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">5.</span> If no one matches, the <Crown size={12} className="inline text-yellow-400 mb-0.5" /> owner gets the message</div>
      </div>

      {/* Staff list */}
      <div className="space-y-3">
        {staff.length === 0 && (
          <div className="aurora-card p-8 text-center text-white/30 text-sm">
            No staff added yet. Add your first team member below.
          </div>
        )}

        {staff.map((member, idx) => (
          <div
            key={idx}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDragEnd={onDragEnd}
            className={`aurora-card p-4 transition-all ${dragIdx === idx ? "opacity-50 border-yellow-500/50" : ""} ${member.is_owner ? "border-yellow-500/30" : ""}`}
          >
            {/* Row 1 — drag handle, name, phone, role, controls */}
            <div className="flex items-center gap-3">
              <GripVertical size={16} className="text-white/20 cursor-grab shrink-0" />

              <div className="flex-1 grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Name *"
                  value={member.name}
                  onChange={e => updateStaff(idx, "name", e.target.value)}
                  className="bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b border-white/10 pb-1"
                />
                <input
                  type="tel"
                  placeholder="Phone *"
                  value={member.phone}
                  onChange={e => updateStaff(idx, "phone", e.target.value)}
                  className={`bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b pb-1 ${member.phoneError ? "border-red-500 placeholder:text-red-400" : "border-white/10"}`}
                />
                <input
                  type="text"
                  placeholder="Role — e.g. Sales"
                  value={member.role}
                  onChange={e => updateStaff(idx, "role", e.target.value)}
                  className="bg-transparent text-sm text-white outline-none placeholder:text-white/20 border-b border-white/10 pb-1"
                />
              </div>

              {/* Active toggle */}
              <button
                type="button"
                onClick={() => updateStaff(idx, "active", !member.active)}
                className={`text-xs px-2 py-1 rounded shrink-0 ${member.active ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}
              >
                {member.active ? "Active" : "Off"}
              </button>

              {/* Delete */}
              <button type="button" onClick={() => removeStaff(idx)} className="text-white/20 hover:text-red-400 shrink-0">
                <Trash2 size={14} />
              </button>
            </div>

            {/* Row 2 — notes + owner toggle */}
            <div className="mt-3 ml-7 flex items-center gap-3">
              <input
                type="text"
                placeholder="AI routing notes — e.g. handles new client enquiries and bookings"
                value={member.notes}
                onChange={e => updateStaff(idx, "notes", e.target.value)}
                className="flex-1 bg-transparent text-xs text-white/60 outline-none placeholder:text-white/20 border-b border-white/5 pb-1"
              />

              {/* Owner/manager toggle */}
              <button
                type="button"
                onClick={() => setOwner(idx)}
                title={member.is_owner ? "Owner / fallback contact" : "Set as owner"}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full shrink-0 transition-all ${
                  member.is_owner
                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                    : "bg-white/5 text-white/25 border border-white/10 hover:text-white/50"
                }`}
              >
                <Crown size={11} />
                {member.is_owner ? "Owner" : "Set as owner"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add staff */}
      <button
        type="button"
        onClick={addStaff}
        className="flex items-center gap-2 text-sm text-white/40 hover:text-yellow-400 transition-colors"
      >
        <Plus size={14} /> Add staff member
      </button>

      {/* Owner hint */}
      {staff.length > 0 && ownerIdx === -1 && (
        <p className="text-xs text-yellow-400/70">⚠️ No owner set — mark one person as owner so fallback messages have somewhere to go.</p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

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
