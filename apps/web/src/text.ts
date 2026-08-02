export function splitIntoSpokenSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  return (normalized.match(/[^.!?。！？\n]+[.!?。！？]?|\n+/g) || [normalized])
    .map((part) => part.trim())
    .filter(Boolean);
}
