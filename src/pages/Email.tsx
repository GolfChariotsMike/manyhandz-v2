import { useState, useEffect } from "react";
import { getMe, getEmailAccounts, getEmails, getEmailDrafts, connectGmail, connectOutlook, generateDraft, syncEmails } from "../lib/api";
import { Mail, RefreshCw, ChevronDown, ChevronUp, Send, Edit3, Check, Loader2 } from "lucide-react";

export default function Email() {
  const [customer, setCustomer] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Map<string, any>>(new Map());
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    loadData();
    // Check URL for inbox_connected
    const params = new URLSearchParams(window.location.search);
    if (params.get("inbox_connected")) {
      window.history.replaceState({}, "", "/email");
      setTimeout(loadData, 2000); // Reload after sync starts
    }
  }, []);

  async function loadData() {
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
  }

  async function handleSync() {
    if (!customer) return;
    setSyncing(true);
    try {
      await syncEmails(customer.id);
      await new Promise(r => setTimeout(r, 3000));
      await loadData();
    } finally { setSyncing(false); }
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

  async function handleConnectGmail() {
    if (!customer) return;
    const result = await connectGmail(customer.id);
    if (result.url) window.location.href = result.url;
  }

  async function handleConnectOutlook() {
    if (!customer) return;
    const result = await connectOutlook(customer.id);
    if (result.url) window.location.href = result.url;
  }

  const filteredEmails = filter === "all" ? emails : emails.filter(e => e.category === filter);

  const categoryColors: Record<string, string> = {
    important: "bg-red-500/20 text-red-300",
    needs_reply: "bg-yellow-500/20 text-yellow-300",
    marketing: "bg-blue-500/20 text-blue-300",
    newsletter: "bg-green-500/20 text-green-300",
    automated: "bg-gray-500/20 text-gray-300",
    uncategorized: "bg-white/10 text-white/50",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">DraftPilot</h1>
          <p className="text-white/50">AI email drafts from your inbox</p>
        </div>
        <div className="flex gap-3">
          {accounts.length > 0 && (
            <button onClick={handleSync} disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm transition-all disabled:opacity-50">
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing..." : "Sync"}
            </button>
          )}
        </div>
      </div>

      {/* Connected accounts */}
      <div className="aurora-card p-6 mb-6">
        <h2 className="font-semibold mb-4">Connected Accounts</h2>
        {accounts.length === 0 ? (
          <div className="text-center py-8">
            <Mail className="mx-auto mb-4 text-white/20" size={48} />
            <p className="text-white/50 mb-6">Connect your email to get started</p>
            <div className="flex justify-center gap-4">
              <button onClick={handleConnectGmail}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30 hover:border-red-500/50 text-sm font-medium transition-all">
                <img src="https://www.google.com/gmail/about/static-2.0/images/logo-gmail.png" alt="" className="w-5 h-5" onError={(e) => (e.currentTarget.style.display = 'none')} />
                Connect Gmail
              </button>
              <button onClick={handleConnectOutlook}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 border border-yellow-500/30 hover:border-yellow-500/50 text-sm font-medium transition-all">
                Connect Outlook
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {accounts.map((acc: any) => (
              <div key={acc.id} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                <div className={`w-2 h-2 rounded-full ${acc.is_active ? "bg-green-400" : "bg-red-400"}`} />
                <span className="text-sm">{acc.email_address}</span>
                <span className="text-xs text-white/30 capitalize">{acc.provider}</span>
              </div>
            ))}
            <button onClick={handleConnectGmail} className="px-4 py-2 rounded-xl border border-dashed border-white/20 text-sm text-white/40 hover:text-white/60 hover:border-white/30 transition-all">
              + Add account
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {emails.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {["all", "needs_reply", "important", "marketing", "newsletter", "automated"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f ? "bg-yellow-500/30 text-yellow-400 border border-yellow-500/40" : "bg-white/5 text-white/40 hover:text-white/60"
              }`}>
              {f === "all" ? "All" : f.replace("_", " ")}
              {f !== "all" && ` (${emails.filter(e => e.category === f).length})`}
            </button>
          ))}
        </div>
      )}

      {/* Email list */}
      <div className="space-y-2">
        {filteredEmails.length === 0 && accounts.length > 0 && (
          <div className="aurora-card p-8 text-center">
            <p className="text-white/50">No emails yet. Hit sync to pull from your inbox.</p>
          </div>
        )}
        {filteredEmails.map(email => {
          const isExpanded = expandedEmail === email.id;
          const draft = drafts.get(email.id);
          return (
            <div key={email.id} className="aurora-card overflow-hidden">
              <button onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                className="w-full p-4 flex items-center gap-4 text-left hover:bg-white/5 transition-all">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{email.from_name || email.from_address}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${categoryColors[email.category] || categoryColors.uncategorized}`}>
                      {email.category?.replace("_", " ")}
                    </span>
                    {draft && <Check size={14} className="text-green-400" />}
                  </div>
                  <p className="text-sm text-white/70 truncate">{email.subject}</p>
                  <p className="text-xs text-white/30 mt-1">{new Date(email.received_at).toLocaleString()}</p>
                </div>
                {isExpanded ? <ChevronUp size={16} className="text-white/30" /> : <ChevronDown size={16} className="text-white/30" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-white/5">
                  <div className="mt-3 text-sm text-white/60 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {email.body_text || email.body_html?.replace(/<[^>]+>/g, '') || '(no body)'}
                  </div>

                  {/* Draft section */}
                  <div className="mt-4 pt-4 border-t border-white/10">
                    {draft ? (
                      <div>
                        <p className="text-xs text-white/40 mb-2 flex items-center gap-1">
                          <Edit3 size={12} /> AI Draft Reply
                        </p>
                        <div className="bg-white/5 rounded-xl p-4 text-sm text-white/80 whitespace-pre-wrap">
                          {draft.body}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button className="px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 text-xs font-medium hover:bg-yellow-500/30 transition-all flex items-center gap-1">
                            <Send size={12} /> Approve & Send
                          </button>
                          <button onClick={() => handleGenerateDraft(email.id)}
                            className="px-4 py-2 rounded-lg bg-white/5 text-white/50 text-xs hover:text-white/70 transition-all">
                            Regenerate
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => handleGenerateDraft(email.id)}
                        disabled={generatingDraft === email.id}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 text-sm font-medium hover:bg-yellow-500/30 transition-all disabled:opacity-50">
                        {generatingDraft === email.id ? (
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
    </div>
  );
}
