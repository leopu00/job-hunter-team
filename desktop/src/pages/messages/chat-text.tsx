import type { ReactNode } from "react";

/**
 * What the team writes in the chat is an LLM's text: plain text with the marks it likes (bold, italic,
 * code, lists, headings) and, from older automatic reports, a few HTML tags. It is rendered as React
 * nodes and nothing else: no HTML is ever inserted, no link is made clickable (a link in a reply is
 * shown as its words and its address), the two harmless HTML emphasis tags still count as emphasis and
 * every other HTML tag is dropped (a `<` that is not a tag, as in `RAL < 50k`, stays). A text with none of these marks comes out unchanged.
 */

// One pass over a line: `**bold**`, `*italic*` (the stars touch the words: `2 * 3 * 4` stays as it is),
// `code`, a `[words](address)` link, the old <i>/<em> tags, and any other tag.
// A tag is dropped only when it is an HTML element's: `RAL < 50k e > 40k`, `Vec<String>` and `<name@example.com>`
// are text and stay (React shows them as text anyway: nothing here can become markup).
const HTML_TAGS =
  "a|abbr|address|article|aside|audio|b|base|blockquote|body|br|button|canvas|code|dd|details|div|dl|dt|em|embed|figure|font|footer|form|frame|frameset|h[1-6]|head|header|hr|html|i|iframe|img|input|label|li|link|main|map|meta|nav|noscript|object|ol|option|p|picture|pre|script|section|select|small|source|span|strong|style|sub|summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|title|tr|u|ul|video";
const INLINE = new RegExp(
  "\\*\\*([^*\\n]*[^*\\s][^*\\n]*)\\*\\*|\\*([^*\\s][^*\\n]*[^*\\s]|[^*\\s])\\*|`([^`\\n]+)`|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)|<(i|em)>([^<]*)<\\/\\6>|<\\/?(?:" +
    HTML_TAGS +
    ")(?:\\s[^<>\\n]*)?\\/?>",
  "gi",
);

/** A line longer than this is shown as plain text: the marks of such a line are not worth a pass over it. */
const MAX_MARKED_LINE = 2000;

/** The inline marks of one line, as nodes; a very long line is plain text (the pass over it is not linear). */
function renderLine(text: string, keyPrefix: string): ReactNode[] {
  if (text.length > MAX_MARKED_LINE) return [text];
  const nodes: ReactNode[] = [];
  let end = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text))) {
    if (match.index > end) nodes.push(text.slice(end, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1] !== undefined) nodes.push(<strong key={key} className="font-bold text-[var(--color-white)]">{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<em key={key}>{match[2]}</em>);
    else if (match[3] !== undefined) {
      nodes.push(
        <code key={key} className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1 text-[0.92em]">
          {match[3]}
        </code>,
      );
    } else if (match[4] !== undefined) nodes.push(`${match[4]} (${match[5]})`);
    else if (match[6] !== undefined) nodes.push(<em key={key}>{match[7]}</em>);
    // any other HTML tag: dropped
    end = INLINE.lastIndex;
  }
  if (end < text.length) nodes.push(text.slice(end));
  return nodes;
}

/** The inline marks of one piece of text, as nodes, line by line (the line breaks stay). */
export function renderChatText(text: string, keyPrefix = "t"): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) nodes.push("\n");
    nodes.push(...renderLine(line, `${keyPrefix}${index}`));
  });
  return nodes;
}

const FENCE = /^\s*```/;
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lines: string[] };

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i += 1; // the closing fence, or the end
      blocks.push({ kind: "code", lines: code });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] });
      i += 1;
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const item = (ordered ? NUMBERED : BULLET).exec(lines[i]);
        if (!item) break;
        items.push(item[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i])
    ) {
      paragraph.push(lines[i++]);
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/**
 * A message as blocks: paragraphs (their line breaks kept), lists, headings as bold lines and code
 * fences. A text with no block marks is one paragraph, as it was before.
 */
export function renderChatMarkdown(text: string): ReactNode {
  return blocksOf(text).map((block, index) => {
    const key = `b${index}`;
    const gap = index === 0 ? "" : "mt-2";
    if (block.kind === "code") {
      return (
        <pre
          key={key}
          className={`${gap} m-0 max-w-full overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[0.92em] leading-snug`}
        >
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    }
    if (block.kind === "heading") {
      return (
        <p key={key} className={`${gap} m-0 font-bold text-[var(--color-white)]`}>
          {renderChatText(block.text, key)}
        </p>
      );
    }
    if (block.kind === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className={`${gap} m-0 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, n) => (
            <li key={`${key}-${n}`} className="pl-0.5">
              {renderChatText(item, `${key}-${n}`)}
            </li>
          ))}
        </Tag>
      );
    }
    return (
      <p key={key} className={`${gap} m-0 whitespace-pre-wrap break-words`}>
        {renderChatText(block.lines.join("\n"), key)}
      </p>
    );
  });
}
