import { useEffect, useState, type FormEvent } from "react";
import { Loader2, PhoneOutgoing, Plus } from "lucide-react";
import { createOutboundTask, getMe, listOutboundTasks, type OutboundTask } from "../lib/api";
import { formatCallTime } from "../lib/call-log";

const STATUS_STYLE: Record<string, string> = {
  needs_info: "bg-white/10 text-white/50",
  queued: "bg-yellow-500/15 text-yellow-300",
  calling: "bg-blue-500/15 text-blue-300",
  done: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
};

function statusLabel(status?: string | null): string {
  if (status === "needs_info") return "Needs info";
  if (status === "queued") return "Queued";
  if (status === "calling") return "Calling";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  return status || "—";
}

export default function Tasks() {
  const [hasNumber, setHasNumber] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<OutboundTask[]>([]);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [brief, setBrief] = useState("");

  async function refresh() {
    const rows = await listOutboundTasks();
    setTasks(rows);
  }

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        setHasNumber(Boolean(me?.customer?.twilio_number));
        await refresh();
      } catch {
        setError("Could not load tasks.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!contactName.trim() || !phone.trim() || !brief.trim()) {
      setError("Name, phone, and what to ask are required.");
      return;
    }
    setSaving(true);
    try {
      await createOutboundTask({
        contact_name: contactName.trim(),
        phone: phone.trim(),
        brief: brief.trim(),
      });
      setContactName("");
      setPhone("");
      setBrief("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that call.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-yellow-400" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Tasks</h1>
        <p className="text-white/40 text-sm">
          Ask your AI receptionist to call someone from your ManyHandz number, then text you the result.
          You can also text or tell your agent the same thing.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50 space-y-1.5">
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">1.</span> Compose a task here, or text your number: “call Adam on 0412… and ask if he’s free for lunch”</div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">2.</span> Only owner/staff mobiles (or this dashboard) can start a call — the public cannot</div>
        <div className="flex items-start gap-2"><span className="text-yellow-400 shrink-0">3.</span> Your AI introduces as your receptionist, not ManyHandz sales, then texts you the outcome</div>
      </div>

      <form onSubmit={handleCreate} className="aurora-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
          <Plus size={14} /> New outbound task
        </h2>
        {!hasNumber && (
          <p className="text-xs text-yellow-400/80">Provision your AU mobile number on Voice before placing calls.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Contact name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-yellow-500/50"
          />
          <input
            type="tel"
            placeholder="Phone — 0412 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-yellow-500/50"
          />
        </div>
        <textarea
          placeholder="What should they ask? e.g. see if Adam is free for lunch today and find a time"
          rows={3}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-yellow-500/50"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving || !hasNumber} className="btn-primary w-full flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <PhoneOutgoing size={16} />}
          {saving ? "Calling…" : "Call now"}
        </button>
      </form>

      <div className="aurora-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Recent tasks</h2>
          <button type="button" onClick={() => refresh().catch(() => {})} className="text-xs text-white/40 hover:text-white/70">
            Refresh
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-white/30 text-sm">No tasks yet. Compose one above or text your number.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="bg-white/5 rounded-xl p-3 flex items-start gap-3">
                <PhoneOutgoing size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{task.contact_name || "Unknown"}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[task.status || ""] || "bg-white/10 text-white/40"}`}>
                      {statusLabel(task.status)}
                    </span>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">{task.target_phone} · {formatCallTime(task.created_at)}</p>
                  {task.brief && <p className="text-xs text-white/55 mt-1">{task.brief}</p>}
                  {task.result && <p className="text-xs text-green-400/80 mt-1">{task.result}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
