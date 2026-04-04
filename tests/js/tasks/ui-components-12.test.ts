/** Test UI batch 12 — Chart SVG, TreeView, Kbd */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Chart SVG ── */
describe("Chart SVG", () => {
  const src = readSrc("app/components/Chart.tsx");

  it("export DataPoint + BarChart + LineChart + AreaChart", () => {
    expect(src).toContain("export type DataPoint");
    expect(src).toMatch(/export function BarChart\b/);
    expect(src).toMatch(/export function LineChart\b/);
    expect(src).toMatch(/export function AreaChart\b/);
  });

  it("BaseProps: data, height 160, color green, showLabels, showGrid + W=400 + PAD", () => {
    expect(src).toContain("height?: number"); expect(src).toContain("color?: string");
    expect(src).toContain("showLabels?: boolean"); expect(src).toContain("showGrid?: boolean");
    expect(src).toContain("const W = 400");
    expect(src).toContain("top: 16"); expect(src).toContain("bottom: 28"); expect(src).toContain("left: 36");
  });

  it("yScale + xPos helper + GridLines con steps + text labels", () => {
    expect(src).toContain("function yScale"); expect(src).toContain("function xPos");
    expect(src).toContain("function GridLines"); expect(src).toContain("steps = 4");
    expect(src).toContain("textAnchor"); expect(src).toContain("Math.round(val)");
  });

  it("BarChart: rect rx=2 + barW calc, LineChart: polyline + circles, AreaChart: linearGradient + path", () => {
    expect(src).toContain("<rect"); expect(src).toContain("rx={2}");
    expect(src).toContain("<polyline"); expect(src).toContain("<circle");
    expect(src).toContain("<linearGradient"); expect(src).toContain("area-grad");
    expect(src).toContain("stopOpacity={0.3}"); expect(src).toContain("stopOpacity={0.02}");
  });
});

/* ── TreeView ── */
describe("TreeView", () => {
  const src = readSrc("components/TreeView.tsx");

  it("export default TreeView + TreeNode + TreeViewProps interfaces", () => {
    expect(src).toMatch(/export default function TreeView\b/);
    expect(src).toContain("export interface TreeNode");
    expect(src).toContain("export interface TreeViewProps");
  });

  it("filterNodes ricorsivo: label.toLowerCase().includes + auto-expand su ricerca", () => {
    expect(src).toContain("function filterNodes");
    expect(src).toContain("node.label.toLowerCase().includes(query.toLowerCase())");
    expect(src).toContain("filteredChildren.length > 0");
    expect(src).toContain("// Auto-expand tutti se c'è ricerca");
  });

  it("flatVisible per keyboard nav + ArrowDown/Up/Right/Left/Enter/Space", () => {
    expect(src).toContain("function flatVisible");
    expect(src).toContain("'ArrowDown'"); expect(src).toContain("'ArrowUp'");
    expect(src).toContain("'ArrowRight'"); expect(src).toContain("'ArrowLeft'");
    expect(src).toContain("'Enter'"); expect(src).toContain("' '");
  });

  it("TreeNodeRow: role='treeitem' + aria-expanded + aria-selected + chevron ▶ rotate", () => {
    expect(src).toContain("function TreeNodeRow");
    expect(src).toContain('role="treeitem"');
    expect(src).toContain("aria-expanded={hasChildren ? isExpanded : undefined}");
    expect(src).toContain("aria-selected={isSelected}");
    expect(src).toContain("rotate(90deg)"); expect(src).toContain("rotate(0deg)");
  });

  it("role='tree' + searchable input 'Cerca...' + 'Nessun risultato' + icone 📂/📁/📄", () => {
    expect(src).toContain('role="tree"');
    expect(src).toContain("searchable"); expect(src).toContain("Cerca...");
    expect(src).toContain("Nessun risultato");
    expect(src).toContain("📂"); expect(src).toContain("📁"); expect(src).toContain("📄");
  });

  it("indent configurabile + controlled/uncontrolled expanded + children count", () => {
    expect(src).toContain("indent?: number"); expect(src).toContain("indent = 16");
    expect(src).toContain("expandedIds ?? internalExpanded"); // controlled/uncontrolled
    expect(src).toContain("node.children!.length"); // count badge
  });
});

/* ── Kbd ── */
describe("Kbd", () => {
  const src = readSrc("app/components/Kbd.tsx");

  it("export Kbd + KbdCombo + ShortcutRow + ShortcutList + SHORTCUTS + tipi", () => {
    expect(src).toMatch(/export function Kbd\b/);
    expect(src).toMatch(/export function KbdCombo\b/);
    expect(src).toMatch(/export function ShortcutRow\b/);
    expect(src).toMatch(/export function ShortcutList\b/);
    expect(src).toContain("export const SHORTCUTS");
    expect(src).toContain("export type KbdSize");
    expect(src).toContain("export interface KbdProps");
    expect(src).toContain("export interface KbdComboProps");
  });

  it("ALIASES 17+ chiavi: ctrl→Ctrl, cmd→⌘, shift→⇧, enter→↵, escape→Esc, arrows", () => {
    expect(src).toContain("const ALIASES");
    expect(src).toContain("cmd:     '⌘'"); expect(src).toContain("shift:   '⇧'");
    expect(src).toContain("enter:   '↵'"); expect(src).toContain("escape:  'Esc'");
    expect(src).toContain("up:      '↑'"); expect(src).toContain("down:    '↓'");
    expect(src).toContain("function resolveKey");
  });

  it("Kbd: elemento <kbd> con borderBottom 2px (3D) + boxShadow + SIZE_CLS sm/md/lg", () => {
    expect(src).toContain("<kbd"); expect(src).toContain("SIZE_CLS");
    expect(src).toContain("borderBottom: '2px solid var(--color-border)'");
    expect(src).toContain("boxShadow:    '0 1px 0 var(--color-border)'");
  });

  it("KbdCombo: keys[] con separator '+' + ShortcutRow: label + KbdCombo aligned", () => {
    expect(src).toContain("separator?: string"); expect(src).toContain("separator = '+'");
    expect(src).toContain("{resolveKey(k)}");
    expect(src).toContain("justify-between"); // ShortcutRow alignment
  });

  it("SHORTCUTS 12 preset: save/undo/redo/copy/paste/find/commandPalette/submit", () => {
    for (const k of ["save", "undo", "redo", "copy", "paste", "find", "commandPalette", "submit"])
      expect(src).toContain(`${k}:`);
    expect(src).toContain("as const");
  });
});
