import { describe, expect, it } from "vitest";
import { cleanText, MAX_ADDRESS, MAX_DEPTH, MAX_NODES, parseMarkdown, type Block, type Inline, type ParsedMarkdown } from "./safe-markdown";

const MIB = 1024 * 1024;
const repeat = (piece: string, length: number) => piece.repeat(Math.ceil(length / piece.length)).slice(0, length);

function inlineStats(list: Inline[], depth = 1): { depth: number; nodes: number } {
  let deepest = depth;
  let nodes = 0;
  for (const node of list) {
    nodes++;
    const children = node.kind === "strong" || node.kind === "emphasis" ? node.children : node.kind === "link" ? node.label : null;
    if (children) {
      const inner = inlineStats(children, depth + 1);
      deepest = Math.max(deepest, inner.depth);
      nodes += inner.nodes;
    }
  }
  return { depth: deepest, nodes };
}

function stats(parsed: ParsedMarkdown) {
  let depth = 0;
  let nodes = parsed.blocks.length;
  for (const block of parsed.blocks) {
    if ("children" in block) {
      const inner = inlineStats(block.children);
      depth = Math.max(depth, inner.depth);
      nodes += inner.nodes;
    }
  }
  return { depth, nodes };
}

/** Every piece of text the document produced, joined: what the page would show. */
function shownText(parsed: ParsedMarkdown): string {
  const inline = (list: Inline[]): string =>
    list.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : n.kind === "link" ? `${inline(n.label)}(${n.address})` : inline(n.children))).join("");
  return parsed.blocks.map((b: Block) => ("children" in b ? inline(b.children) : b.kind === "code" ? b.lines.join("\n") : "")).join("\n");
}

describe("the markdown of a document becomes a bounded tree of text", () => {
  it("reads a CV: headings, emphasis, lists with their depth, a quote, a rule, a link as text", () => {
    const parsed = parseMarkdown(
      "# Mario Rossi\n\n**Cuoco** — _10 anni_\n\n- Piatto uno\n  - dettaglio\n1. Primo\n\n> citazione\n\n---\n\n[sito](https://x.example/a)",
    );
    expect(parsed.truncated).toBe(false);
    expect(parsed.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "item", "item", "item", "quote", "rule", "paragraph"]);
    expect(parsed.blocks[0]).toEqual({ kind: "heading", level: 1, children: [{ kind: "text", text: "Mario Rossi" }] });
    expect(parsed.blocks[3]).toMatchObject({ kind: "item", level: 1, ordered: false });
    expect(parsed.blocks[4]).toMatchObject({ kind: "item", level: 0, ordered: true, marker: "1." });
    expect(parsed.blocks[7]).toEqual({
      kind: "paragraph",
      children: [{ kind: "link", label: [{ kind: "text", text: "sito" }], address: "https://x.example/a" }],
    });
  });

  it("drops raw HTML whole: tags, style, script, comments, CDATA, never as text and never as an element", () => {
    const parsed = parseMarkdown(
      "<style>body{display:none}</style>\n\n# Title\n\n<script>alert(1)</script>\n\n<!-- a comment -->\n\n<![CDATA[ secret ]]>\n\ntext <img src=x onerror=alert(1)> <b>bold</b> <a href='javascript:alert(1)'>x</a>",
    );
    expect(parsed.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph"]);
    const text = shownText(parsed);
    for (const leaked of ["display:none", "<", ">", "onerror", "javascript", "<style", "CDATA", "a comment"]) expect(text).not.toContain(leaked);
    expect(text).toContain("Title");
    expect(text).toContain("bold");
  });

  it("never lets a link address or an image become anything but text, and cuts the address", () => {
    const long = `https://x.example/${"a".repeat(1000)}`;
    const parsed = parseMarkdown(`[click](javascript:alert(1)) [d](data:text/html;base64,AAA) ![pic](http://evil.example/x.png "t") [l](${long})`);
    const kinds = new Set<string>();
    const walk = (list: Inline[]) => list.forEach((n) => { kinds.add(n.kind); if (n.kind === "link") { walk(n.label); expect(n.address.length).toBeLessThanOrEqual(MAX_ADDRESS + 1); } });
    for (const block of parsed.blocks) if ("children" in block) walk(block.children);
    expect([...kinds].sort()).toEqual(["link", "text"]);
    expect(shownText(parsed)).toContain("pic");
  });

  it("takes out the characters that hide or steer text", () => {
    expect(cleanText("evil\u202Etext\u202C \u2066x\u2069 zero\u200Bwidth soft\u00ADhyphen\uFEFFbom tag\u{E0041} ctrl\u0007bell\r\nnext")).toBe(
      "eviltext x zerowidth softhyphenbom tag ctrlbell\nnext",
    );
    for (const character of ["\u200B", "\u200F", "\u061C", "\u2028", "\u2029", "\u2060", "\u2064", "\u00AD", "\u180E", "\uFEFF", "\uFFF9", "\uFFFB", "\u{E0000}", "\u{E007F}", "\u007F", "\u0085"]) {
      expect(cleanText(`a${character}b`), JSON.stringify(character)).toBe("ab");
    }
    expect(cleanText("a\tb\nc")).toBe("a\tb\nc");
  });

  it("skips a front matter that closes, and keeps the document when it does not", () => {
    expect(shownText(parseMarkdown("---\ntitle: x\n---\n\nbody"))).toBe("body");
    expect(shownText(parseMarkdown(`---\n${repeat("k: v\n", MIB)}`))).toContain("k: v");
  });

  it("keeps an unclosed comment or CDATA to its own lines, never the rest of the document", () => {
    expect(shownText(parseMarkdown("<!-- never closed\nline two\n\nvisible after the blank line"))).toBe("visible after the blank line");
    expect(shownText(parseMarkdown("<![CDATA[ never closed\n\nvisible"))).toBe("visible");
  });

  // The corpus a hostile document can be: every case under a second and inside the caps.
  const corpus: Record<string, string> = {
    "100,000 asterisks": "*".repeat(100_000),
    "100,000 asterisks and words": "*a ".repeat(60_000),
    "100,000 open brackets": "[".repeat(100_000),
    "25,000 link openers": "[a](".repeat(25_000),
    "10,000 nested quotes": `${">".repeat(10_000)} text`,
    "10,000 quote lines of rising depth": Array.from({ length: 10_000 }, (_, i) => `${">".repeat((i % 50) + 1)} q`).join("\n"),
    "list nested 10,000 levels": Array.from({ length: 10_000 }, (_, i) => `${" ".repeat(i)}- x`).join("\n").slice(0, MIB),
    "one line of 1 MiB": repeat("word ", MIB),
    "1 MiB of strong openers": repeat("**a ", MIB),
    "1 MiB of emphasis openers": repeat("_a ", MIB),
    "5,000 strong inside one another": "**a ".repeat(5_000) + "b" + " a**".repeat(5_000),
    "unclosed CDATA": `<![CDATA[ ${"x".repeat(5_000)}\nafter`,
    "unclosed comment": "<!-- never closed\n".repeat(50_000),
    "huge front matter": `---\n${repeat("k: v\n", MIB)}`,
    "50,000 backticks": "`".repeat(50_000),
    "fence of 100,000 lines": `\`\`\`\n${"x\n".repeat(100_000)}`,
    "60,000 headings": "# h\n".repeat(60_000),
    "60,000 list items": "- a\n".repeat(60_000),
    "100,000 tags": "<a>".repeat(100_000),
    "100,000 angle brackets": "<".repeat(100_000),
    "100,000 backslashes": "\\".repeat(100_000),
  };
  for (const [name, text] of Object.entries(corpus)) {
    it(`takes ${name} in under a second, within the caps`, () => {
      const started = performance.now();
      const parsed = parseMarkdown(text);
      const elapsed = performance.now() - started;
      expect(elapsed, `${elapsed.toFixed(0)} ms`).toBeLessThan(1000);
      const { depth, nodes } = stats(parsed);
      expect(nodes).toBeLessThanOrEqual(MAX_NODES + 50);
      expect(depth).toBeLessThanOrEqual(MAX_DEPTH + 2);
      for (const block of parsed.blocks) if (block.kind === "item" || block.kind === "quote") expect(block.level).toBeLessThanOrEqual(MAX_DEPTH);
    });
  }

  it("says the tree was cut when it hits the node cap", () => {
    const parsed = parseMarkdown("- a\n".repeat(60_000));
    expect(parsed.truncated).toBe(true);
    expect(parsed.blocks.length).toBeGreaterThan(1000);
  });
});
