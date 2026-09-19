import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import {
  MAX_SUGGESTED_PROMPTS,
  addSuggestedPrompt,
  moveSuggestedPrompt,
  removeSuggestedPrompt,
  updateSuggestedPrompt,
} from "../lib/suggested-prompts";

type Props = {
  prompts: string[];
  onChange: (next: string[]) => void;
};

export function SuggestedPromptsEditor({ prompts, onChange }: Props) {
  return (
    <div>
      <label className="text-xs text-white/40 mb-1 block">Suggested prompts</label>
      <p className="text-xs text-white/30 mb-2">
        Chips shown when the widget opens on an empty chat. Clicking one sends that text as the visitor&apos;s first message. Up to {MAX_SUGGESTED_PROMPTS}.
      </p>
      <div className="space-y-2">
        {prompts.map((prompt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={prompt}
              onChange={(e) => onChange(updateSuggestedPrompt(prompts, i, e.target.value))}
              placeholder="e.g. Book a job"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="button"
              aria-label="Move up"
              disabled={i === 0}
              onClick={() => onChange(moveSuggestedPrompt(prompts, i, -1))}
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 disabled:opacity-30 disabled:hover:text-white/40"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={i === prompts.length - 1}
              onClick={() => onChange(moveSuggestedPrompt(prompts, i, 1))}
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 disabled:opacity-30 disabled:hover:text-white/40"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              aria-label="Remove prompt"
              onClick={() => onChange(removeSuggestedPrompt(prompts, i))}
              className="p-1.5 rounded-lg bg-white/5 text-white/30 hover:text-red-400"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {prompts.length < MAX_SUGGESTED_PROMPTS && (
        <button
          type="button"
          onClick={() => onChange(addSuggestedPrompt(prompts))}
          className="mt-2 flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300"
        >
          <Plus size={14} /> Add prompt
        </button>
      )}
    </div>
  );
}

export function SuggestedPromptsSummary({ prompts }: { prompts: unknown }) {
  const labels = Array.isArray(prompts)
    ? prompts.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];
  return (
    <div className="flex justify-between gap-4">
      <span className="text-white/40 shrink-0">Suggested prompts</span>
      <span className="text-right text-white/80">
        {labels.length ? labels.join(" · ") : "None — add some in Edit"}
      </span>
    </div>
  );
}
