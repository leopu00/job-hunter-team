/**
 * HTML to readable text, without a parser dependency.
 *
 * Good enough for a model to read a page: scripts, styles and navigation
 * chrome go, headings and list items keep a marker, links keep their target,
 * entities are decoded. It is not a sanitiser and makes no attempt to be one —
 * the output only ever becomes text in a prompt.
 */

const DROPPED = /<(script|style|noscript|svg|template|iframe|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1] ?? "").replace(/\s+/g, " ").trim() : undefined;

  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROPPED, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|main|aside|ul|ol|table|tr|blockquote|pre|dl|dt|dd|form)>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (!label) return "";
      return href.startsWith("#") || href.startsWith("javascript:") ? label : `[${label}](${href})`;
    })
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return title ? { title, text } : { text };
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  egrave: "è",
  eacute: "é",
  agrave: "à",
  ograve: "ò",
  ugrave: "ù",
  igrave: "ì",
  Egrave: "È",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  middot: "·",
  deg: "°",
  sup2: "²",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : entity;
    }
    return NAMED[body] ?? entity;
  });
}
