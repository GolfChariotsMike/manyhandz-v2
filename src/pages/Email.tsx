import { useState, useEffect } from "react";
import {
  getMe, getEmailAccounts, getEmails, getEmailDrafts,
  connectEmail, disconnectEmail, syncEmails, generateDraft
} from "../lib/api";
import {
  Mail, RefreshCw, ChevronDown, ChevronUp, Edit3, Loader2,
  Eye, EyeOff, Check, Wifi, X, ChevronRight, Info
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
    } catch {}
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
              Connect with an app password. Your emails never leave your control.
            </p>
          </div>

          {connectSuccess && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
              <Check size={16} /> Connected! Syncing your inbox...
            </div>
          )}

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
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
