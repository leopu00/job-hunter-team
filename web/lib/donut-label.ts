/**
 * Etichetta al centro della ciambella.
 *
 * Il buco misura `INNER * 2` unità di viewBox: un nome di famiglia lungo
 * («Agentic AI / LLM Engineering») ci finiva scritto sopra l'anello e fuori
 * dalla card. Qui lo si accorcia a quello che il buco può contenere; il nome
 * intero resta nella legenda, nel `title` della fetta e nell'aria-label.
 */
export const CENTER_LABEL_MAX_CHARS = 10;

export function fitCenterLabel(
  text: string,
  maxChars: number = CENTER_LABEL_MAX_CHARS,
): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars) return t;
  // Taglia a fine parola se resta almeno mezza etichetta, altrimenti a
  // metà parola: «Agentic AI…» meglio di «Agentic A…».
  const room = t.slice(0, maxChars - 1);
  const lastSpace = room.lastIndexOf(" ");
  const cut =
    lastSpace >= Math.floor(maxChars / 2) ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s/·,-]+$/, "")}…`;
}
