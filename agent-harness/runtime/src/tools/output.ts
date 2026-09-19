/** Cuts `text` to `maxChars` and says so, so a head never passes for a whole. */
export function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  return `${kept}\n\n[cut: showing the first ${maxChars} of ${text.length} characters]`;
}
