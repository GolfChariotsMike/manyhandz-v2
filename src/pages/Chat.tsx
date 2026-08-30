import { useState, useEffect } from "react";
import { getMe, getChatConfig, saveChatConfig, getChatSessions } from "../lib/api";
import { chatPageView } from "../lib/chat-page";
import { chatWidgetEmbedSnippet, mountChatWidgetPreview, unmountChatWidgetPreview } from "../lib/chat-widget-preview";
import { MessageSquare, Copy, Check, Settings, Eye, Loader2 } from "lucide-react";

export default function Chat() {
  const [customer, setCustomer] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({ widget_name: "", widget_color: "#6366f1", greeting: "", fallback_message: "" });

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    mountChatWidgetPreview(config?.embed_key);
    return () => unmountChatWidgetPreview();
  }, [config?.embed_key]);

  async function loadData() {
    try {
      const me = await getMe();
      setCustomer(me.customer);
      const cid = me.customer?.id;
      if (!cid) {
        setSessionsLoading(false);
        return;
      }

      getChatSessions(cid)
        .then((sess) => setSessions(Array.isArray(sess) ? sess : []))
        .catch(() => setSessions([]))
        .finally(() => setSessionsLoading(false));

      const cfg = await getChatConfig(cid);
      const cfgRows = Array.isArray(cfg) ? cfg : [];
      if (cfgRows.length) {
        setConfig(cfgRows[0]);
        setFormData({ widget_name: cfgRows[0].widget_name || "", widget_color: cfgRows[0].widget_color || "#6366f1", greeting: cfgRows[0].greeting || "", fallback_message: cfgRows[0].fallback_message || "" });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!customer || !config) return;
    await saveChatConfig(config.id, formData);
    setConfig({ ...config, ...formData });
    setEditing(false);
  }

  function copyEmbed() {
    if (!config) return;
    const code = chatWidgetEmbedSnippet(config.embed_key);
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const view = chatPageView({ loading, hasConfig: !!config });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Chat Widget</h1>
          <p className="text-white/50">AI chat assistant for your website</p>
        </div>
      </div>

      {view === "loading" ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-yellow-400" size={32} />
        </div>
      ) : view === "enable" || !config ? (
        <div className="aurora-card p-8 text-center">
          <MessageSquare className="mx-auto mb-4 text-white/20" size={48} />
          <p className="text-white/50 mb-4">Setting up your chat widget...</p>
          <button
            onClick={async () => {
              if (!customer?.id) return;
              try {
                const res = await fetch(
                  `https://kouembkldbpdbhzeaoth.supabase.co/rest/v1/mh_chat_config`,
                  {
                    method: "POST",
                    headers: {
                      apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw",
                      Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw`,
                      "Content-Type": "application/json",
                      Prefer: "return=representation",
                    },
                    body: JSON.stringify({
                      customer_id: customer.id,
                      widget_name: customer.business_name ? `${customer.business_name} Chat` : "Chat Assistant",
                    }),
                  }
                );
                if (res.ok) {
                  setLoading(true);
                  await loadData();
                }
              } catch {}
            }}
            className="px-6 py-3 rounded-xl bg-yellow-500/20 text-yellow-400 font-medium hover:bg-yellow-500/30 transition-all"
          >
            Enable Chat Widget
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Config */}
          <div className="aurora-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><Settings size={18} /> Widget Settings</h2>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-xs text-yellow-400 hover:text-yellow-400">Edit</button>
              )}
            </div>

            {editing ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Widget Name</label>
                  <input value={formData.widget_name} onChange={e => setFormData({ ...formData, widget_name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Color</label>
                  <input type="color" value={formData.widget_color} onChange={e => setFormData({ ...formData, widget_color: e.target.value })}
                    className="w-12 h-8 rounded cursor-pointer" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Greeting</label>
                  <input value={formData.greeting} onChange={e => setFormData({ ...formData, greeting: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Fallback Message</label>
                  <input value={formData.fallback_message} onChange={e => setFormData({ ...formData, fallback_message: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 text-sm font-medium hover:bg-yellow-500/30">Save</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:text-white/70">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-white/40">Name</span><span>{config.widget_name}</span></div>
                <div className="flex justify-between items-center"><span className="text-white/40">Color</span><div className="w-6 h-6 rounded" style={{ backgroundColor: config.widget_color }} /></div>
                <div className="flex justify-between"><span className="text-white/40">Greeting</span><span className="text-right max-w-[200px] truncate">{config.greeting}</span></div>
                <div className="flex justify-between"><span className="text-white/40">Status</span><span className={config.is_active ? "text-green-400" : "text-red-400"}>{config.is_active ? "Active" : "Inactive"}</span></div>
              </div>
            )}
          </div>

          {/* Embed Code */}
          <div className="aurora-card p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Eye size={18} /> Embed Code</h2>
            <p className="text-sm text-white/50 mb-4">Add this to your website's HTML, just before the closing &lt;/body&gt; tag.</p>
            {config.embed_key && (
              <p className="text-sm text-white/40 mb-4">Try it on this page — the bubble in the corner is your live widget.</p>
            )}
            <div className="bg-black/30 rounded-xl p-4 text-xs font-mono text-white/70 break-all">
              {chatWidgetEmbedSnippet(config.embed_key)}
            </div>
            <button onClick={copyEmbed}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition-all">
              {copied ? <><Check size={14} className="text-green-400" /> Copied!</> : <><Copy size={14} /> Copy code</>}
            </button>
          </div>

          {/* Chat history */}
          <div className="aurora-card p-6 lg:col-span-2">
            <h2 className="font-semibold mb-4">Recent Conversations</h2>
            {sessionsLoading ? (
              <p className="text-sm text-white/40">Loading conversations…</p>
            ) : !Array.isArray(sessions) || sessions.length === 0 ? (
              <p className="text-sm text-white/40">No conversations yet. Deploy the widget and start chatting!</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                    <div>
                      <p className="text-sm font-medium">Session {(s.visitor_id || s.id)?.toString().slice(0, 8)}...</p>
                      <p className="text-xs text-white/40">{s.created_at ? new Date(s.created_at).toLocaleString() : ""}</p>
                    </div>
                    <span className="text-xs text-white/30 capitalize">{s.resolved ? "resolved" : "open"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
