import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { formatCallTime } from "../lib/call-log";
import {
  chatTurns,
  formatMessageCount,
  sessionPreviewText,
  sessionStatusLabel,
  type ChatSessionDetail,
  type ChatSessionListItem,
} from "../lib/chat-sessions";

export function ChatSessionsList({
  sessions,
  expandedId,
  details,
  detailLoadingId,
  detailErrors,
  onOpen,
}: {
  sessions: ChatSessionListItem[];
  expandedId: string | null;
  details: Record<string, ChatSessionDetail>;
  detailLoadingId: string | null;
  detailErrors: Record<string, string>;
  onOpen: (session: ChatSessionListItem) => void;
}) {
  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const open = expandedId === s.id;
        const detail = details[s.id];
        const turns = chatTurns(detail?.messages);
        const unresolved = !s.resolved;
        return (
          <div key={s.id} className="bg-white/5 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => onOpen(s)}
                aria-expanded={open}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium truncate">{sessionPreviewText(s)}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {formatCallTime(s.created_at)} · {formatMessageCount(s.message_count)}
                </p>
              </button>
              <span
                className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  unresolved
                    ? "bg-yellow-500/15 text-yellow-400"
                    : "bg-green-500/15 text-green-400"
                }`}
              >
                {sessionStatusLabel(s.resolved)}
              </span>
              <button
                type="button"
                onClick={() => onOpen(s)}
                aria-expanded={open}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-xs font-medium text-white/80 hover:bg-white/15 transition-colors"
              >
                View
                {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            {open && (
              <div className="px-3 pb-3 border-t border-white/5 pt-3">
                <p className="text-[11px] text-white/35 mb-3">
                  Visitor {s.visitor_id || "unknown"}
                  {s.created_at ? ` · ${formatCallTime(s.created_at)}` : ""}
                  {` · ${sessionStatusLabel(detail?.resolved ?? s.resolved)}`}
                </p>
                {detailLoadingId === s.id ? (
                  <div className="flex items-center gap-2 text-white/40 text-xs">
                    <Loader2 size={12} className="animate-spin" /> Loading conversation…
                  </div>
                ) : detailErrors[s.id] ? (
                  <p className="text-xs text-red-400">{detailErrors[s.id]}</p>
                ) : turns.length === 0 ? (
                  <p className="text-xs text-white/30">No messages in this conversation.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {turns.map((turn, i) => {
                      const visitor = turn.role === "user";
                      return (
                        <div key={i} className={`flex ${visitor ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                              visitor
                                ? "bg-white/10 text-white"
                                : "bg-yellow-500/15 text-yellow-100"
                            }`}
                          >
                            <p className="text-[10px] uppercase tracking-wide opacity-50 mb-1">
                              {visitor ? "Visitor" : "Assistant"}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{turn.content || ""}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
