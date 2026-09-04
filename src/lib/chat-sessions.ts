export type ChatTurn = {
  role?: string;
  content?: string;
};

export type ChatSessionListItem = {
  id: string;
  customer_id?: string | null;
  visitor_id?: string | null;
  created_at?: string | null;
  resolved?: boolean;
  preview?: string;
  message_count?: number;
};

export type ChatSessionDetail = ChatSessionListItem & {
  messages?: ChatTurn[];
};

export function sessionStatusLabel(resolved: unknown): "Resolved" | "Unresolved" {
  return resolved ? "Resolved" : "Unresolved";
}

export function formatMessageCount(count: unknown): string {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n === 1 ? "1 message" : `${n} messages`;
}

export function sessionPreviewText(session: { preview?: unknown }): string {
  const preview = typeof session.preview === "string" ? session.preview.trim() : "";
  return preview || "No messages yet";
}

export function chatTurns(messages: unknown): ChatTurn[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter((item): item is ChatTurn => !!item && typeof item === "object");
}
