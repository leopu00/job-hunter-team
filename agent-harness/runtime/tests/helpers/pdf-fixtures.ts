/**
 * PDFs written by hand, for the layout check (pdf-layout.ts) and for the
 * CLOSER's run: real files poppler measures, with no renderer and no binary
 * fixture in the repository.
 *
 * The one thing a hand-written PDF usually cannot do is PASS: the check wants
 * every font embedded, and the 14 standard fonts are not. A Type 3 font is —
 * its glyphs are content streams inside the file, and `pdffonts` reports it
 * `emb yes` — so the passing CV below is set in one: blank glyphs, 500 units
 * wide, named after the letters so `pdftotext` still reads the words.
 */

export interface PdfLine {
  x: number;
  /** Baseline, from the bottom of the page, in points. */
  y: number;
  text: string;
  /** Font size in points. Default: the document's. */
  size?: number;
  /** The standard, NOT embedded Helvetica instead of the embedded Type 3 font. */
  helvetica?: boolean;
}

export interface PdfOptions {
  /** Font size of every line that names none. */
  size?: number;
  /** Every line in Helvetica: a CV whose fonts are not embedded. */
  helvetica?: boolean;
  width?: number;
  height?: number;
}

/** A4, in points: what the render command prints on. */
export const A4 = { width: 595.28, height: 841.89 };
/** The left margin of the render command (15 mm), where a CV's text starts. */
export const LEFT = 42.52;

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/** A PDF with one page per entry of `pages`, each a list of text lines. */
export function writePdf(pages: PdfLine[][], options: PdfOptions = {}): Buffer {
  const { size = 11, width = A4.width, height = A4.height } = options;
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add(""); // 1: catalog, filled in last
  add(""); // 2: page tree, filled in last
  const glyph = add("<< /Length 8 >>\nstream\n500 0 d0\nendstream");
  const procs = add(`<< /space ${glyph} 0 R ${LETTERS.map((l) => `/${l} ${glyph} 0 R`).join(" ")} >>`);
  const type3 = add(
    `<< /Type /Font /Subtype /Type3 /FontBBox [0 -200 500 800] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs ${procs} 0 R ` +
      `/Encoding << /Type /Encoding /Differences [32 /space 97 ${LETTERS.map((l) => `/${l}`).join(" ")}] >> ` +
      `/FirstChar 32 /LastChar 122 /Widths [${Array.from({ length: 91 }, () => 500).join(" ")}] >>`,
  );
  const helvetica = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const body = lines
      .map((l) => `BT /${(l.helvetica ?? options.helvetica) ? "F2" : "F1"} ${l.size ?? size} Tf ${l.x} ${l.y} Td (${l.text}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`);
    // Only the fonts the page uses: `pdffonts` lists every font a page's
    // resources name, used or not, and an unused Helvetica would count.
    const fonts = [body.includes("/F1 ") ? `/F1 ${type3} 0 R` : "", body.includes("/F2 ") ? `/F2 ${helvetica} 0 R` : ""].filter(Boolean).join(" ");
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << ${fonts} >> >> >>`));
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A line of body text 90 characters wide: 495pt at 11pt, 97% of the usable width. */
export const FULL_LINE = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut";

/** `count` lines from the top of the sheet down, 18pt apart. */
export function column(count: number, options: { x?: number; text?: string; top?: number; step?: number; size?: number } = {}): PdfLine[] {
  const { x = LEFT, text = FULL_LINE, top = 800, step = 18 } = options;
  return Array.from({ length: count }, (_, i) => ({ x, y: top - i * step, text, ...(options.size ? { size: options.size } : {}) }));
}

/** The CV that passes: one full page, full width, 11pt, embedded font. */
export function passingCv(): Buffer {
  return writePdf([column(40)]);
}
