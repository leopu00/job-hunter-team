/**
 * The markdown of a CV or a cover letter, for the preview in the app.
 *
 * The document was written by an agent that read other people's text, so this is a surface for hostile text and it
 * is built as one: it turns the markdown into a small tree of TEXT and nothing else. There is no HTML anywhere in
 * it, because there is no HTML in it at all: a raw tag, a `<style>`, a `<script>`, a comment, a CDATA section, an
 * image or a link address never becomes an element or an attribute. Links are shown as text («label (address)»),
 * images as their alternative text, and everything the page draws goes through React text nodes.
 *
 * It is also bounded: the nesting is at most `MAX_DEPTH`, the tree at most `MAX_NODES` nodes, and every scan
 * moves forward only (a delimiter that has no closer is remembered, so a hundred thousand of them are one pass,
 * not a hundred thousand passes).
 */

export const MAX_DEPTH = 20;
export const MAX_NODES = 20_000;
/** The longest address a link shows. The rest is cut. */
export const MAX_ADDRESS = 200;
const MAX_LABEL = 500;
const MAX_TAG = 500;
const MAX_FENCE_LINES = 2_000;
const MAX_BLOCK_SEARCH = 2_000;
const MAX_FRONT_MATTER = 500;

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "emphasis"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; label: Inline[]; address: string };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "item"; ordered: boolean; level: number; marker: string; children: Inline[] }
  | { kind: "quote"; level: number; children: Inline[] }
  | { kind: "code"; lines: string[] }
  | { kind: "rule" };

export interface ParsedMarkdown {
  blocks: Block[];
  /** The tree hit the cap: the page says the rest is not shown. */
  truncated: boolean;
}

/**
 * Characters that change what the eye reads or hide text: controls (but not a line break or a tab), soft hyphens,
 * zero-width and direction marks, the line and paragraph separators, the bidirectional embeddings and isolates, the
 * invisible operators, the byte order mark, the interlinear annotation marks, the Mongolian vowel separator, the
 * Arabic letter mark and the tag characters.
 */
const HIDDEN_OR_STEERING = new RegExp(
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF\\uFFF9-\\uFFFB]|[\\u{E0000}-\\u{E007F}]",
  "gu",
);

/** The text with its hidden and steering characters taken out and its line ends made `\n`. */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(HIDDEN_OR_STEERING, "");
}

class Budget {
  nodes = 0;
  truncated = false;
  spend(count = 1): boolean {
    this.nodes += count;
    if (this.nodes > MAX_NODES) {
      this.truncated = true;
      return false;
    }
    return true;
  }
}

/** Remembers where a search for a closer already failed: any later search of the same kind fails too. */
class Misses {
  private readonly from = new Map<string, number>();
  find(text: string, needle: string, start: number): number {
    const failed = this.from.get(needle);
    if (failed !== undefined && start >= failed) return -1;
    const at = text.indexOf(needle, start);
    if (at < 0) this.from.set(needle, failed === undefined ? start : Math.min(failed, start));
    return at;
  }
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A tag, a comment, a declaration: dropped whole. Returns where the text goes on, or -1 when this is no tag. */
function skipTag(text: string, at: number, end: number): number {
  const next = text[at + 1];
  if (next === undefined || !/[A-Za-z/!?]/.test(next)) return -1;
  if (text.startsWith("<!--", at)) {
    const close = text.indexOf("-->", at + 4);
    return close >= 0 && close < end ? close + 3 : -1;
  }
  const close = text.indexOf(">", at + 1);
  return close >= 0 && close <= at + MAX_TAG && close < end ? close + 1 : -1;
}

/** The inline text of one run of lines: strong, emphasis, code, links, images, and text. */
function parseInline(source: string, budget: Budget): Inline[] {
  const misses = new Misses();
  const parse = (from: number, to: number, depth: number): Inline[] => {
    const out: Inline[] = [];
    let buffer = "";
    const flush = () => {
      if (buffer) {
        if (budget.spend()) out.push({ kind: "text", text: buffer });
        buffer = "";
      }
    };
    let i = from;
    while (i < to) {
      if (budget.truncated) break;
      const c = source[i];
      if (c === "\\" && i + 1 < to && /[\\`*_{}[\]()#+\-.!<>|~]/.test(source[i + 1])) {
        buffer += source[i + 1];
        i += 2;
        continue;
      }
      if (c === "`") {
        let ticks = 1;
        while (source[i + ticks] === "`") ticks++;
        const fence = "`".repeat(ticks);
        const close = misses.find(source, fence, i + ticks);
        if (close >= 0 && close < to) {
          flush();
          if (budget.spend()) out.push({ kind: "code", text: source.slice(i + ticks, close).trim() });
          i = close + ticks;
          continue;
        }
        buffer += fence;
        i += ticks;
        continue;
      }
      if (c === "<") {
        const after = skipTag(source, i, to);
        if (after >= 0) {
          // an address in angle brackets is shown as the text it is
          const inner = source.slice(i + 1, after - 1);
          if (/^https?:\/\/[^\s<>]+$/i.test(inner)) buffer += cut(inner, MAX_ADDRESS);
          i = after;
          continue;
        }
        buffer += c;
        i++;
        continue;
      }
      if (c === "*" || c === "_") {
        const double = source[i + 1] === c;
        const mark = double ? c + c : c;
        const close = depth < MAX_DEPTH ? misses.find(source, mark, i + mark.length) : -1;
        const canOpen = source[i + mark.length] !== undefined && !/\s/.test(source[i + mark.length]);
        if (close >= 0 && close < to && canOpen && close > i + mark.length) {
          flush();
          const children = parse(i + mark.length, close, depth + 1);
          if (budget.spend()) out.push({ kind: double ? "strong" : "emphasis", children });
          i = close + mark.length;
          continue;
        }
        buffer += mark;
        i += mark.length;
        continue;
      }
      if (c === "[" || (c === "!" && source[i + 1] === "[")) {
        const image = c === "!";
        const open = image ? i + 1 : i;
        const closeLabel = misses.find(source, "](", open + 1);
        if (closeLabel >= 0 && closeLabel < to && closeLabel - open <= MAX_LABEL) {
          const closeAddress = misses.find(source, ")", closeLabel + 2);
          if (closeAddress >= 0 && closeAddress < to) {
            flush();
            const address = cut(source.slice(closeLabel + 2, closeAddress).trim().split(/\s+/)[0] ?? "", MAX_ADDRESS);
            const label = depth < MAX_DEPTH ? parse(open + 1, closeLabel, depth + 1) : [];
            if (image) {
              // the alternative text, as text: the picture is never loaded
              for (const part of label) if (budget.spend()) out.push(part);
            } else if (budget.spend()) {
              out.push({ kind: "link", label, address });
            }
            i = closeAddress + 1;
            continue;
          }
        }
        buffer += image ? "![" : "[";
        i += image ? 2 : 1;
        continue;
      }
      buffer += c;
      i++;
    }
    flush();
    return out;
  };
  return parse(0, source.length, 0);
}

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE = /^ {0,3}((?:>[ \t]?)+)(.*)$/;
const HTML_OPEN = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*|\/[A-Za-z][A-Za-z0-9-]*|!--|!\[CDATA\[|[!?])/;
const RAW_TEXT_ELEMENTS: Record<string, string> = { style: "</style", script: "</script", pre: "</pre", textarea: "</textarea" };

/** Where a raw HTML block that opens at `start` ends, and the line to go on from. */
function skipHtmlBlock(lines: string[], start: number): number {
  const first = lines[start];
  const open = HTML_OPEN.exec(first);
  const name = (open?.[1] ?? "").toLowerCase();
  const limit = Math.min(lines.length, start + MAX_BLOCK_SEARCH);
  const closer = name === "!--" ? "-->" : name === "![cdata[" ? "]]>" : RAW_TEXT_ELEMENTS[name];
  if (closer) {
    for (let at = start; at < limit; at++) if (lines[at].toLowerCase().includes(closer)) return at + 1;
  }
  // an unclosed one, or an ordinary tag: up to the next blank line, never the rest of the document
  let at = start + 1;
  while (at < lines.length && lines[at].trim() !== "") at++;
  return at;
}

/** The markdown of a document as blocks of text, within the caps. */
export function parseMarkdown(markdown: string): ParsedMarkdown {
  const budget = new Budget();
  const lines = cleanText(markdown).split("\n");
  const blocks: Block[] = [];
  const push = (block: Block): boolean => {
    if (!budget.spend()) return false;
    blocks.push(block);
    return true;
  };
  let i = 0;
  // a front matter block is skipped when it closes within a reasonable number of lines
  if (lines[0]?.trim() === "---") {
    const limit = Math.min(lines.length, MAX_FRONT_MATTER);
    for (let at = 1; at < limit; at++) {
      if (lines[at].trim() === "---" || lines[at].trim() === "...") {
        i = at + 1;
        break;
      }
    }
  }
  let paragraph: string[] = [];
  const flushParagraph = (): boolean => {
    if (paragraph.length === 0) return true;
    const children = parseInline(paragraph.join("\n"), budget);
    paragraph = [];
    return children.length === 0 || push({ kind: "paragraph", children });
  };
  while (i < lines.length && !budget.truncated) {
    const line = lines[i];
    if (line.trim() === "") {
      if (!flushParagraph()) break;
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      if (!flushParagraph()) break;
      const mark = fence[1];
      const body: string[] = [];
      let at = i + 1;
      while (at < lines.length && at < i + 1 + MAX_FENCE_LINES && !lines[at].trimStart().startsWith(mark)) body.push(lines[at++]);
      if (!push({ kind: "code", lines: body })) break;
      i = at < lines.length && lines[at].trimStart().startsWith(mark) ? at + 1 : at;
      continue;
    }
    if (HTML_OPEN.test(line)) {
      if (!flushParagraph()) break;
      i = skipHtmlBlock(lines, i);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      if (!flushParagraph()) break;
      if (!push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2], budget) })) break;
      i++;
      continue;
    }
    if (RULE.test(line)) {
      if (!flushParagraph() || !push({ kind: "rule" })) break;
      i++;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      if (!flushParagraph()) break;
      const level = Math.min(MAX_DEPTH, (quote[1].match(/>/g) ?? []).length);
      if (!push({ kind: "quote", level, children: parseInline(quote[2], budget) })) break;
      i++;
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      if (!flushParagraph()) break;
      const level = Math.min(MAX_DEPTH, Math.floor(item[1].length / 2));
      const marker = item[2];
      if (!push({ kind: "item", ordered: /\d/.test(marker), level, marker, children: parseInline(item[3], budget) })) break;
      i++;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return { blocks, truncated: budget.truncated };
}
