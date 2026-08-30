/** Allowed ElevenLabs voices — keep in sync with src/lib/voices.ts */
export const VOICES = [
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie",  accent: "Australian", gender: "Male" },
  { id: "ouFAjcjtdrVBT9bRFhFQ", name: "David",    accent: "Australian", gender: "Male" },
  { id: "0zgVQzF8uy6TauIra2W1", name: "Joel",     accent: "Australian", gender: "Male" },
  { id: "LISP4EbsJ719q0dk83aw", name: "Hamish",   accent: "Australian", gender: "Male" },
  { id: "At3GWS0JVOaxoI8KPYt2", name: "Rick",     accent: "Australian", gender: "Male" },
  { id: "VyyyOgRmsqOzaZXnKWnI", name: "Sunny",    accent: "Australian", gender: "Female" },
  { id: "5GZaeOOG7yqLdoTRsaa6", name: "Sally",    accent: "Australian", gender: "Female" },
  { id: "gnza9thg1bDor49Sxvtl", name: "Hannah",   accent: "Australian", gender: "Female" },
  { id: "IdDgBtBBVTnSVb4wDvbT", name: "Samantha", accent: "Australian", gender: "Female" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",   accent: "British",    gender: "Male" },
  { id: "YxV306TE3Zjvmce8pOII", name: "Michael",  accent: "British",    gender: "Male" },
  { id: "vhBIP7TzXaD17CYHAfIZ", name: "Jack",     accent: "British",    gender: "Male" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",     accent: "British",    gender: "Female" },
  { id: "5lh7QJfTUjzApFMaXyGe", name: "Charlotte",accent: "British",    gender: "Female" },
  { id: "tOelxWDthXw42aCNp41N", name: "Romy",     accent: "British",    gender: "Female" },
  { id: "LM5QaByxyWDmNhcQTYiS", name: "Sophia",   accent: "British",    gender: "Female" },
  { id: "xyY1A1culQEvzoU6aS0N", name: "Ronan",    accent: "Irish",      gender: "Male" },
  { id: "ehKZw5kruBt73Gytae2x", name: "Robyn",    accent: "Irish",      gender: "Female" },
  { id: "WtSj8ZSBSK3JEi9xgqBG", name: "Orla",     accent: "Irish",      gender: "Female" },
  { id: "GFyWqnwcF2mv6dWlo3u1", name: "John",     accent: "Irish",      gender: "Male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",    accent: "American",   gender: "Female" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",    accent: "American",   gender: "Male" },
] as const;

export function findVoice(idOrName: string) {
  const q = idOrName.trim().toLowerCase();
  return VOICES.find(v => v.id.toLowerCase() === q || v.name.toLowerCase() === q);
}
