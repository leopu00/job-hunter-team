/** Test UI batch 21 — OnboardingTour, RichTextEditor, Accordion */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── OnboardingTour ── */
describe("OnboardingTour", () => {
  const src = readSrc("components/OnboardingTour.tsx");

  it("export default OnboardingTour + Step type con 4 position + STEPS 4 (sidebar, dashboard, search, settings)", () => {
    expect(src).toMatch(/export default function OnboardingTour\b/);
    expect(src).toContain("type Step");
    expect(src).toContain("'top' | 'bottom' | 'right' | 'left'");
    expect(src).toContain("const STEPS: Step[]");
    for (const id of ["sidebar", "dashboard", "search", "settings"])
      expect(src).toContain(`id: '${id}'`);
  });

  it("Tooltip: next/skip + counter index+1/total + 'Avanti →' e 'Fine' + 'salta'", () => {
    expect(src).toContain("function Tooltip");
    expect(src).toContain("onNext: () => void");
    expect(src).toContain("onSkip: () => void");
    expect(src).toContain("{index + 1} / {total}");
    expect(src).toContain("Avanti →");
    expect(src).toContain("Fine");
    expect(src).toContain("salta");
  });

  it("overlay rgba(0,0,0,0.45) z-9998 + tooltip z-9999 + pointerEvents none", () => {
    expect(src).toContain("rgba(0,0,0,0.45)");
    expect(src).toContain("z-[9998]");
    expect(src).toContain("z-[9999]");
    expect(src).toContain("pointerEvents: 'none'");
  });

  it("fetch /api/onboarding GET per completed + POST complete/skip/stepId", () => {
    expect(src).toContain("fetch('/api/onboarding')");
    expect(src).toContain("if (!s.completed) setActive(true)");
    expect(src).toContain("JSON.stringify({ complete: true })");
    expect(src).toContain("JSON.stringify({ skip: true })");
    expect(src).toContain("JSON.stringify({ stepId: s.id })");
  });
});

/* ── RichTextEditor ── */
describe("RichTextEditor", () => {
  const src = readSrc("components/RichTextEditor.tsx");

  it("export default RichTextEditor + RichTextEditorProps + value/onChange/placeholder/minHeight/disabled", () => {
    expect(src).toMatch(/export default function RichTextEditor\b/);
    expect(src).toContain("export interface RichTextEditorProps");
    expect(src).toContain("value?: string");
    expect(src).toContain("onChange?: (html: string) => void");
    expect(src).toContain("placeholder?: string");
    expect(src).toContain("minHeight?: number");
    expect(src).toContain("disabled?: boolean");
  });

  it("TOOLS: bold/italic/underline + H2/H3 formatBlock + liste + link/unlink + separatori", () => {
    expect(src).toContain("const TOOLS");
    for (const cmd of ["bold", "italic", "underline", "formatBlock", "insertUnorderedList", "insertOrderedList", "createLink", "unlink"])
      expect(src).toContain(`cmd: '${cmd}'`);
    expect(src).toContain("'sep'");
    expect(src).toContain("arg: 'h2'");
    expect(src).toContain("arg: 'h3'");
  });

  it("sanitize: ALLOWED_TAGS Set + DOMParser + clean ricorsivo + target _blank + rel noopener", () => {
    expect(src).toContain("const ALLOWED_TAGS = new Set");
    expect(src).toContain("new DOMParser().parseFromString(html, 'text/html')");
    expect(src).toContain("function clean(node: Node)");
    expect(src).toContain("ALLOWED_TAGS.has(tag)");
    expect(src).toContain("target', '_blank'");
    expect(src).toContain("rel', 'noopener noreferrer'");
  });

  it("contentEditable + execCommand + activeFormats queryCommandState + placeholder 'Scrivi qui...'", () => {
    expect(src).toContain("contentEditable={!disabled}");
    expect(src).toContain("document.execCommand(action.cmd, false, arg)");
    expect(src).toContain("document.queryCommandState(c)");
    expect(src).toContain("setActiveFormats");
    expect(src).toContain("Scrivi qui...");
  });
});

/* ── Accordion ── */
describe("Accordion", () => {
  const src = readSrc("components/Accordion.tsx");

  it("export default Accordion + AccordionItem + AccordionProps + mode single/multi + 3 variant", () => {
    expect(src).toMatch(/export default function Accordion\b/);
    expect(src).toContain("export interface AccordionItem");
    expect(src).toContain("export interface AccordionProps");
    expect(src).toContain("mode?: 'single' | 'multi'");
    expect(src).toContain("variant?: 'default' | 'bordered' | 'ghost'");
  });

  it("toggle con Set: single clear+add, multi toggle — openIds state", () => {
    expect(src).toContain("const [openIds, setOpenIds] = useState<Set<string>>");
    expect(src).toContain("const next = new Set(prev)");
    expect(src).toContain("next.delete(id)");
    expect(src).toContain("if (mode === 'single') next.clear()");
    expect(src).toContain("next.add(id)");
  });

  it("animazione height: scrollHeight + requestAnimationFrame + transition 0.25s + chevron rotate(180deg)", () => {
    expect(src).toContain("el.scrollHeight");
    expect(src).toContain("requestAnimationFrame(() => requestAnimationFrame(");
    expect(src).toContain("height 0.25s ease");
    expect(src).toContain("rotate(180deg)");
    expect(src).toContain("rotate(0deg)");
  });

  it("disabled opacity 0.45 + badge + icon + defaultOpen + divided separatore", () => {
    expect(src).toContain("opacity: item.disabled ? 0.45 : 1");
    expect(src).toContain("item.badge !== undefined");
    expect(src).toContain("item.icon &&");
    expect(src).toContain("items.filter(i => i.defaultOpen)");
    expect(src).toContain("divided?: boolean");
  });
});
