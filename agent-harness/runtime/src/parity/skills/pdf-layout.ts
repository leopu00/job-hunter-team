/**
 * `pdf_layout_check.analyze`: the visual gate a CV passes before it may go
 * out, measured with poppler — the port the CLOSER's queue needs to be able
 * to say READY at all (T39, piece three).
 *
 * Why the gate exists is the script's story: application 2067 passed every
 * check on size and engine and still printed its text in a 41–57% column in
 * the middle of the sheet, and a later CV printed its body at 6.9pt. Nobody
 * had measured where the text sits. The script measures it, and the sending
 * code refuses a CV it cannot measure (`cv_pdf_check_unavailable`): without
 * this port the harness could never measure one, so the CLOSER's queue was
 * never ready and the role never reached the step it has to refuse.
 *
 * Same numbers, same verdict, same report as the script: the thresholds are
 * its constants, the rounding is Python's (`round` is half-to-even on the
 * double's exact value, which `toFixed` is not), and `reportJson` prints what
 * `pdf_layout_check.py <pdf> --json` prints, byte for byte — the parity test
 * compares the two texts, not two objects.
 *
 * **The binaries are detected, never declared** (the rule the PDF toolchain
 * taught, `DETECTED` in jht-tools.ts): an image may or may not carry poppler,
 * and the answer is asked of PATH at every call — a box where poppler appears
 * later measures from then on. Missing is a `CheckError`, which the gate reads
 * as `cv_pdf_check_unavailable`, as the script does.
 *
 * **Fixed arguments, no shell.** Nothing here comes from the model: the file
 * is the one the database names (and the gate confines it before it gets
 * here), each argv is written below in full, and every process runs with
 * `spawnSync` on an array, a scrubbed environment and a deadline. The file is
 * passed as an absolute path, so a name that starts with `-` can never be
 * read as a flag.
 *
 * Not ported: `render_preview` (a PNG of page 1, written next to the send
 * flow's checkpoint for the person to look at) and the command line. The
 * first is a WRITE and the gate that calls this is read-only here; the second
 * has no caller — the only reader is the gate.
 */

import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { pyFixed, pyStrip } from "../../db/py-format.ts";
import { scrubEnv } from "../../tools/bash.ts";
import { onPath } from "../jht-tools.ts";
import { PyFloat, pyJson } from "./py-compat.ts";

export const PT_PER_MM = 72 / 25.4;
/** Must match the margins of the render command (`engineArgs` in render-pdf.ts, cv-structure/SKILL.md). */
export const DEFAULT_MARGIN_LR_MM = 15.0;
export const DEFAULT_MARGIN_TB_MM = 11.0;
export const MIN_WIDTH_RATIO = 0.75;
export const MAX_PAGES = 2;
/** A page is "nearly empty" below this share of the usable height or line count. */
export const MIN_FILL_RATIO = 0.2;
export const MIN_LINES_PER_PAGE = 4;
/**
 * Width is judged only on pages with enough lines to have wrapped at least
 * once: a page of five short lines says nothing about the column.
 */
export const MIN_LINES_FOR_WIDTH = 8;
export const MIN_BODY_FONT_PT = 9.5;
/**
 * Word-box height per point of font size in poppler's -bbox output, measured
 * by the script on DejaVu Sans from wkhtmltopdf (6.92pt → 8.1, 9.80pt → 11.4,
 * 10.95pt → 12.8). A shorter font reads slightly smaller: the error is on the
 * strict side, never a small font passed as readable.
 */
export const BBOX_HEIGHT_PER_PT = 1.17;

/** The stable codes, in the order the report lists them. */
export const REASONS = ["too_many_pages", "narrow_text", "near_empty_page", "small_body_font", "fonts_not_embedded", "no_text"] as const;
export type LayoutReason = (typeof REASONS)[number];

/** The poppler programs the check runs. `pdftoppm` is the preview's, which is not ported. */
export const PDFTOTEXT = "pdftotext";
export const PDFFONTS = "pdffonts";

/** The script's `timeout=60`: a CV is milliseconds of work, a hung poppler is not a verdict. */
const TIMEOUT_MS = 60_000;
/** What a program may print before it is cut off: a CV's bbox XHTML is tens of KB. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const PAGE_RE = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
const WORD_RE = /<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g;
const LINE_RE = /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/g;

/** The PDF could not be measured: the caller must treat it as a failure, never as a pass. */
export class CheckError extends Error {
  override name = "CheckError";
}

/** Python's `round(x, digits)`: the exact value rounded half to even. */
function pyRound(x: number, digits: number): number {
  return Number(pyFixed(x, digits));
}

/** `shutil.which`, answered by the same PATH lookup the shell guard uses. */
function tool(name: string, env: NodeJS.ProcessEnv): string {
  if (!onPath(name, env)) throw new CheckError(`${name} not found (poppler-utils missing)`);
  return name;
}

/** `_run`: stdout of a program that exited 0, or a `CheckError` saying why not. */
function run(program: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const done = spawnSync(program, args, {
    env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (done.error !== undefined) throw new CheckError(`${program} failed: ${done.error.message}`);
  // Python reports a signal as a negative return code; so does this.
  const code = done.status ?? (done.signal ? -(osConstants.signals[done.signal] ?? 0) : -1);
  if (code !== 0) throw new CheckError(`${program} exit ${code}: ${Array.from(pyStrip(done.stderr ?? "")).slice(0, 200).join("")}`);
  return done.stdout ?? "";
}

/** A text line box: xMin, yMin, xMax, yMax. */
type Box = [number, number, number, number];

export interface Page {
  width: number;
  height: number;
  lines: Box[];
}

export interface Font {
  name: string;
  embedded: boolean;
}

/** `read_pages`: page size and text line boxes, from `pdftotext -bbox-layout`. */
export function readPages(pdf: string, env: NodeJS.ProcessEnv): Page[] {
  const xhtml = run(tool(PDFTOTEXT, env), ["-bbox-layout", pdf, "-"], env);
  const pages: Page[] = [];
  for (const [, width, height, body] of xhtml.matchAll(PAGE_RE)) {
    const lines = Array.from(body!.matchAll(LINE_RE), (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as Box);
    pages.push({ width: Number(width), height: Number(height), lines });
  }
  return pages;
}

/** `body_font_pt`: the printed size of the body font — the word height carried by most words. */
export function bodyFontPt(pdf: string, env: NodeJS.ProcessEnv): number | null {
  const xhtml = run(tool(PDFTOTEXT, env), ["-bbox", pdf, "-"], env);
  const heights = new Map<number, number>();
  for (const [, top, bottom, text] of xhtml.matchAll(WORD_RE)) {
    if (pyStrip(text!) === "") continue;
    const height = pyRound(Number(bottom) - Number(top), 1);
    heights.set(height, (heights.get(height) ?? 0) + 1);
  }
  if (heights.size === 0) return null;
  // Ties go to the smaller height: a CV split evenly between two sizes is
  // judged by the one that has to be readable.
  let best: number | null = null;
  for (const [height, count] of heights) {
    const top = best === null ? 0 : heights.get(best)!;
    if (best === null || count > top || (count === top && height < best)) best = height;
  }
  return pyRound(best! / BBOX_HEIGHT_PER_PT, 2);
}

/** `str.splitlines()`: its boundaries, and no empty line after a final break. */
function splitlines(text: string): string[] {
  const rows = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (rows.length > 0 && rows.at(-1) === "") rows.pop();
  return rows;
}

/** `read_fonts`: font names and the embedded flag, from `pdffonts` (fixed-width columns). */
export function readFonts(pdf: string, env: NodeJS.ProcessEnv): Font[] {
  const rows = splitlines(run(tool(PDFFONTS, env), [pdf], env));
  if (rows.length < 2) return [];
  const [header, dashes] = [rows[0]!, rows[1]!];
  // Column spans come from the dashes row: names may contain spaces.
  const spans = Array.from(dashes.matchAll(/-+/g), (m) => [m.index!, m.index! + m[0].length] as const);
  const titles = spans.map(([a, b]) => pyStrip(header.slice(a, b)));
  const emb = titles.indexOf("emb");
  // `titles.index("emb")` raises ValueError in the script, and the gate reads
  // any exception as an unmeasured CV. An Error here, not a CheckError: the
  // gate catches both, and the difference says which kind of fault it was.
  if (emb < 0) throw new Error("'emb' is not in list");
  return rows.slice(2).map((row) => {
    const cells = spans.map(([a, b]) => pyStrip(row.slice(a, b + 1)));
    return { name: cells[0]!, embedded: cells[emb] === "yes" };
  });
}

export interface PageEntry {
  page: number;
  lines: number;
  text_width_pt: number | null;
  width_ratio: number | null;
  fill_ratio: number;
}

export interface LayoutReport {
  ok: boolean;
  reasons: LayoutReason[];
  pages: number;
  usable_width_pt: number;
  min_width_ratio: number;
  body_font_pt: number | null;
  min_body_font_pt: number;
  per_page: PageEntry[];
  fonts: Font[];
}

export interface AnalyzeOptions {
  marginLeftMm?: number;
  marginRightMm?: number;
  marginTbMm?: number;
  minWidthRatio?: number;
  maxPages?: number;
  minBodyFontPt?: number;
  /** The environment poppler is looked for in and runs with. Default: this process's, scrubbed. */
  env?: NodeJS.ProcessEnv;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `min`/`max` of one coordinate, in a loop: a spread of a long PDF's boxes would overflow the stack. */
function extreme(boxes: readonly Box[], at: 0 | 1 | 2 | 3, pick: (a: number, b: number) => number): number {
  let out = boxes[0]![at];
  for (const box of boxes) out = pick(out, box[at]);
  return out;
}

/**
 * `analyze`: the report on one PDF. Throws `CheckError` when the file cannot
 * be measured — not a file, poppler missing or failing, no page at all.
 */
export function analyze(pdf: string, options: AnalyzeOptions = {}): LayoutReport {
  const {
    marginLeftMm = DEFAULT_MARGIN_LR_MM,
    marginRightMm = DEFAULT_MARGIN_LR_MM,
    marginTbMm = DEFAULT_MARGIN_TB_MM,
    minWidthRatio = MIN_WIDTH_RATIO,
    maxPages = MAX_PAGES,
    minBodyFontPt = MIN_BODY_FONT_PT,
  } = options;
  const env = options.env ?? scrubEnv(process.env);
  if (!isFile(pdf)) throw new CheckError(`not a file: ${pdf}`);
  // Absolute before it reaches an argv: a relative name that starts with `-`
  // would be an option to poppler.
  const file = resolve(pdf);
  const pages = readPages(file, env);
  if (pages.length === 0) throw new CheckError("no pages found");
  const fonts = readFonts(file, env);
  const bodyPt = bodyFontPt(file, env);

  const reasons = new Set<LayoutReason>();
  const perPage: PageEntry[] = [];
  let judged = 0;
  // The column's left edge is shared by every page: taking it per page would
  // let a page of indented bullets look narrower than it is.
  const all = pages.flatMap((p) => p.lines);
  const left = all.length === 0 ? 0 : extreme(all, 0, Math.min);
  pages.forEach((page, i) => {
    const usableW = page.width - (marginLeftMm + marginRightMm) * PT_PER_MM;
    const usableH = page.height - 2 * marginTbMm * PT_PER_MM;
    const lines = page.lines;
    const entry: PageEntry = { page: i + 1, lines: lines.length, text_width_pt: null, width_ratio: null, fill_ratio: 0 };
    if (lines.length > 0) {
      const right = extreme(lines, 2, Math.max);
      const top = extreme(lines, 1, Math.min);
      const bottom = extreme(lines, 3, Math.max);
      entry.fill_ratio = pyRound((bottom - top) / usableH, 3);
      if (lines.length >= MIN_LINES_FOR_WIDTH) {
        judged += 1;
        entry.text_width_pt = pyRound(right - left, 1);
        entry.width_ratio = pyRound((right - left) / usableW, 3);
        // The ROUNDED ratio is the one compared, as in the script.
        if (entry.width_ratio < minWidthRatio) reasons.add("narrow_text");
      }
    }
    if (lines.length < MIN_LINES_PER_PAGE || entry.fill_ratio < MIN_FILL_RATIO) reasons.add("near_empty_page");
    perPage.push(entry);
  });

  if (pages.length > maxPages) reasons.add("too_many_pages");
  if (judged === 0) reasons.add("no_text");
  if (bodyPt !== null && bodyPt < minBodyFontPt) reasons.add("small_body_font");
  if (fonts.length === 0 || !fonts.every((f) => f.embedded)) reasons.add("fonts_not_embedded");

  const first = pages[0]!;
  return {
    ok: reasons.size === 0,
    reasons: REASONS.filter((r) => reasons.has(r)),
    pages: pages.length,
    usable_width_pt: pyRound(first.width - (marginLeftMm + marginRightMm) * PT_PER_MM, 1),
    min_width_ratio: minWidthRatio,
    body_font_pt: bodyPt,
    min_body_font_pt: minBodyFontPt,
    per_page: perPage,
    fonts,
  };
}

/**
 * The report as `pdf_layout_check.py --json` prints it
 * (`json.dumps(report, ensure_ascii=False)`): every measure a float, so
 * `495.0` and not `495`, and the counts integers.
 */
export function reportJson(report: LayoutReport): string {
  const float = (x: number | null) => (x === null ? null : new PyFloat(x));
  return pyJson(
    {
      ok: report.ok,
      reasons: report.reasons,
      pages: report.pages,
      usable_width_pt: float(report.usable_width_pt),
      min_width_ratio: float(report.min_width_ratio),
      body_font_pt: float(report.body_font_pt),
      min_body_font_pt: float(report.min_body_font_pt),
      per_page: report.per_page.map((p) => ({
        page: p.page,
        lines: p.lines,
        text_width_pt: float(p.text_width_pt),
        width_ratio: float(p.width_ratio),
        fill_ratio: float(p.fill_ratio),
      })),
      fonts: report.fonts.map((f) => ({ name: f.name, embedded: f.embedded })),
    },
    { ensureAscii: false },
  );
}
