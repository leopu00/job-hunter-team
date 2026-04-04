/** Test UI batch 14 — CodeBlock, ErrorBoundary, Sortable */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── CodeBlock ── */
describe("CodeBlock", () => {
  const src = readSrc("app/components/CodeBlock.tsx");

  it("export CodeBlock + CodeLanguage 10 + CodeBlockProps + TokenType + TOKEN_COLOR 7", () => {
    expect(src).toMatch(/export function CodeBlock\b/);
    expect(src).toContain("export type CodeLanguage");
    expect(src).toContain("export interface CodeBlockProps");
    expect(src).toContain("type TokenType");
    expect(src).toContain("TOKEN_COLOR");
    for (const l of ["js", "ts", "python", "bash", "json", "css", "html", "text"]) expect(src).toContain(`'${l}'`);
  });

  it("3 keyword regex: JS_KEYWORDS + PY_KEYWORDS + SH_KEYWORDS", () => {
    expect(src).toContain("JS_KEYWORDS"); expect(src).toContain("PY_KEYWORDS"); expect(src).toContain("SH_KEYWORDS");
    expect(src).toContain("const|let|var|function"); // JS
    expect(src).toContain("def|class|import"); // Python
    expect(src).toContain("fi|for|while|do|done"); // Bash
  });

  it("tokenizeLine dispatch + tokenizeJson + tokenizeWithKeywords + splitByRegex + comment ///#", () => {
    expect(src).toContain("function tokenizeLine"); expect(src).toContain("function tokenizeJson");
    expect(src).toContain("function tokenizeWithKeywords"); expect(src).toContain("function splitByRegex");
    expect(src).toContain("line.indexOf('//')"); expect(src).toContain("line.indexOf('#')");
  });

  it("CodeBlock: CopyButton import, header filename/language, table line numbers, hover", () => {
    expect(src).toContain("import { CopyButton }");
    expect(src).toContain("filename ?? language"); expect(src).toContain('variant="inline"');
    expect(src).toContain("showLineNumbers"); expect(src).toContain("{i + 1}"); // line number
    expect(src).toContain("hover:bg-[var(--color-row)]");
  });
});

/* ── ErrorBoundary ── */
describe("ErrorBoundary", () => {
  const src = readSrc("app/components/ErrorBoundary.tsx");

  it("export ErrorBoundary class + DefaultFallback + withErrorBoundary + useErrorBoundary", () => {
    expect(src).toContain("export class ErrorBoundary extends Component");
    expect(src).toMatch(/export function DefaultFallback\b/);
    expect(src).toMatch(/export function withErrorBoundary\b/);
    expect(src).toMatch(/export function useErrorBoundary\b/);
  });

  it("FallbackProps error+reset + ErrorBoundaryProps children/fallback/onError/resetKeys", () => {
    expect(src).toContain("export interface FallbackProps");
    expect(src).toContain("error:    Error"); expect(src).toContain("reset:    () => void");
    expect(src).toContain("export interface ErrorBoundaryProps");
    expect(src).toContain("onError?:"); expect(src).toContain("resetKeys?:  unknown[]");
  });

  it("DefaultFallback: 'Qualcosa è andato storto' + stack trace toggle + 'Riprova' button", () => {
    expect(src).toContain("Qualcosa è andato storto");
    expect(src).toContain("Mostra stack trace"); expect(src).toContain("Nascondi dettagli");
    expect(src).toContain("error.stack"); expect(src).toContain("Riprova");
  });

  it("getDerivedStateFromError + getDerivedStateFromProps auto-reset + componentDidCatch", () => {
    expect(src).toContain("static getDerivedStateFromError");
    expect(src).toContain("static getDerivedStateFromProps");
    expect(src).toContain("keys.some((k, i) => k !== state.prevKeys[i])"); // auto-reset
    expect(src).toContain("componentDidCatch"); expect(src).toContain("this.props.onError?.(error, info)");
  });

  it("withErrorBoundary HOC displayName + useErrorBoundary throwError via setState", () => {
    expect(src).toContain("Wrapped.displayName = `withErrorBoundary(");
    expect(src).toContain("const throwError"); expect(src).toContain("setState(() => { throw error })");
  });
});

/* ── Sortable ── */
describe("Sortable", () => {
  const src = readSrc("components/Sortable.tsx");

  it("export default Sortable + SortableItem + SortableProps interfaces", () => {
    expect(src).toMatch(/export default function Sortable\b/);
    expect(src).toContain("export interface SortableItem");
    expect(src).toContain("export interface SortableProps");
  });

  it("DnD state: dragId/overId/dragPos before|after + ghost clone transparent", () => {
    expect(src).toContain("useState<string | null>(null)");
    expect(src).toContain("'before' | 'after'");
    expect(src).toContain("effectAllowed = 'move'"); expect(src).toContain("dropEffect = 'move'");
    expect(src).toContain("cloneNode(true)"); expect(src).toContain("opacity:0.01");
  });

  it("onDragOver: clientY half detection + onDrop: splice reorder + insertAt + reset", () => {
    expect(src).toContain("e.clientY < rect.top + rect.height / 2");
    expect(src).toContain("next.splice(from, 1)"); expect(src).toContain("next.splice(Math.max(0, insertAt)");
    expect(src).toContain("onReorder(next)"); expect(src).toContain("const reset");
  });

  it("handle grip ⠿ + disabled + role='list'/role='listitem' + placeholder green bar", () => {
    expect(src).toContain("handle"); expect(src).toContain("⠿"); expect(src).toContain("cursor: 'grab'");
    expect(src).toContain("disabled"); expect(src).toContain('role="list"'); expect(src).toContain('role="listitem"');
    expect(src).toContain("var(--color-green)"); // placeholder
    expect(src).toContain("opacity: isDragging ? 0.35 : 1");
  });
});
