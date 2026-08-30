export interface VoiceOption {
  id: string;
  name: string;
  accent: string;
  gender: string;
  desc: string;
}

/** Allowed ElevenLabs voices — keep in sync with supabase/functions/mhv2-grokbot/voices.ts */
export const VOICES: VoiceOption[] = [
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie",  accent: "Australian", gender: "Male",   desc: "Deep, confident, energetic" },
  { id: "ouFAjcjtdrVBT9bRFhFQ", name: "David",    accent: "Australian", gender: "Male",   desc: "Deep, calm, trustworthy" },
  { id: "0zgVQzF8uy6TauIra2W1", name: "Joel",     accent: "Australian", gender: "Male",   desc: "Calm, friendly, natural" },
  { id: "LISP4EbsJ719q0dk83aw", name: "Hamish",   accent: "Australian", gender: "Male",   desc: "Trustworthy, professional" },
  { id: "At3GWS0JVOaxoI8KPYt2", name: "Rick",     accent: "Australian", gender: "Male",   desc: "Classic, natural Aussie" },
  { id: "VyyyOgRmsqOzaZXnKWnI", name: "Sunny",    accent: "Australian", gender: "Female", desc: "Warm, friendly, upbeat" },
  { id: "5GZaeOOG7yqLdoTRsaa6", name: "Sally",    accent: "Australian", gender: "Female", desc: "Kind, professional" },
  { id: "gnza9thg1bDor49Sxvtl", name: "Hannah",   accent: "Australian", gender: "Female", desc: "Receptionist-ready, warm" },
  { id: "IdDgBtBBVTnSVb4wDvbT", name: "Samantha", accent: "Australian", gender: "Female", desc: "Happy, friendly, approachable" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",   accent: "British",    gender: "Male",   desc: "Steady, authoritative broadcaster" },
  { id: "YxV306TE3Zjvmce8pOII", name: "Michael",  accent: "British",    gender: "Male",   desc: "Warm, natural, engaging" },
  { id: "vhBIP7TzXaD17CYHAfIZ", name: "Jack",     accent: "British",    gender: "Male",   desc: "Clear, warm, engaging" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",     accent: "British",    gender: "Female", desc: "Velvety, composed, professional" },
  { id: "5lh7QJfTUjzApFMaXyGe", name: "Charlotte",accent: "British",    gender: "Female", desc: "Warm, polished, confident" },
  { id: "tOelxWDthXw42aCNp41N", name: "Romy",     accent: "British",    gender: "Female", desc: "Casual, friendly, relatable" },
  { id: "LM5QaByxyWDmNhcQTYiS", name: "Sophia",   accent: "British",    gender: "Female", desc: "Smooth, composed, professional" },
  { id: "xyY1A1culQEvzoU6aS0N", name: "Ronan",    accent: "Irish",      gender: "Male",   desc: "Warm, natural, conversational" },
  { id: "ehKZw5kruBt73Gytae2x", name: "Robyn",    accent: "Irish",      gender: "Female", desc: "Casual, chatty, friendly" },
  { id: "WtSj8ZSBSK3JEi9xgqBG", name: "Orla",     accent: "Irish",      gender: "Female", desc: "Calm, clear, approachable" },
  { id: "GFyWqnwcF2mv6dWlo3u1", name: "John",     accent: "Irish",      gender: "Male",   desc: "Grounded, natural, reliable" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",    accent: "American",   gender: "Female", desc: "Mature, reassuring, confident" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",    accent: "American",   gender: "Male",   desc: "Deep, resonant, comforting" },
];

export function findVoice(idOrName: string): VoiceOption | undefined {
  const q = idOrName.trim().toLowerCase();
  return VOICES.find(v => v.id.toLowerCase() === q || v.name.toLowerCase() === q);
}

export function maskGrokbotKey(suffix: string): string {
  return `mh_live_…${suffix}`;
}
