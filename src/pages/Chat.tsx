import { useState, useEffect } from "react";
import { getMe, getChatConfig, saveChatConfig, getChatSessions } from "../lib/api";
import { MessageSquare, Copy, Check, Settings, Eye } from "lucide-react";

export default function Chat() {
  const [customer, setCustomer] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({ widget_name: "", widget_color: "#6366f1", greeting: "", fallback_message: "" });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const me = await getMe();
      setCustomer(me.customer);
      const cid = me.customer.id;
      const [cfg, sess] = await Promise.all([getChatConfig(cid), getChatSessions(cid)]);
      if (cfg?.length) {
        setConfig(cfg[0]);
        setFormData({ widget_name: cfg[0].widget_name || "", widget_color: cfg[0].widget_color || "#6366f1", greeting: cfg[0].greeting || "", fallback_message: cfg[0].fallback_message || "" });
      }
      setSessions(sess || []);
    } catch {}
  }

  async function handleSave() {
    if (!customer || !config) return;
    await saveChatConfig(config.id, formData);
    setConfig({ ...config, ...formData });
    setEditing(false);
  }

  function copyEmbed() {
    if (!config) return;
    const code = `<script src="https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-chat-widget/embed.js" data-embed-key="${config.embed_key}"></script>`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Chat Widget</h1>
          <p className="text-white/50">AI chat assistant for your website</p>
        </div>
      </div>

      {!config ? (
        <div className="aurora-card p-8 text-center">
          <MessageSquare className="mx-auto mb-4 text-white/20" size={48} />
          <p className="text-white/50 mb-4">Chat widget not set up yet.</p>
          <p className="text-sm text-white/30">Enable chat during onboarding or contact support.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Config */}
          <div className="aurora-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><Settings size={18} /> Widget Settings</h2>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-xs text-indigo-400 hover:text-indigo-300">Edit</button>
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
                  <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm font-medium hover:bg-indigo-500/30">Save</button>
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
            <div className="bg-black/30 rounded-xl p-4 text-xs font-mono text-white/70 break-all">
              {`<script src="https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-chat-widget/embed.js" data-embed-key="${config.embed_key}"></script>`}
            </div>
            <button onClick={copyEmbed}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition-all">
              {copied ? <><Check size={14} className="text-green-400" /> Copied!</> : <><Copy size={14} /> Copy code</>}
            </button>
          </div>

          {/* Chat history */}
          <div className="aurora-card p-6 lg:col-span-2">
            <h2 className="font-semibold mb-4">Recent Conversations</h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-white/40">No conversations yet. Deploy the widget and start chatting!</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                    <div>
                      <p className="text-sm font-medium">Session {s.session_key?.slice(0, 8)}...</p>
                      <p className="text-xs text-white/40">{new Date(s.last_message_at || s.created_at).toLocaleString()}</p>
                    </div>
                    <span className="text-xs text-white/30 capitalize">{s.channel || "web"}</span>
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
