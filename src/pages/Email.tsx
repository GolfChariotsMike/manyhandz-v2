import { useState, useEffect } from "react";
import {
  getMe, getEmailAccounts, getEmails, getEmailDrafts,
  connectEmail, connectGmail, connectOutlook, disconnectEmail, syncEmails, generateDraft,
  getEmailVoice, saveEmailVoice, analyzeVoice, suppressDraft
} from "../lib/api";
import {
  Mail, RefreshCw, ChevronDown, ChevronUp, Edit3, Loader2,
  Eye, EyeOff, Check, Wifi, X, ChevronRight, Info, Mic, Save
} from "lucide-react";

const categoryColors: Record<string, string> = {
  important: "bg-red-500/20 text-red-300",
  needs_reply: "bg-yellow-500/20 text-yellow-300",
  marketing: "bg-blue-500/20 text-blue-300",
  newsletter: "bg-green-500/20 text-green-300",
  automated: "bg-gray-500/20 text-gray-300",
  other: "bg-white/10 text-white/50",
  uncategorized: "bg-white/10 text-white/50",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function Email() {
  const [customer, setCustomer] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Map<string, any>>(new Map());
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"inbox" | "voice">("inbox");
  const [voice, setVoice] = useState<any>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [voiceAnalyzing, setVoiceAnalyzing] = useState(false);
  const [voiceAnalyzed, setVoiceAnalyzed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Connect form state
  const [connectEmail_, setConnectEmail] = useState("");
  const [connectPassword, setConnectPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [advImapHost, setAdvImapHost] = useState("");
  const [advImapPort, setAdvImapPort] = useState("");
  const [advSmtpHost, setAdvSmtpHost] = useState("");
  const [advSmtpPort, setAdvSmtpPort] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const me = await getMe();
      setCustomer(me.customer);
      const cid = me.customer.id;
      const [accs, emailList, draftList] = await Promise.all([
        getEmailAccounts(cid),
        getEmails(cid),
        getEmailDrafts(cid),
      ]);
      setAccounts(accs || []);
      setEmails(emailList || []);
      const draftMap = new Map();
      for (const d of (draftList || [])) draftMap.set(d.email_id, d);
      setDrafts(draftMap);
      // Load voice profile separately — don't let it block the inbox
      getEmailVoice(cid).then(v => setVoice(v || { preferred_tone: 'professional', your_name: '', sign_off: '', example_draft: '', avoid_phrases: '' })).catch(() => {});
    } catch (err) {
      console.error('Email loadData error:', err);
    }
    setLoading(false);
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setConnectError("");
    try {
      await connectEmail(
        customer.id,
        connectEmail_,
        connectPassword,
        advImapHost || undefined,
        advImapPort ? parseInt(advImapPort) : undefined,
        advSmtpHost || undefined,
        advSmtpPort ? parseInt(advSmtpPort) : undefined,
      );
      setConnectSuccess(true);
      setConnectEmail("");
      setConnectPassword("");
      await loadData();
      // Auto-sync after connecting
      setSyncing(true);
      try { await syncEmails(customer.id); } catch {}
      await loadData();
      setSyncing(false);
    } catch (err: any) {
      setConnectError(err.message || "Connection failed. Check your credentials.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    if (!customer) return;
    setSyncing(true);
    try {
      await syncEmails(customer.id);
      await new Promise(r => setTimeout(r, 1500));
      await loadData();
    } finally { setSyncing(false); }
  }

  async function handleDisconnect(acc: any) {
    if (!confirm(`Disconnect ${acc.email_address}?`)) return;
    await disconnectEmail(customer.id, acc.id);
    await loadData();
  }

  async function handleGenerateDraft(emailId: string) {
    if (!customer) return;
    setGeneratingDraft(emailId);
    try {
      const result = await generateDraft(emailId, customer.id);
      if (result.draft) {
        setDrafts(prev => new Map(prev).set(emailId, result.draft));
      }
    } finally { setGeneratingDraft(null); }
  }

  const filteredEmails = filter === "all" ? emails : emails.filter(e => e.category === filter);
  const hasAccounts = accounts.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-white/30" size={32} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">DraftPilot</h1>
          <p className="text-white/50">AI email drafts from your inbox</p>
        </div>
        {hasAccounts && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync"}
          </button>
        )}
      </div>

      {/* Not connected — show connect form */}
      {!hasAccounts && (
        <div className="aurora-card p-8 max-w-lg mx-auto">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <Mail size={28} className="text-yellow-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Connect your inbox</h2>
            <p className="text-white/50 text-sm">
              Sign in with Google or Microsoft to connect your email securely.
            </p>
          </div>

          {connectSuccess && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
              <Check size={16} /> Connected! Syncing your inbox...
            </div>
          )}

          {/* OAuth buttons */}
          <div className="flex gap-3 mb-6">
            <button
              type="button"
              onClick={async () => {
                try {
                  const data = await connectGmail(customer.id);
                  if (data?.url) window.location.href = data.url;
                } catch (err: any) {
                  setConnectError(err.message || 'Failed to start Gmail connection');
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.27 9.77l-.84-3.15L1.3 6.24 5.27 9.77z"/><path fill="#34A853" d="M5.27 14.23L1.3 17.76l3.13-.38.84-3.15z"/><path fill="#4285F4" d="M12 10.18v3.89h5.39A5.4 5.4 0 0 1 12 18.18a6.18 6.18 0 0 1 0-12.36c1.53 0 2.92.56 4 1.47l2.9-2.9A10.16 10.16 0 0 0 12 2 10 10 0 1 0 12 22a9.61 9.61 0 0 0 6.69-2.69A9.29 9.29 0 0 0 21.27 12c0-.61-.05-1.22-.16-1.82H12z"/><path fill="#FBBC05" d="M1.3 6.24A9.94 9.94 0 0 0 2 12c0 2.07.49 4.02 1.3 5.76L5.27 14.23A5.93 5.93 0 0 1 5.27 9.77L1.3 6.24z"/></svg>
              Connect with Gmail
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const data = await connectOutlook(customer.id);
                  if (data?.url) window.location.href = data.url;
                } catch (err: any) {
                  setConnectError(err.message || 'Failed to start Outlook connection');
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#0078D4" d="M24 7.387v10.478c0 .23-.08.424-.238.58a.788.788 0 0 1-.581.238h-9.31V6.57h9.31c.23 0 .424.08.58.238.16.16.239.35.239.58z"/><path fill="#0364B8" d="M9.87 6.57v12.113H2.82c-.23 0-.425-.08-.582-.238a.788.788 0 0 1-.238-.58V7.387c0-.23.08-.42.238-.58a.788.788 0 0 1 .582-.238H9.87z"/><path fill="#28A8EA" d="M24 3.291v4.096H9.87V2h13.31c.23 0 .424.08.58.238.16.16.239.354.239.581z"/><path fill="#50D9FF" d="M9.87 2v5.387H2V3.291c0-.227.08-.42.238-.58A.788.788 0 0 1 2.82 2h7.05z"/><path fill="#0078D4" opacity=".5" d="M12.174 18.074H2.82a.788.788 0 0 1-.582-.238.788.788 0 0 1-.238-.58V8.174l5.913 3.478L12.174 8.174v9.9z"/></svg>
              Connect with Outlook
            </button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
            <div className="relative flex justify-center text-xs"><span className="px-3 bg-[#0a0a0f] text-white/30">or connect with app password</span></div>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-1.5">Email address</label>
              <input
                type="email"
                value={connectEmail_}
                onChange={e => setConnectEmail(e.target.value)}
                placeholder="you@gmail.com"
                required
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm placeholder:text-white/20"
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-1.5">App password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={connectPassword}
                  onChange={e => setConnectPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx"
                  required
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Advanced settings */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <ChevronRight size={14} className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
                Advanced (custom IMAP/SMTP)
              </button>
              {showAdvanced && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">IMAP host</label>
                    <input type="text" value={advImapHost} onChange={e => setAdvImapHost(e.target.value)}
                      placeholder="imap.gmail.com"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-yellow-500/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">IMAP port</label>
                    <input type="number" value={advImapPort} onChange={e => setAdvImapPort(e.target.value)}
                      placeholder="993"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-yellow-500/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">SMTP host</label>
                    <input type="text" value={advSmtpHost} onChange={e => setAdvSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-yellow-500/40" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">SMTP port</label>
                    <input type="number" value={advSmtpPort} onChange={e => setAdvSmtpPort(e.target.value)}
                      placeholder="587"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-yellow-500/40" />
                  </div>
                </div>
              )}
            </div>

            {connectError && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {connectError}
              </div>
            )}

            <button
              type="submit"
              disabled={connecting}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {connecting ? (
                <><Loader2 size={16} className="animate-spin" /> Testing connection...</>
              ) : (
                <><Wifi size={16} /> Connect inbox</>
              )}
            </button>
          </form>

          {/* Help section */}
          <div className="mt-6 border-t border-white/10 pt-5">
            <button
              onClick={() => setShowHelp(v => !v)}
              className="flex items-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors w-full"
            >
              <Info size={14} />
              How to get an app password
              <ChevronDown size={14} className={`ml-auto transition-transform ${showHelp ? "rotate-180" : ""}`} />
            </button>
            {showHelp && (
              <div className="mt-4 space-y-4 text-sm text-white/60">
                <div>
                  <p className="font-medium text-white/80 mb-1">Gmail</p>
                  <ol className="list-decimal list-inside space-y-1 text-white/50">
                    <li>Go to <a href="https://myaccount.google.com/security" target="_blank" rel="noopener" className="text-yellow-400/70 hover:text-yellow-400">myaccount.google.com → Security</a></li>
                    <li>Enable 2-step verification if not already on</li>
                    <li>Search "App passwords" → Create one named "DraftPilot"</li>
                    <li>Copy the 16-character password and paste it above</li>
                  </ol>
                </div>
                <div>
                  <p className="font-medium text-white/80 mb-1">Outlook / Hotmail</p>
                  <ol className="list-decimal list-inside space-y-1 text-white/50">
                    <li>Go to <a href="https://account.microsoft.com/security" target="_blank" rel="noopener" className="text-yellow-400/70 hover:text-yellow-400">account.microsoft.com → Security</a></li>
                    <li>Click "Advanced security options"</li>
                    <li>Under "App passwords", create a new one</li>
                    <li>Paste the generated password above</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connected — inbox view */}
      {hasAccounts && (
        <>
          {/* Connected accounts bar */}
          <div className="aurora-card p-4 mb-6 flex items-center gap-3 flex-wrap">
            {accounts.map((acc: any) => (
              <div key={acc.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-sm">{acc.email_address}</span>
                <span className="text-xs text-white/30 capitalize">{acc.provider}</span>
                <button
                  onClick={() => handleDisconnect(acc)}
                  className="ml-1 text-white/20 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => { setAccounts([]); }}
              className="px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-xs text-white/30 hover:text-white/50 hover:border-white/30 transition-all"
            >
              + Add account
            </button>
          </div>

          {/* Main tabs: Inbox | Voice Setup */}
          <div className="flex gap-1 mb-6 border-b border-white/10">
            <button
              onClick={() => setActiveTab("inbox")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === "inbox" ? "border-yellow-400 text-yellow-400" : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Mail size={15} /> Inbox {emails.length > 0 && `(${emails.length})`}
            </button>
            <button
              onClick={() => setActiveTab("voice")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === "voice" ? "border-yellow-400 text-yellow-400" : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Mic size={15} /> Your Writing Voice
            </button>
          </div>

          {/* Voice Setup Panel */}
          {activeTab === "voice" && (
            <div className="aurora-card p-6 max-w-2xl">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Your writing voice</h3>
                  <p className="text-white/40 text-sm">AI reads your sent emails and figures out how you write. Drafts will sound like you.</p>
                </div>
                <button
                  onClick={async () => {
                    setVoiceAnalyzing(true);
                    setVoiceAnalyzed(false);
                    try {
                      const result = await analyzeVoice(customer.id);
                      if (result?.profile) {
                        const p = result.profile;
                        setVoice((v: any) => ({
                          ...v,
                          preferred_tone: p.tone || v?.preferred_tone || 'professional',
                          sign_off: p.signoff_styles?.[0] || v?.sign_off || '',
                          avoid_phrases: (p.avoid_phrases || []).join(', '),
                          voice_summary: p.summary || '',
                        }));
                        setVoiceAnalyzed(true);
                      }
                    } catch (e: any) { alert(e.message || 'Analysis failed'); }
                    setVoiceAnalyzing(false);
                  }}
                  disabled={voiceAnalyzing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 text-sm font-medium hover:bg-yellow-500/25 transition-all disabled:opacity-50 shrink-0 ml-4"
                >
                  {voiceAnalyzing ? <><Loader2 size={14} className="animate-spin" /> Analysing...</> : <><Mic size={14} /> Analyse my writing</>}
                </button>
              </div>

              {voiceAnalyzed && voice?.voice_summary && (
                <div className="mb-5 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-400 font-medium mb-1">✓ Voice analysed from your sent emails</p>
                  <p className="text-sm text-white/70">{voice.voice_summary}</p>
                </div>
              )}

              {!voiceAnalyzed && voice?.voice_summary && (
                <div className="mb-5 p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-xs text-white/40 font-medium mb-1">Your writing voice</p>
                  <p className="text-sm text-white/70">{voice.voice_summary}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Your name (for sign-offs)</label>
                    <input type="text" value={voice?.your_name || ""} onChange={e => setVoice((v: any) => ({ ...v, your_name: e.target.value }))}
                      placeholder="e.g. Mike" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Tone {voiceAnalyzed && <span className="text-yellow-400">↑ auto-detected</span>}</label>
                    <select value={voice?.preferred_tone || "professional"} onChange={e => setVoice((v: any) => ({ ...v, preferred_tone: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm">
                      <option value="professional">Professional</option>
                      <option value="friendly">Friendly & casual</option>
                      <option value="direct">Direct & concise</option>
                      <option value="warm">Warm & personal</option>
                      <option value="formal">Formal</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Sign-off {voiceAnalyzed && <span className="text-yellow-400">↑ auto-detected</span>}</label>
                  <input type="text" value={voice?.sign_off || ""} onChange={e => setVoice((v: any) => ({ ...v, sign_off: e.target.value }))}
                    placeholder="e.g. Cheers, Mike" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
                </div>

                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Phrases to never use {voiceAnalyzed && <span className="text-yellow-400">↑ auto-detected</span>}</label>
                  <input type="text" value={voice?.avoid_phrases || ""} onChange={e => setVoice((v: any) => ({ ...v, avoid_phrases: e.target.value }))}
                    placeholder="e.g. I hope this email finds you well" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-yellow-500/50 focus:outline-none text-sm" />
                </div>

                {/* Categorisation Rules */}
                <div className="pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium">Categorisation rules</p>
                      <p className="text-xs text-white/40 mt-0.5">Override how specific emails get tagged. Rules run before the AI categoriser.</p>
                    </div>
                    <button
                      onClick={() => setVoice((v: any) => ({ ...v, email_rules: [...(v?.email_rules || []), { match: "", field: "any", category: "important" }] }))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >+ Add rule</button>
                  </div>
                  {(voice?.email_rules || []).length === 0 && (
                    <p className="text-xs text-white/30 italic">No rules yet — emails with &ldquo;DHL&rdquo; in the sender getting tagged as marketing? Add a rule here.</p>
                  )}
                  <div className="space-y-2">
                    {(voice?.email_rules || []).map((rule: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-white/40 shrink-0">If</span>
                        <select value={rule.field} onChange={e => setVoice((v: any) => { const r=[...v.email_rules]; r[i]={...r[i],field:e.target.value}; return {...v,email_rules:r}; })}
                          className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none">
                          <option value="any">sender or subject</option>
                          <option value="from">sender</option>
                          <option value="subject">subject</option>
                        </select>
                        <span className="text-xs text-white/40 shrink-0">contains</span>
                        <input value={rule.match} onChange={e => setVoice((v: any) => { const r=[...v.email_rules]; r[i]={...r[i],match:e.target.value}; return {...v,email_rules:r}; })}
                          placeholder="e.g. DHL" className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs focus:border-yellow-500/50 focus:outline-none" />
                        <span className="text-xs text-white/40 shrink-0">→</span>
                        <select value={rule.category} onChange={e => setVoice((v: any) => { const r=[...v.email_rules]; r[i]={...r[i],category:e.target.value}; return {...v,email_rules:r}; })}
                          className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs focus:outline-none">
                          <option value="important">important</option>
                          <option value="needs_reply">needs reply</option>
                          <option value="marketing">marketing</option>
                          <option value="other">other</option>
                        </select>
                        <button onClick={() => setVoice((v: any) => { const r=[...v.email_rules]; r.splice(i,1); return {...v,email_rules:r}; })}
                          className="text-white/20 hover:text-red-400 transition-colors"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={async () => {
                    setVoiceSaving(true);
                    await saveEmailVoice(customer.id, voice);
                    setVoiceSaving(false);
                    setVoiceSaved(true);
                    setTimeout(() => setVoiceSaved(false), 2500);
                  }}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  disabled={voiceSaving}
                >
                  {voiceSaving ? <Loader2 size={15} className="animate-spin" /> : voiceSaved ? <Check size={15} /> : <Save size={15} />}
                  {voiceSaved ? "Saved!" : voiceSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}

          {/* Inbox Panel */}
          {activeTab === "inbox" && <>
          {/* Category filters */}
          {emails.length > 0 && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {["all", "needs_reply", "important", "marketing", "newsletter", "automated", "other"].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filter === f
                      ? "bg-yellow-500/30 text-yellow-400 border border-yellow-500/40"
                      : "bg-white/5 text-white/40 hover:text-white/60"
                  }`}
                >
                  {f === "all" ? "All" : f.replace(/_/g, " ")}
                  {f !== "all" && ` (${emails.filter(e => e.category === f).length})`}
                </button>
              ))}
            </div>
          )}

          {/* Email list */}
          <div className="space-y-2">
            {filteredEmails.length === 0 && (
              <div className="aurora-card p-10 text-center">
                <Mail size={32} className="text-white/20 mx-auto mb-3" />
                <p className="text-white/50">No emails yet. Hit Sync to fetch your inbox.</p>
              </div>
            )}
            {filteredEmails.map(email => {
              const isExpanded = expandedEmail === email.id;
              const draft = drafts.get(email.id);
              const isGenerating = generatingDraft === email.id;
              return (
                <div key={email.id} className="aurora-card overflow-hidden">
                  <button
                    onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                    className="w-full p-4 flex items-center gap-4 text-left hover:bg-white/5 transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{email.from_name || email.from_address}</span>
                        {email.category && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${categoryColors[email.category] || categoryColors.other}`}>
                            {email.category.replace(/_/g, " ")}
                          </span>
                        )}
                        {draft && <Check size={12} className="text-green-400" />}
                      </div>
                      <p className="text-sm text-white/70 truncate">{email.subject}</p>
                      <p className="text-xs text-white/30 mt-1">{formatDate(email.received_at)}</p>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-white/30 shrink-0" /> : <ChevronDown size={16} className="text-white/30 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/5">
                      {/* From / Subject detail */}
                      <div className="mt-3 mb-3 text-xs text-white/30 space-y-0.5">
                        <p>From: <span className="text-white/50">{email.from_address}</span></p>
                        <p>Subject: <span className="text-white/50">{email.subject}</span></p>
                      </div>

                      {/* Body */}
                      <div className="text-sm text-white/60 whitespace-pre-wrap max-h-64 overflow-y-auto bg-white/5 rounded-xl p-4 font-mono text-xs">
                        {email.body_text || email.body_html?.replace(/<[^>]+>/g, "") || "(no body)"}
                      </div>

                      {/* Draft section */}
                      <div className="mt-4 pt-4 border-t border-white/10">
                        {draft ? (
                          <div>
                            <p className="text-xs text-white/40 mb-2 flex items-center gap-1">
                              <Edit3 size={12} /> AI Draft Reply
                              {draft.imap_appended && (
                                <span className="ml-2 text-green-400 flex items-center gap-1">
                                  <Check size={10} /> Saved to Drafts folder
                                </span>
                              )}
                            </p>
                            <div className="bg-white/5 rounded-xl p-4 text-sm text-white/80 whitespace-pre-wrap">
                              {draft.body}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => handleGenerateDraft(email.id)}
                                disabled={isGenerating}
                                className="px-3 py-1.5 rounded-lg bg-white/5 text-white/50 text-xs hover:text-white/70 transition-all flex items-center gap-1 disabled:opacity-50"
                              >
                                {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                Regenerate
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleGenerateDraft(email.id)}
                              disabled={isGenerating}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/20 text-yellow-400 text-sm font-medium hover:bg-yellow-500/30 transition-all disabled:opacity-50"
                            >
                              {isGenerating ? (
                                <><Loader2 size={14} className="animate-spin" /> Generating draft...</>
                              ) : (
                                <><Edit3 size={14} /> Generate AI Draft</>
                              )}
                            </button>
                            <button
                              onClick={async () => {
                                await suppressDraft(email.id, customer.id);
                                setEmails(prev => prev.map(e => e.id === email.id ? { ...e, draft_suppressed: true } : e));
                              }}
                              title="Don't auto-draft this email"
                              className="p-2 rounded-xl bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </> }
        </>
      )}
    </div>
  );
}
