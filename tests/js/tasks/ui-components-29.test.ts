/** Test UI batch 29 — ScrollToTop, MultiSelect, CollapsibleSidebar */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── ScrollToTop ── */
describe("ScrollToTop", () => {
  const src = readSrc("app/components/ScrollToTop.tsx");

  it("export ScrollToTop + useScrollProgress + ScrollToTopProps + threshold/smooth/position/size/color", () => {
    expect(src).toMatch(/export function ScrollToTop\b/);
    expect(src).toMatch(/export function useScrollProgress\b/);
    expect(src).toContain("export interface ScrollToTopProps");
    expect(src).toContain("threshold?:");
    expect(src).toContain("smooth?:");
    expect(src).toContain("position?:");
  });

  it("threshold: default 300 + scroll listener passive + y > threshold mostra + getScrollY helper", () => {
    expect(src).toContain("threshold = 300");
    expect(src).toContain("{ passive: true }");
    expect(src).toContain("y > threshold");
    expect(src).toContain("const getScrollY");
    expect(src).toContain("window.scrollY");
  });

  it("smooth: scrollTo behavior smooth/instant + scrollUp function + ArrowUp SVG default icon", () => {
    expect(src).toContain("smooth = true");
    expect(src).toContain("behavior: smooth ? 'smooth' : ('instant' as ScrollBehavior)");
    expect(src).toContain("const scrollUp");
    expect(src).toContain("scrollTo({ top: 0");
    expect(src).toContain("const ArrowUp");
  });

  it("fade: stt-in/stt-out keyframes + leaving state + setTimeout 250ms + POS 3 posizioni + aria-label", () => {
    expect(src).toContain("@keyframes stt-in");
    expect(src).toContain("@keyframes stt-out");
    expect(src).toContain("const [leaving, setLeaving]");
    expect(src).toContain("setTimeout(");
    expect(src).toContain("}, 250)");
    expect(src).toContain("const POS");
    expect(src).toContain("label = 'Torna in cima'");
  });
});

/* ── MultiSelect ── */
describe("MultiSelect", () => {
  const src = readSrc("components/MultiSelect.tsx");

  it("export default MultiSelect + MultiSelectProps + MSOption + controlled/uncontrolled + role combobox", () => {
    expect(src).toMatch(/export default function MultiSelect\b/);
    expect(src).toContain("export interface MultiSelectProps");
    expect(src).toContain("export interface MSOption");
    expect(src).toContain("const isCtrl = ctrl !== undefined");
    expect(src).toContain('role="combobox"');
    expect(src).toContain('aria-haspopup="listbox"');
  });

  it("multi: toggle select/deselect + chip × con stopPropagation + maxSelections limite + count display", () => {
    expect(src).toContain("const toggle");
    expect(src).toContain("selected.includes(val)");
    expect(src).toContain("selected.filter(v => v !== val)");
    expect(src).toContain("e.stopPropagation()");
    expect(src).toContain("selected.length < maxSelections");
    expect(src).toContain("{selected.length} / {maxSelections}");
  });

  it("select all: selectAll + allSelectable + allSelected + Deseleziona clear + Nessun risultato", () => {
    expect(src).toContain("const selectAll");
    expect(src).toContain("const allSelectable");
    expect(src).toContain("const allSelected");
    expect(src).toContain("Seleziona tutti");
    expect(src).toContain("Deseleziona");
    expect(src).toContain("Nessun risultato");
  });

  it("search: filtered query + click fuori chiude + role option aria-selected + checkbox ✓ + Enter/Escape keyboard", () => {
    expect(src).toContain("o.label.toLowerCase().includes(query.toLowerCase())");
    expect(src).toContain("!containerRef.current?.contains(e.target as Node)");
    expect(src).toContain('role="option"');
    expect(src).toContain("aria-selected={isSel}");
    expect(src).toContain('aria-multiselectable="true"');
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("e.key === 'Escape'");
  });
});

/* ── CollapsibleSidebar ── */
describe("CollapsibleSidebar", () => {
  const src = readSrc("components/CollapsibleSidebar.tsx");

  it("export default CollapsibleSidebar + Props + SidebarItem + SidebarSection + controlled/uncontrolled", () => {
    expect(src).toMatch(/export default function CollapsibleSidebar\b/);
    expect(src).toContain("export interface CollapsibleSidebarProps");
    expect(src).toContain("export interface SidebarItem");
    expect(src).toContain("export interface SidebarSection");
    expect(src).toContain("const isCtrl   = ctrl !== undefined");
  });

  it("toggle: collapsed/expanded + «/» icons + Espandi/Comprimi title + width transition 0.25s cubic-bezier", () => {
    expect(src).toContain("const toggle");
    expect(src).toContain("onCollapsedChange?.(next)");
    expect(src).toContain("collapsed ? '»' : '«'");
    expect(src).toContain("collapsed ? 'Espandi' : 'Comprimi'");
    expect(src).toContain("width 0.25s cubic-bezier(0.4,0,0.2,1)");
  });

  it("widths: expandedWidth default 220 + collapsedWidth default 52 + tooltip collapsed fixed + activeId highlight", () => {
    expect(src).toContain("expandedWidth = 220");
    expect(src).toContain("collapsedWidth = 52");
    expect(src).toContain("tooltip?.id === item.id");
    expect(src).toContain("position: 'fixed'");
    expect(src).toContain("item.id === activeId");
  });

  it("sections: title uppercase + collapsed separator + items icon + disabled opacity 0.4 + onItemClick callback", () => {
    expect(src).toContain("section.title && !collapsed");
    expect(src).toContain("textTransform: 'uppercase'");
    expect(src).toContain("section.title && collapsed");
    expect(src).toContain("opacity: item.disabled ? 0.4 : 1");
    expect(src).toContain("onItemClick?.(item)");
    expect(src).toContain("item.onClick?.()");
  });
});
